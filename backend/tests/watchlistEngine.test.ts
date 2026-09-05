import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAttentionScore,
  computeEventContinuityKey,
  ATTENTION_THRESHOLDS,
} from "../src/services/watchlist/attentionService";
import { evaluateQuoteFreshness } from "../src/services/watchlist/freshnessService";
import { getDemoScenarioSummary } from "../src/services/watchlist/demoScenarioService";
import { formatTimeAway } from "../src/services/watchlist/changeDetectionService";

test("no meaningful change: small 0.1% move is categorized as UNCHANGED with low score", () => {
  const result = calculateAttentionScore({
    priceChangePct: 0.10,
    volumeRatio: 1.0,
    benchmarkAlphaPct: 0.05,
    newEventCount: 0,
  });

  assert.equal(result.significance, "UNCHANGED");
  assert.ok(result.attentionScore < ATTENTION_THRESHOLDS.WORTH_A_LOOK_SCORE);
  assert.ok(result.reasons.some((r) => r.category === "PRICE" && r.significance === "NEUTRAL"));
});

test("boundary condition: 0.99% price movement remains UNCHANGED", () => {
  const result = calculateAttentionScore({
    priceChangePct: 0.99,
    volumeRatio: 1.0,
    benchmarkAlphaPct: 0.0,
    newEventCount: 0,
  });

  assert.equal(result.significance, "UNCHANGED");
  assert.ok(result.attentionScore < 30);
});

test("boundary condition: 1.00% price movement crosses to WORTH_A_LOOK", () => {
  const result = calculateAttentionScore({
    priceChangePct: 1.00,
    volumeRatio: 1.0,
    benchmarkAlphaPct: 0.0,
    newEventCount: 0,
  });

  assert.equal(result.significance, "WORTH_A_LOOK");
});

test("boundary condition: 1.01% price movement is firmly WORTH_A_LOOK", () => {
  const result = calculateAttentionScore({
    priceChangePct: 1.01,
    volumeRatio: 1.0,
    benchmarkAlphaPct: 0.0,
    newEventCount: 0,
  });

  assert.equal(result.significance, "WORTH_A_LOOK");
});

test("boundary condition: 2.49% price movement without extra factors stays WORTH_A_LOOK", () => {
  const result = calculateAttentionScore({
    priceChangePct: 2.49,
    volumeRatio: 1.0,
    benchmarkAlphaPct: 0.0,
    newEventCount: 0,
  });

  assert.equal(result.significance, "WORTH_A_LOOK");
});

test("boundary condition: 2.50% price movement promotes directly to NEEDS_ATTENTION", () => {
  const result = calculateAttentionScore({
    priceChangePct: 2.50,
    volumeRatio: 1.0,
    benchmarkAlphaPct: 0.0,
    newEventCount: 0,
  });

  assert.equal(result.significance, "NEEDS_ATTENTION");
});

test("boundary condition: 2.51% price movement promotes directly to NEEDS_ATTENTION", () => {
  const result = calculateAttentionScore({
    priceChangePct: 2.51,
    volumeRatio: 1.0,
    benchmarkAlphaPct: 0.0,
    newEventCount: 0,
  });

  assert.equal(result.significance, "NEEDS_ATTENTION");
});

test("volume anomaly increases attention score and includes honest checkpoint phrasing", () => {
  const baseline = calculateAttentionScore({
    priceChangePct: 1.2,
    volumeRatio: 1.0,
    benchmarkAlphaPct: 0.0,
    newEventCount: 0,
  });

  const surge = calculateAttentionScore({
    priceChangePct: 1.2,
    volumeRatio: 2.8,
    benchmarkAlphaPct: 0.0,
    newEventCount: 0,
  });

  assert.ok(surge.attentionScore > baseline.attentionScore, "Volume anomaly must increase score");
  const volReason = surge.reasons.find((r) => r.category === "VOLUME");
  assert.ok(volReason);
  assert.match(volReason.label, /since checkpoint/i, "Must use honest checkpoint volume phrasing");
});

test("benchmark relative alpha increases attention score and generates alpha reason", () => {
  const withAlpha = calculateAttentionScore({
    priceChangePct: 3.5,
    volumeRatio: 1.0,
    benchmarkAlphaPct: 2.8, // Stock +3.5% vs NIFTY +0.7%
    newEventCount: 0,
  });

  const bmReason = withAlpha.reasons.find((r) => r.category === "BENCHMARK");
  assert.ok(bmReason);
  assert.match(bmReason.label, /Outperformed NIFTY 50 by \+2.80%/);
  assert.equal(bmReason.significance, "HIGH");
});

