import assert from "node:assert/strict";
import test from "node:test";
import crypto from "crypto";
import { prisma } from "../src/db/client";
import { env } from "../src/config/env";
import { ensureInstrumentsAvailable } from "../src/services/instrumentService";
import {
  startKiteTicker,
  stopKiteTicker,
  getUserSubscribedTokens,
} from "../src/services/streamHandler";
import { createMarketDataProvider, resolveSymbolPrice, setMarketDataProvider } from "../src/services/marketDataProvider";
import { getWatchlistSummary } from "../src/services/watchlist/changeDetectionService";

import { KiteConnect, KiteTicker } from "kiteconnect";

const DUMMY_HEX_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function makeEncryptedToken(token: string, hexKey: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(hexKey, "hex"), iv);
  const enc = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv.toString("hex"), cipher.getAuthTag().toString("hex"), enc.toString("hex")].join(".");
}

const SAMPLE_CSV = `instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange
738561,2885,RELIANCE,RELIANCE INDUSTRIES,2485.50,,,0.05,1,EQ,NSE,NSE
408065,1594,INFY,INFOSYS,1520.00,,,0.05,1,EQ,NSE,NSE
2953217,11536,TCS,TATA CONSULTANCY SERV,3850.00,,,0.05,1,EQ,NSE,NSE`;

