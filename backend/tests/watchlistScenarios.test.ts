import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { app } from "../src/server";
import { applyMarketScenario, getCurrentScenarioName } from "../src/services/watchlist/scenarioController";
import { getLatestLtp } from "../src/services/portfolioService";
import { evaluateQuoteFreshness } from "../src/services/watchlist/freshnessService";
import { getDemoScenarioSummary } from "../src/services/watchlist/demoScenarioService";

test("Smart Market Watch - Deterministic Scenario Controller & Simulation", async (t) => {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    // Reset to baseline cleanly on cleanup
    await applyMarketScenario("baseline");
    server.close();
  });

  const request = (path: string, init?: RequestInit) => fetch(`${baseUrl}${path}`, init);

  await t.test("scenario: baseline resets instruments, streams active, and establishes benchmark", async () => {
    const res = await applyMarketScenario("baseline");
    assert.equal(res.scenario, "baseline");
    assert.equal(res.mockStreamActive, true);
    assert.equal(getCurrentScenarioName(), "baseline");

    const nifty = getLatestLtp("NIFTY 50");
    assert.ok(nifty);
    assert.equal(nifty.price, 24500);

    const rel = getLatestLtp("RELIANCE");
    assert.ok(rel);
    assert.equal(rel.price, 2485);
    assert.equal(rel.volume, 1450000);
  });

  await t.test("scenario: big_move pushes divergence to ltpMap with NIFTY 50 update", async () => {
    const res = await applyMarketScenario("big_move");
    assert.equal(res.scenario, "big_move");

    const tata = getLatestLtp("TATAMOTORS");
    assert.ok(tata);
    assert.equal(tata.price, 1025.0); // +4.59% move from 980 baseline

    const infy = getLatestLtp("INFY");
    assert.ok(infy);
    assert.equal(infy.price, 1475.0); // -2.96% drop from 1520 baseline

    const nifty = getLatestLtp("NIFTY 50");
    assert.ok(nifty);
    assert.equal(nifty.price, 24550.0);
  });

  await t.test("scenario: volume_spike injects institutional volume anomaly into ltpMap", async () => {
    const res = await applyMarketScenario("volume_spike");
    assert.equal(res.scenario, "volume_spike");

    const rel = getLatestLtp("RELIANCE");
    assert.ok(rel);
    assert.equal(rel.volume, 4200000); // 2.90x baseline volume
    assert.equal(rel.price, 2515.0);

    const tcs = getLatestLtp("TCS");
    assert.ok(tcs);
    assert.equal(tcs.volume, 1380000); // 2.82x baseline volume
  });

  await t.test("scenario: stale pauses feed and injects backdated ticks evaluated as STALE", async () => {
    const res = await applyMarketScenario("stale");
    assert.equal(res.scenario, "stale");
    assert.equal(res.mockStreamActive, false);

    const infy = getLatestLtp("INFY");
    assert.ok(infy);
    const freshness = evaluateQuoteFreshness(infy.timestamp);
    assert.equal(freshness.state, "STALE");
    assert.equal(freshness.canEvaluateConfidently, false);
  });

  await t.test("scenario: market_closed pauses stream and evaluates confidently as MARKET_CLOSED", async () => {
    const res = await applyMarketScenario("market_closed");
    assert.equal(res.scenario, "market_closed");
    assert.equal(res.mockStreamActive, false);
    assert.equal(res.marketSession, "CLOSED");

    const tata = getLatestLtp("TATAMOTORS");
    assert.ok(tata);
    const freshness = evaluateQuoteFreshness(tata.timestamp);
    assert.equal(freshness.state, "MARKET_CLOSED");
    assert.equal(freshness.canEvaluateConfidently, true);
  });

  await t.test("scenario: unchanged holds prices and volumes in neutral bracket", async () => {
    const res = await applyMarketScenario("unchanged");
    assert.equal(res.scenario, "unchanged");

    const tata = getLatestLtp("TATAMOTORS");
    assert.ok(tata);
    assert.ok(Math.abs(tata.price - 980) < 5); // tightly bound to baseline
  });

  // HTTP Endpoint Tests
  await t.test("POST /watchlist/scenario/big_move applies scenario without auth", async () => {
    const res = await request("/watchlist/scenario/big_move", { method: "POST" });
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.ok, true);
    assert.equal(body.scenario, "big_move");
  });

  await t.test("GET /watchlist/scenario returns current active scenario", async () => {
    const res = await request("/watchlist/scenario");
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.ok, true);
    assert.equal(body.activeScenario, "big_move");
    assert.ok(Array.isArray(body.supportedScenarios));
    assert.ok(body.supportedScenarios.includes("volume_spike"));
  });

  await t.test("POST /watchlist/demo-scenario?scenario=volume_spike returns parameterized fixture", async () => {
    const res = await request("/watchlist/demo-scenario?scenario=volume_spike", { method: "POST" });
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.ok, true);
    const rel = body.groups.needsAttention.find((i: any) => i.symbol === "RELIANCE")
      || body.groups.worthALook.find((i: any) => i.symbol === "RELIANCE");
    assert.ok(rel);
    assert.equal(rel.volumeRatio, 2.9);
  });

  await t.test("POST /watchlist/demo-scenario?scenario=stale reflects STALE freshness", async () => {
    const res = await request("/watchlist/demo-scenario?scenario=stale", { method: "POST" });
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.marketFreshness.state, "STALE");
    assert.equal(body.groups.needsAttention[0]?.freshness ?? body.groups.worthALook[0]?.freshness, "STALE");
  });
});
