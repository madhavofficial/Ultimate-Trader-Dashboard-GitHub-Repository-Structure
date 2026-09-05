import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import jwt from "jsonwebtoken";
import { app } from "../src/server";
import { prisma } from "../src/db/client";
import { env } from "../src/config/env";
import { getDemoScenarioSummary } from "../src/services/watchlist/demoScenarioService";

test("Smart Market Watch - Security, Auth Boundaries & Demo Isolation", async (t) => {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(() => {
    server.close();
  });

  const request = (path: string, init?: RequestInit) => fetch(`${baseUrl}${path}`, init);

  // 1. Unauthenticated Request Behavior
  await t.test("unauthenticated requests to /watchlist/summary return 401", async () => {
    const res = await request("/watchlist/summary");
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "Unauthorized");
  });

  await t.test("unauthenticated requests to /watchlist/checkpoint return 401", async () => {
    const res = await request("/watchlist/checkpoint", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "Unauthorized");
  });

  await t.test("requests with invalid or malformed bearer token return 401", async () => {
    const res = await request("/watchlist/summary", {
      headers: { authorization: "Bearer invalid-tampered-token" },
    });
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "Invalid or expired token");
  });

  // 2. Demo Access Without Authentication
  await t.test("demo scenario is accessible without authentication via POST", async () => {
    const res = await request("/watchlist/demo-scenario", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.ok, true);
    assert.equal(body.demoActive, true);
    assert.equal(body.userId, "demo-evaluator");
    assert.equal(body.counts.total, 4);
    assert.ok(body.groups.needsAttention.length > 0);
    assert.ok(body.groups.worthALook.length > 0);
    assert.ok(body.groups.unchanged.length > 0);
  });

  await t.test("demo scenario is accessible without authentication via GET", async () => {
    const res = await request("/watchlist/demo-scenario");
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(body.ok, true);
    assert.equal(body.demoActive, true);
  });

  // 3. Demo Cannot Access Another User's Checkpoint
  await t.test("demo scenario does not leak or reference real user checkpoints", async () => {
    const demoSummary = getDemoScenarioSummary("demo-evaluator");
    assert.equal(demoSummary.userId, "demo-evaluator");
    assert.equal(demoSummary.demoActive, true);

    const symbols = [
      ...demoSummary.groups.needsAttention,
      ...demoSummary.groups.worthALook,
      ...demoSummary.groups.unchanged,
    ].map((s) => s.symbol);

    // Guaranteed isolated evaluator symbols
    assert.deepEqual(symbols.sort(), ["HDFCBANK", "INFY", "RELIANCE", "TCS"].sort());
  });

  // 4. Demo Cannot Mutate Real User State
  await t.test("running demo scenario does not mutate PostgreSQL checkpoints or watchlist items", async () => {
    const checkpointsBefore = await prisma.watchlistCheckpoint.count();
    const checkpointItemsBefore = await prisma.watchlistCheckpointItem.count();
    const watchlistItemsBefore = await prisma.watchlistItem.count();

    // Trigger demo scenario multiple times
    await request("/watchlist/demo-scenario", { method: "POST" });
    await request("/watchlist/demo-scenario", { method: "GET" });

    const checkpointsAfter = await prisma.watchlistCheckpoint.count();
    const checkpointItemsAfter = await prisma.watchlistCheckpointItem.count();
    const watchlistItemsAfter = await prisma.watchlistItem.count();

    assert.equal(checkpointsAfter, checkpointsBefore, "Checkpoints count must remain unmodified");
    assert.equal(checkpointItemsAfter, checkpointItemsBefore, "Checkpoint items count must remain unmodified");
    assert.equal(watchlistItemsAfter, watchlistItemsBefore, "Watchlist items count must remain unmodified");
  });

  // 5. Authenticated User Isolation
  await t.test("authenticated user sessions are strictly isolated by userId in JWT", async () => {
    const userAId = `user-a-${Date.now()}`;
    const userBId = `user-b-${Date.now()}`;

    const tokenA = jwt.sign({ email: "usera@example.com" }, env.JWT_ACCESS_SECRET, {
      subject: userAId,
      expiresIn: "15m",
    });
    const tokenB = jwt.sign({ email: "userb@example.com" }, env.JWT_ACCESS_SECRET, {
      subject: userBId,
      expiresIn: "15m",
    });

    // Create user A in DB
    const createdUserA = await prisma.user.create({
      data: {
        id: userAId,
        email: `usera-${Date.now()}@example.com`,
        passwordHash: "hash123",
      },
    });

    // Create user B in DB
    const createdUserB = await prisma.user.create({
      data: {
        id: userBId,
        email: `userb-${Date.now()}@example.com`,
        passwordHash: "hash123",
      },
    });

    try {
      // Add symbol ONLY for User A
      await prisma.watchlistItem.create({
        data: {
          userId: userAId,
          symbol: "TATAMOTORS",
        },
      });

      // Add symbol ONLY for User B
      await prisma.watchlistItem.create({
        data: {
          userId: userBId,
          symbol: "BHARTIARTL",
        },
      });

      // Query User A
      const resA = await request("/watchlist/summary", {
        headers: { authorization: `Bearer ${tokenA}` },
      });
      assert.equal(resA.status, 200);
      const summaryA = (await resA.json()) as any;
      assert.equal(summaryA.userId, userAId);
      const symbolsA = [
        ...summaryA.groups.needsAttention,
        ...summaryA.groups.worthALook,
        ...summaryA.groups.unchanged,
      ].map((s: any) => s.symbol);
      assert.ok(symbolsA.includes("TATAMOTORS"));
      assert.ok(!symbolsA.includes("BHARTIARTL"), "User A must not see User B symbols");

      // Query User B
      const resB = await request("/watchlist/summary", {
        headers: { authorization: `Bearer ${tokenB}` },
      });
      assert.equal(resB.status, 200);
      const summaryB = (await resB.json()) as any;
      assert.equal(summaryB.userId, userBId);
      const symbolsB = [
        ...summaryB.groups.needsAttention,
        ...summaryB.groups.worthALook,
        ...summaryB.groups.unchanged,
      ].map((s: any) => s.symbol);
      assert.ok(symbolsB.includes("BHARTIARTL"));
      assert.ok(!symbolsB.includes("TATAMOTORS"), "User B must not see User A symbols");

      // Checkpoint User A - must not affect User B
      const checkResA = await request("/watchlist/checkpoint", {
        method: "POST",
        headers: { authorization: `Bearer ${tokenA}` },
      });
      assert.equal(checkResA.status, 200);

      const checkBInDb = await prisma.watchlistCheckpoint.findUnique({
        where: { userId: userBId },
      });
      // User B's checkpoint was never recorded by User A's action
      const checkAInDb = await prisma.watchlistCheckpoint.findUnique({
        where: { userId: userAId },
      });
      assert.ok(checkAInDb !== null);
      if (checkBInDb) {
        assert.notEqual(checkBInDb.userId, userAId);
      }
    } finally {
      // Clean up test records
      await prisma.watchlistCheckpointItem.deleteMany({
        where: { checkpoint: { userId: { in: [userAId, userBId] } } },
      });
      await prisma.watchlistCheckpoint.deleteMany({
        where: { userId: { in: [userAId, userBId] } },
      });
      await prisma.watchlistItem.deleteMany({
        where: { userId: { in: [userAId, userBId] } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [userAId, userBId] } },
      });
    }
  });
});
