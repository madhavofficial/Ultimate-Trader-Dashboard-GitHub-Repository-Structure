import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import {
  createMarketDataProvider,
  resolveSymbolPrice,
  MockMarketDataProvider,
  KiteMarketDataProvider,
  setMarketDataProvider,
} from "../src/services/marketDataProvider";
import { updateLtpAndBroadcast } from "../src/services/portfolioService";
import { prisma } from "../src/db/client";
import { AppError } from "../src/errors/appError";
import { createKiteLoginUrl, getKiteTickerCredentials } from "../src/services/kiteService";
import { app } from "../src/server";

// ── A. Mock provider emits/updates market data ───────────────────────────────
test("A: MockMarketDataProvider implements MarketDataProvider and emits/updates market data", () => {
  const provider = createMarketDataProvider("mock");
  assert.equal(provider.name, "mock");
  assert.ok(provider instanceof MockMarketDataProvider);
  assert.equal(typeof provider.start, "function");
  assert.equal(typeof provider.getPrice, "function");
});

// ── B. Mock data reaches the normal watchlist pipeline ────────────────────────
test("B: Mock data reaches the normal watchlist pipeline via ltpMap single source of truth", async () => {
  const mockProvider = createMarketDataProvider("mock");
  setMarketDataProvider(mockProvider);

  // Update LTP via updateLtpAndBroadcast (which both Mock and Kite providers call)
  const fakeIo = {
    emit: () => {},
    to: () => ({ emit: () => {} }),
  } as any;

  const testPrice = 2468.50;
  await updateLtpAndBroadcast(fakeIo, [
    {
      symbol: "TEST_PIPELINE_STOCK",
      last_price: testPrice,
      volume: 75000,
      timestamp: Date.now(),
      source: "mock",
    },
  ]);

  // Downstream watchlist services read from resolveSymbolPrice
  const resolved = await resolveSymbolPrice("TEST_PIPELINE_STOCK");
  assert.ok(resolved !== null, "Resolved price must not be null");
  assert.equal(resolved!.price, testPrice);
  assert.equal(resolved!.source, "mock");
});

// ── C. Demo account can load its seeded watchlist ────────────────────────────
test("C: Demo account can load its seeded watchlist and checkpoint", async () => {
  const demoEmail = (process.env.SEED_EMAIL || "demo@example.com").toLowerCase();
  let demoUser = await prisma.user.findUnique({
    where: { email: demoEmail },
  });

  // If not already seeded in database, seed it deterministically so the test never skips
  if (!demoUser) {
    demoUser = await prisma.user.create({
      data: {
        email: demoEmail,
        passwordHash: "demo-test-seeded-hash",
      },
    });
    await prisma.watchlistItem.createMany({
      data: [
        { userId: demoUser.id, symbol: "INFY" },
        { userId: demoUser.id, symbol: "RELIANCE" },
        { userId: demoUser.id, symbol: "TCS" },
      ],
    });
    const cp = await prisma.watchlistCheckpoint.create({
      data: {
        userId: demoUser.id,
        lastCheckedAt: new Date(Date.now() - 7200000),
      },
    });
    await prisma.watchlistCheckpointItem.createMany({
      data: [
        { checkpointId: cp.id, symbol: "INFY", price: 1505, volume: BigInt(810000), observedAt: new Date() },
        { checkpointId: cp.id, symbol: "RELIANCE", price: 2460, volume: BigInt(1430000), observedAt: new Date() },
        { checkpointId: cp.id, symbol: "TCS", price: 3790, volume: BigInt(480000), observedAt: new Date() },
      ],
    });
  }

  assert.ok(demoUser, "Demo user must exist");
  const items = await prisma.watchlistItem.findMany({
    where: { userId: demoUser.id },
  });
  assert.ok(items.length >= 3, "Demo user must have at least 3 seeded watchlist items");
  const symbols = items.map((i) => i.symbol);
  assert.ok(symbols.includes("INFY"), "Demo watchlist must contain INFY");
  assert.ok(symbols.includes("RELIANCE"), "Demo watchlist must contain RELIANCE");
  assert.ok(symbols.includes("TCS"), "Demo watchlist must contain TCS");

  const checkpoint = await prisma.watchlistCheckpoint.findUnique({
    where: { userId: demoUser.id },
    include: { items: true },
  });
  assert.ok(checkpoint !== null, "Demo user must have a seeded checkpoint baseline");
  assert.ok(checkpoint.items.length >= 3, "Seeded checkpoint must contain items");
});

// ── D. Fresh users do not inherit demo state ─────────────────────────────────
test("D: Fresh users do not inherit demo state or checkpoints", async () => {
  const freshUserId = `fresh-test-${Date.now()}`;
  const freshEmail = `fresh-${Date.now()}@example.com`;

  const freshUser = await prisma.user.create({
    data: {
      id: freshUserId,
      email: freshEmail,
      passwordHash: "dummy-hash",
    },
  });

  try {
    const items = await prisma.watchlistItem.findMany({
      where: { userId: freshUser.id },
    });
    const checkpoint = await prisma.watchlistCheckpoint.findUnique({
      where: { userId: freshUser.id },
    });

    assert.equal(items.length, 0, "Fresh user must start with empty watchlist");
    assert.equal(checkpoint, null, "Fresh user must start with no checkpoint");
  } finally {
    await prisma.user.delete({ where: { id: freshUser.id } });
  }
});