test("Kite Fresh-User Onboarding & Instrument Synchronization Suite", async (t) => {
  // Preserve original env, fetch, and KiteTicker methods
  const savedApiKey = env.KITE_API_KEY;
  const savedApiSecret = env.KITE_API_SECRET;
  const savedRedirectUrl = env.KITE_REDIRECT_URL;
  const savedEncKey = env.KITE_TOKEN_ENCRYPTION_KEY;
  const originalFetch = globalThis.fetch;
  const origConnect = KiteTicker.prototype.connect;
  const origDisconnect = KiteTicker.prototype.disconnect;

  // Stub KiteTicker connect/disconnect to avoid live WS connections during unit testing
  KiteTicker.prototype.connect = function () {
    // No-op for unit tests
  };
  KiteTicker.prototype.disconnect = function () {
    // No-op for unit tests
  };

  // Set test credentials
  (env as any).KITE_API_KEY = "test-kite-api-key";
  (env as any).KITE_API_SECRET = "test-kite-api-secret";
  (env as any).KITE_REDIRECT_URL = "http://localhost:8000/broker/kite/callback";
  (env as any).KITE_TOKEN_ENCRYPTION_KEY = DUMMY_HEX_KEY;

  t.after(async () => {
    (env as any).KITE_API_KEY = savedApiKey;
    (env as any).KITE_API_SECRET = savedApiSecret;
    (env as any).KITE_REDIRECT_URL = savedRedirectUrl;
    (env as any).KITE_TOKEN_ENCRYPTION_KEY = savedEncKey;
    globalThis.fetch = originalFetch;
    KiteTicker.prototype.connect = origConnect;
    KiteTicker.prototype.disconnect = origDisconnect;
    setMarketDataProvider(createMarketDataProvider("mock"));
  });

  // ── A. Fresh Kite user + empty Instrument table ────────────────────────────
  await t.test("A: Fresh Kite user with empty Instrument table triggers sync, populates instruments, and resolves tokens", async () => {
    const userId = `fresh-kite-a-${Date.now()}`;
    await prisma.user.create({
      data: { id: userId, email: `kite-a-${Date.now()}@test.invalid`, passwordHash: "h" },
    });

    try {
      // Add watchlist symbols for user
      await prisma.watchlistItem.createMany({
        data: [
          { userId, symbol: "RELIANCE" },
          { userId, symbol: "INFY" },
        ],
      });

      // Create valid broker session for user
      await prisma.brokerSession.create({
        data: {
          userId,
          provider: "ZERODHA",
          brokerUserId: "AB1234",
          accessTokenEncrypted: makeEncryptedToken("valid-access-token", DUMMY_HEX_KEY),
          expiresAt: new Date(Date.now() + 86400000),
        },
      });

      // Clear instruments
      await prisma.instrument.deleteMany();
      assert.equal(await prisma.instrument.count(), 0, "Instrument table must start empty");

      // Mock fetch to provide sample CSV
      let fetchCalled = false;
      globalThis.fetch = async (url: any, init?: any) => {
        if (typeof url === "string" && url.includes("api.kite.trade/instruments")) {
          fetchCalled = true;
          return new Response(SAMPLE_CSV, {
            status: 200,
            headers: { "content-type": "text/csv" },
          });
        }
        return originalFetch(url, init);
      };

      // Run ensureInstrumentsAvailable
      const ready = await ensureInstrumentsAvailable(userId);
      assert.equal(ready, true, "ensureInstrumentsAvailable must return true");
      assert.equal(fetchCalled, true, "Instruments download must be triggered");

      // Verify instruments table populated
      const count = await prisma.instrument.count();
      assert.ok(count >= 3, "Instruments table must contain at least 3 items");

      // Start KiteTicker
      const fakeIo = { emit: () => {}, to: () => ({ emit: () => {} }) } as any;
      await startKiteTicker(fakeIo, userId);

      const subscribedTokens = getUserSubscribedTokens(userId);
      assert.ok(subscribedTokens.includes(738561), "Must resolve and subscribe RELIANCE token 738561");
      assert.ok(subscribedTokens.includes(408065), "Must resolve and subscribe INFY token 408065");
    } finally {
      stopKiteTicker(userId);
      await prisma.brokerSession.deleteMany({ where: { userId } });
      await prisma.watchlistItem.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
  });

  // ── B. Fresh Kite user + already-populated Instrument table ────────────────
  await t.test("B: Fresh Kite user with already-populated fresh Instrument table skips re-download and starts ticker", async () => {
    const userId = `fresh-kite-b-${Date.now()}`;
    await prisma.user.create({
      data: { id: userId, email: `kite-b-${Date.now()}@test.invalid`, passwordHash: "h" },
    });

    try {
      await prisma.watchlistItem.createMany({
        data: [{ userId, symbol: "TCS" }],
      });

      await prisma.brokerSession.create({
        data: {
          userId,
          provider: "ZERODHA",
          brokerUserId: "CD5678",
          accessTokenEncrypted: makeEncryptedToken("valid-access-token-b", DUMMY_HEX_KEY),
          expiresAt: new Date(Date.now() + 86400000),
        },
      });

      // Ensure instrument exists with fresh timestamp
      await prisma.instrument.upsert({
        where: { exchange_tradingsymbol: { exchange: "NSE", tradingsymbol: "TCS" } },
        create: {
          instrumentToken: 2953217,
          exchange: "NSE",
          tradingsymbol: "TCS",
          tickSize: 0.05,
          lotSize: 1,
          instrumentType: "EQ",
          segment: "NSE",
          syncedAt: new Date(), // Fresh (now)
        },
        update: {
          syncedAt: new Date(),
        },
      });

      let fetchAttempted = false;
      globalThis.fetch = async (url: any, init?: any) => {
        if (typeof url === "string" && url.includes("api.kite.trade/instruments")) {
          fetchAttempted = true;
          return new Response("", { status: 500 });
        }
        return originalFetch(url, init);
      };

      const ready = await ensureInstrumentsAvailable(userId);
      assert.equal(ready, true, "Should return true from fresh cache");
      assert.equal(fetchAttempted, false, "Should NOT trigger re-download when data is fresh");

      const fakeIo = { emit: () => {}, to: () => ({ emit: () => {} }) } as any;
      await startKiteTicker(fakeIo, userId);
      const subscribed = getUserSubscribedTokens(userId);
      assert.ok(subscribed.includes(2953217), "Must resolve TCS token 2953217 from existing table");
    } finally {
      stopKiteTicker(userId);
      await prisma.brokerSession.deleteMany({ where: { userId } });
      await prisma.watchlistItem.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
  });

  // ── C. Instrument sync failure ─────────────────────────────────────────────
  await t.test("C: Instrument sync failure prevents silent zero-token subscription and never fabricates quotes", async () => {
    const userId = `fresh-kite-c-${Date.now()}`;
    await prisma.user.create({
      data: { id: userId, email: `kite-c-${Date.now()}@test.invalid`, passwordHash: "h" },
    });

    try {
      await prisma.watchlistItem.createMany({
        data: [{ userId, symbol: "INFY" }],
      });

      await prisma.brokerSession.create({
        data: {
          userId,
          provider: "ZERODHA",
          brokerUserId: "FAIL01",
          accessTokenEncrypted: makeEncryptedToken("valid-token", DUMMY_HEX_KEY),
          expiresAt: new Date(Date.now() + 86400000),
        },
      });

      // Clear instruments
      await prisma.instrument.deleteMany();

      // Mock fetch failure
      globalThis.fetch = async (url: any, init?: any) => {
        if (typeof url === "string" && url.includes("api.kite.trade/instruments")) {
          return new Response("Service Unavailable", { status: 503 });
        }
        return originalFetch(url, init);
      };

      const ready = await ensureInstrumentsAvailable(userId);
      assert.equal(ready, false, "ensureInstrumentsAvailable must return false when sync fails");

      // Verify startKiteTicker throws when symbols exist but instruments could not resolve
      const fakeIo = { emit: () => {}, to: () => ({ emit: () => {} }) } as any;
      await assert.rejects(
        async () => startKiteTicker(fakeIo, userId),
        /Failed to resolve instrument tokens/i,
        "Must NOT silently start a zero-token subscription"
      );

      // Verify no quotes fabricated in kite mode
      setMarketDataProvider(createMarketDataProvider("kite"));
      const resolved = await resolveSymbolPrice("INFY");
      assert.equal(resolved, null, "Must NOT fabricate quotes on sync failure");
    } finally {
      stopKiteTicker(userId);
      await prisma.brokerSession.deleteMany({ where: { userId } });
      await prisma.watchlistItem.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
  });

  // ── D. Mock mode remains completely unchanged ──────────────────────────────
  await t.test("D: Mock mode remains completely unchanged and operates independently of Instrument table", async () => {
    setMarketDataProvider(createMarketDataProvider("mock"));
    const resolved = await resolveSymbolPrice("INFY");
    assert.ok(resolved !== null, "Mock mode must resolve prices dynamically");
    assert.equal(resolved!.source, "mock");
    assert.ok(resolved!.price > 0);
  });

  // ── E. Existing authenticated/demo users: strictly isolated ───────────────
  await t.test("E: Subscriptions and sessions remain strictly isolated across users", async () => {
    const userA = `user-iso-a-${Date.now()}`;
    const userB = `user-iso-b-${Date.now()}`;

    await prisma.user.createMany({
      data: [
        { id: userA, email: `iso-a-${Date.now()}@test.invalid`, passwordHash: "h" },
        { id: userB, email: `iso-b-${Date.now()}@test.invalid`, passwordHash: "h" },
      ],
    });

    try {
      await prisma.brokerSession.createMany({
        data: [
          {
            userId: userA,
            provider: "ZERODHA",
            brokerUserId: "USERA",
            accessTokenEncrypted: makeEncryptedToken("token-a", DUMMY_HEX_KEY),
            expiresAt: new Date(Date.now() + 86400000),
          },
          {
            userId: userB,
            provider: "ZERODHA",
            brokerUserId: "USERB",
            accessTokenEncrypted: makeEncryptedToken("token-b", DUMMY_HEX_KEY),
            expiresAt: new Date(Date.now() + 86400000),
          },
        ],
      });

      // Pre-populate instruments
      await prisma.instrument.createMany({
        data: [
          { instrumentToken: 738561, exchange: "NSE", tradingsymbol: "RELIANCE", tickSize: 0.05, lotSize: 1, instrumentType: "EQ", segment: "NSE" },
          { instrumentToken: 408065, exchange: "NSE", tradingsymbol: "INFY", tickSize: 0.05, lotSize: 1, instrumentType: "EQ", segment: "NSE" },
        ],
        skipDuplicates: true,
      });

      await prisma.watchlistItem.create({ data: { userId: userA, symbol: "RELIANCE" } });
      await prisma.watchlistItem.create({ data: { userId: userB, symbol: "INFY" } });

      const fakeIo = { emit: () => {}, to: () => ({ emit: () => {} }) } as any;
      await startKiteTicker(fakeIo, userA);
      await startKiteTicker(fakeIo, userB);

      const tokensA = getUserSubscribedTokens(userA);
      const tokensB = getUserSubscribedTokens(userB);

      assert.deepEqual(tokensA, [738561], "User A must only have RELIANCE token");
      assert.deepEqual(tokensB, [408065], "User B must only have INFY token");
    } finally {
      stopKiteTicker(userA);
      stopKiteTicker(userB);
      await prisma.brokerSession.deleteMany({ where: { userId: { in: [userA, userB] } } });
      await prisma.watchlistItem.deleteMany({ where: { userId: { in: [userA, userB] } } });
      await prisma.user.deleteMany({ where: { id: { in: [userA, userB] } } });
    }
  });

  // ── F. OAuth callback returns truthful status when live-stream fails ───────
  await t.test("F: OAuth callback succeeds in persisting session even when live-stream startup fails", async () => {
    const { app } = await import("../src/server");
    const http = await import("node:http");
    const jwt = await import("jsonwebtoken");

    const server = http.createServer(app);
    app.set("io", { emit: () => {}, to: () => ({ emit: () => {} }) } as any);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const testUserId = `oauth-f-${Date.now()}`;
    await prisma.user.create({
      data: { id: testUserId, email: `oauth-f-${Date.now()}@test.invalid`, passwordHash: "h" },
    });

    const origGenerateSession = KiteConnect.prototype.generateSession;
    const origGetProfile = KiteConnect.prototype.getProfile;
    const savedMode = env.MARKET_DATA_MODE;

    try {
      // Mock KiteConnect login methods to return a valid session and profile without external API calls
      (KiteConnect.prototype as any).generateSession = async function () {
        return {
          user_id: "BROKER_F_USER",
          user_name: "Mock Trader",
          access_token: "mock-valid-access-token-f",
          public_token: "mock-public-token",
          login_time: new Date().toISOString(),
        };
      };

      (KiteConnect.prototype as any).getProfile = async function () {
        return {
          user_id: "BROKER_F_USER",
          user_name: "Mock Trader",
          user_shortname: "Trader",
          avatar_url: null,
          broker: "ZERODHA",
          email: "trader-f@test.invalid",
        };
      };

      (env as any).MARKET_DATA_MODE = "kite";

      // Clear instruments table to ensure master catalog is unpopulated
      await prisma.instrument.deleteMany();

      // Mock fetch failure specifically for api.kite.trade/instruments to simulate sync failure
      globalThis.fetch = async (url: any, init?: any) => {
        if (typeof url === "string" && url.includes("api.kite.trade/instruments")) {
          return new Response("Simulated instrument download failure", { status: 503 });
        }
        return originalFetch(url, init);
      };

      const state = jwt.sign({ purpose: "kite-oauth", userId: testUserId }, env.JWT_ACCESS_SECRET, { expiresIn: "10m" });

      const res = await fetch(`${baseUrl}/broker/kite/callback?state=${state}&request_token=valid_simulated_token`);
      assert.equal(res.status, 200, "OAuth callback must return HTTP 200");

      const body = await res.json();
      assert.deepEqual(body, {
        ok: true,
        provider: "ZERODHA",
        brokerUserId: "BROKER_F_USER",
        streamStarted: false,
        streamError: "Instrument catalog synchronization failed; live market stream could not be started",
      });

      // Verify that the BrokerSession was persisted and remains present in PostgreSQL
      const persistedSession = await prisma.brokerSession.findUnique({
        where: { userId_provider: { userId: testUserId, provider: "ZERODHA" } },
      });
      assert.ok(persistedSession, "BrokerSession must remain persisted in DB after stream failure");
      assert.equal(persistedSession!.brokerUserId, "BROKER_F_USER");
      assert.ok(persistedSession!.accessTokenEncrypted.length > 0, "Encrypted access token must be present");
    } finally {
      (KiteConnect.prototype as any).generateSession = origGenerateSession;
      (KiteConnect.prototype as any).getProfile = origGetProfile;
      (env as any).MARKET_DATA_MODE = savedMode;
      server.close();
      await prisma.brokerSession.deleteMany({ where: { userId: testUserId } });
      await prisma.user.deleteMany({ where: { id: testUserId } });
    }
  });
});