test("missing benchmark data is handled gracefully without assuming zero alpha", () => {
  const result = calculateAttentionScore({
    priceChangePct: 2.0,
    volumeRatio: 1.0,
    benchmarkAlphaPct: null,
    newEventCount: 0,
  });

  const bmReason = result.reasons.find((r) => r.category === "BENCHMARK");
  assert.ok(bmReason);
  assert.equal(bmReason.value, "N/A");
  assert.match(bmReason.label, /unavailable/i);
});

test("catalyst events scale score and trigger NEEDS_ATTENTION on 2+ events", () => {
  const result = calculateAttentionScore({
    priceChangePct: 0.5,
    volumeRatio: 1.0,
    benchmarkAlphaPct: 0.0,
    newEventCount: 2,
  });

  assert.equal(result.significance, "NEEDS_ATTENTION");
  const catReason = result.reasons.find((r) => r.category === "CATALYST");
  assert.ok(catReason);
  assert.equal(catReason.value, "2");
});

test("event continuity: small tick variations (+2.8% to +2.9%) retain stable continuity key", () => {
  const key1 = computeEventContinuityKey("RELIANCE", "NEEDS_ATTENTION", 2.82, 1);
  const key2 = computeEventContinuityKey("RELIANCE", "NEEDS_ATTENTION", 2.91, 1);
  assert.equal(key1, key2, "Minor tick variation must preserve event continuity key");

  const keyChanged = computeEventContinuityKey("RELIANCE", "NEEDS_ATTENTION", 4.50, 1);
  assert.notEqual(key1, keyChanged, "Material price step must produce a new continuity key");
});

test("freshness: MARKET_CLOSED is distinguished from STALE", () => {
  // Saturday at 2:00 PM IST (e.g. 2026-09-05T08:30:00Z)
  const saturdayTimestamp = new Date("2026-09-05T08:30:00Z").getTime();
  // Friday closing quote from 22 hours ago
  const fridayClosingQuote = saturdayTimestamp - (22 * 3600 * 1000);

  const evalResult = evaluateQuoteFreshness(fridayClosingQuote, saturdayTimestamp);
  assert.equal(evalResult.state, "MARKET_CLOSED");
  assert.ok(evalResult.canEvaluateConfidently, "Market closing quotes must be valid during weekend");
  assert.doesNotMatch(evalResult.state, /STALE/);
});

test("freshness: quote delay > 30s during active market session is flagged as STALE", () => {
  // Monday at 11:00 AM IST (regular trading hours)
  const mondayTradingTime = new Date("2026-09-07T05:30:00Z").getTime();
  const quoteTimestamp = mondayTradingTime - (45 * 1000); // 45 seconds old

  const evalResult = evaluateQuoteFreshness(quoteTimestamp, mondayTradingTime);
  assert.equal(evalResult.state, "STALE");
  assert.equal(evalResult.canEvaluateConfidently, false);
});

test("demo scenario service produces deterministic isolated evaluation", () => {
  const demo = getDemoScenarioSummary("judge-test");
  assert.equal(demo.ok, true);
  assert.equal(demo.demoActive, true);
  assert.equal(demo.counts.total, 4);
  assert.equal(demo.counts.needsAttention, 1); // RELIANCE (+4.5%, 2.8x vol, +3.5% alpha, catalyst)
  assert.equal(demo.counts.worthALook, 1);     // TCS (-1.7%)
  assert.equal(demo.counts.unchanged, 2);      // INFY (+0.2%), HDFCBANK (0.0%)

  const reliance = demo.groups.needsAttention[0];
  assert.equal(reliance.symbol, "RELIANCE");
  assert.ok(reliance.attentionScore >= 60);
  assert.ok(reliance.reasons.length >= 4);
});

test("formatTimeAway produces clean human durations", () => {
  assert.equal(formatTimeAway(null), "Initial baseline");
  const now = new Date("2026-09-05T12:00:00Z");
  assert.equal(formatTimeAway(new Date("2026-09-05T11:59:45Z"), now), "Just now");
  assert.equal(formatTimeAway(new Date("2026-09-05T11:15:00Z"), now), "45m ago");
  assert.equal(formatTimeAway(new Date("2026-09-05T09:43:00Z"), now), "2h 17m ago");
});