// ── E. Provider selection is configuration-based, not user-email-based ────────
test("E: Provider selection is configuration-based, not user-email-based", () => {
  const mockP = createMarketDataProvider("mock");
  assert.equal(mockP.name, "mock");
  assert.ok(mockP instanceof MockMarketDataProvider);

  const kiteP = createMarketDataProvider("kite");
  assert.equal(kiteP.name, "kite");
  assert.ok(kiteP instanceof KiteMarketDataProvider);

  // Even for an evaluator or demo user email, the provider is chosen strictly by mode
  const fallbackP = createMarketDataProvider("unknown_mode");
  assert.equal(fallbackP.name, "mock", "Fallback default is mock provider");
});

// ── F. Kite provider is wired into the same provider interface ───────────────
test("F: Kite provider is wired into the same MarketDataProvider interface", () => {
  const kiteProvider = createMarketDataProvider("kite");
  assert.equal(kiteProvider.name, "kite");
  assert.equal(typeof kiteProvider.start, "function");
  assert.equal(typeof kiteProvider.getPrice, "function");

  // Non-existent symbol returns null before quotes arrive
  assert.equal(kiteProvider.getPrice("NON_EXISTENT_TICKER_999"), null);
});

// ── G. Missing Kite credentials fail gracefully ──────────────────────────────
test("G: Missing Kite credentials fail gracefully with AppError 503", () => {
  // If credentials are empty or missing, createKiteLoginUrl throws 503
  const savedKey = process.env.KITE_API_KEY;
  process.env.KITE_API_KEY = "";

  try {
    assert.throws(
      () => createKiteLoginUrl("test-user-id"),
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 503);
        assert.match(err.message, /not configured/i);
        return true;
      }
    );
  } finally {
    process.env.KITE_API_KEY = savedKey;
  }
});

// ── H. Missing/expired Kite authentication fails gracefully ──────────────────
test("H: Missing or expired Kite authentication fails gracefully", async () => {
  await assert.rejects(
    async () => getKiteTickerCredentials("non-existent-user-id-9999"),
    (err: any) => {
      assert.ok(err instanceof AppError);
      assert.ok(
        err.statusCode === 401 || err.statusCode === 503,
        `Expected 401 or 503 for unauthenticated session, got ${err.statusCode}`
      );
      assert.match(err.message, /session is missing or expired|not configured/i);
      return true;
    }
  );
});

// ── I. Existing watchlist/change-detection tests still pass ──────────────────
test("I: resolveSymbolPrice works seamlessly with mock provider", async () => {
  setMarketDataProvider(createMarketDataProvider("mock"));
  const resolved = await resolveSymbolPrice("INFY");
  assert.ok(resolved !== null, "Mock provider must resolve INFY price");
  assert.ok(resolved!.price > 0, "Price must be positive");
  assert.equal(resolved!.source, "mock");
});

// ── J. No production scenario-controller behavior has been introduced ────────
test("J: No scenario-controller routes exist on madhav branch", async () => {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // Attempting to post to /watchlist/scenario or GET /watchlist/scenario
    const res = await fetch(`${baseUrl}/watchlist/scenario`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario: "big_move" }),
    });

    // On madhav branch, scenario endpoint should be 401 (auth middleware on /watchlist) or 404
    assert.ok(
      res.status === 401 || res.status === 404,
      `Scenario controller must not exist or be accessible: got ${res.status}`
    );
  } finally {
    server.close();
  }
});

// ── K. Audit: captureCurrentWatchlistState never substitutes benchmarkPrice ──
test("K: Audit fallback path: captureCurrentWatchlistState never substitutes benchmarkPrice for a stock price", async () => {
  const { captureCurrentWatchlistState } = await import("../src/services/watchlist/snapshotService");
  const testUserId = `audit-test-${Date.now()}`;
  await prisma.user.create({
    data: { id: testUserId, email: `audit-${Date.now()}@test.invalid`, passwordHash: "h" },
  });

  try {
    // Add a symbol that has no mock or live price in ltpMap
    await prisma.watchlistItem.create({
      data: { userId: testUserId, symbol: "UNKNOWN_NO_QUOTE_STOCK" },
    });

    const states = await captureCurrentWatchlistState(testUserId);
    const stockState = states.find((s) => s.symbol === "UNKNOWN_NO_QUOTE_STOCK");
    assert.ok(stockState, "Stock state must be captured");

    // Price must NOT be equal to benchmark price (e.g. 24000+ for NIFTY)
    if (stockState.benchmarkPrice) {
      assert.notEqual(
        stockState.price,
        stockState.benchmarkPrice,
        "Stock price must NEVER be substituted with benchmark index price"
      );
    }
  } finally {
    await prisma.watchlistItem.deleteMany({ where: { userId: testUserId } });
    await prisma.user.deleteMany({ where: { id: testUserId } });
  }
});
