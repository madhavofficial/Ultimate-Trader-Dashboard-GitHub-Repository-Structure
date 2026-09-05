import { WatchlistSummaryResponse, WatchlistChangeItem } from "../../types/watchlistContract";
import { calculateAttentionScore, computeEventContinuityKey } from "./attentionService";

export function getDemoScenarioSummary(userId = "demo-evaluator"): WatchlistSummaryResponse {
  const simulatedTimeAway = "2h 17m ago";
  const simulatedLastCheckedAt = new Date(Date.now() - (2 * 3600 + 17 * 60) * 1000).toISOString();

  // Deterministic Mock Scenario Items
  const rawItems = [
    {
      symbol: "RELIANCE",
      checkpointPrice: 2485.00,
      currentPrice: 2596.80, // +4.50%
      checkpointVolume: 1000000,
      currentVolume: 2800000, // 2.8x volume pace
      benchmarkAlphaPct: 3.50, // +4.50% stock vs +1.00% NIFTY 50
      newEventCount: 1, // Crude oil margin expansion catalyst
    },
    {
      symbol: "TCS",
      checkpointPrice: 3805.00,
      currentPrice: 3740.30, // -1.70%
      checkpointVolume: 500000,
      currentVolume: 520000, // 1.04x volume pace
      benchmarkAlphaPct: -2.70, // -1.70% stock vs +1.00% NIFTY 50
      newEventCount: 0,
    },
    {
      symbol: "INFY",
      checkpointPrice: 1520.00,
      currentPrice: 1523.04, // +0.20%
      checkpointVolume: 800000,
      currentVolume: 810000, // 1.01x volume pace
      benchmarkAlphaPct: -0.80,
      newEventCount: 0,
    },
    {
      symbol: "HDFCBANK",
      checkpointPrice: 1620.00,
      currentPrice: 1620.00, // 0.00%
      checkpointVolume: 1200000,
      currentVolume: 1210000, // 1.00x volume pace
      benchmarkAlphaPct: -1.00,
      newEventCount: 0,
    },
  ];

  const changeItems: WatchlistChangeItem[] = rawItems.map((raw) => {
    const priceChangePct = Number((((raw.currentPrice - raw.checkpointPrice) / raw.checkpointPrice) * 100).toFixed(2));
    const volumeRatio = Number((raw.currentVolume / raw.checkpointVolume).toFixed(2));

    const evalResult = calculateAttentionScore({
      priceChangePct,
      volumeRatio,
      benchmarkAlphaPct: raw.benchmarkAlphaPct,
      newEventCount: raw.newEventCount,
    });

    const continuityKey = computeEventContinuityKey(
      raw.symbol,
      evalResult.significance,
      priceChangePct,
      raw.newEventCount
    );

    return {
      symbol: raw.symbol,
      currentPrice: raw.currentPrice,
      checkpointPrice: raw.checkpointPrice,
      priceChangePct,
      currentVolume: raw.currentVolume,
      checkpointVolume: raw.checkpointVolume,
      volumeRatio,
      benchmarkAlphaPct: raw.benchmarkAlphaPct,
      newEventCount: raw.newEventCount,
      attentionScore: evalResult.attentionScore,
      significance: evalResult.significance,
      reasons: evalResult.reasons,
      summaryExplanation: evalResult.summaryExplanation,
      freshness: "LIVE",
      observedAt: Date.now(),
      eventContinuityKey: continuityKey,
    };
  });

  const needsAttention = changeItems.filter((i) => i.significance === "NEEDS_ATTENTION");
  const worthALook = changeItems.filter((i) => i.significance === "WORTH_A_LOOK");
  const unchanged = changeItems.filter((i) => i.significance === "UNCHANGED");

  return {
    ok: true,
    userId,
    lastCheckedAt: simulatedLastCheckedAt,
    timeAwayHuman: simulatedTimeAway,
    checkpointItemCount: changeItems.length,
    marketFreshness: {
      state: "LIVE",
      session: "REGULAR_SESSION",
      isOpen: true,
      observedAt: Date.now(),
      ageSeconds: 1,
      note: "Deterministic evaluation scenario active — 2h 17m elapsed simulation.",
    },
    counts: {
      total: changeItems.length,
      needsAttention: needsAttention.length,
      worthALook: worthALook.length,
      unchanged: unchanged.length,
    },
    groups: {
      needsAttention,
      worthALook,
      unchanged,
    },
    demoActive: true,
  };
}
