import { ChangeSignificance, DeterministicReason } from "../../types/watchlistContract";

export interface AttentionFactors {
  priceChangePct: number;
  volumeRatio: number | null;
  benchmarkAlphaPct: number | null;
  newEventCount: number;
}

export interface AttentionEvaluation {
  attentionScore: number;
  significance: ChangeSignificance;
  reasons: DeterministicReason[];
  summaryExplanation: string;
  factorsNormalized: {
    price: number;
    volume: number;
    benchmark: number;
    catalyst: number;
  };
}

export const ATTENTION_THRESHOLDS = {
  NEEDS_ATTENTION_SCORE: 60,
  WORTH_A_LOOK_SCORE: 30,
  PRICE_SWING_HIGH: 2.5,     // |ΔP%| >= 2.5% promotes directly to NEEDS_ATTENTION
  PRICE_SWING_MEDIUM: 1.0,   // |ΔP%| >= 1.0% promotes directly to WORTH_A_LOOK
  NEW_EVENTS_HIGH: 2,        // >= 2 new corporate/macro events promotes directly
};

/**
 * Normalization formulas:
 * 1. Price Factor: min(1.0, |ΔP%| / 5.0%) -> 5% move reaches full 1.0
 * 2. Volume Factor: min(1.0, max(0, volumeRatio - 1.0) / 2.0) -> 3.0x pace reaches full 1.0
 * 3. Benchmark Alpha Factor: min(1.0, |alpha| / 4.0%) -> 4% divergence reaches full 1.0
 * 4. Catalyst Factor: min(1.0, newEventCount / 2.0) -> 2 new events reach full 1.0
 */
export function calculateAttentionScore(factors: AttentionFactors): AttentionEvaluation {
  const absPriceChange = Math.abs(factors.priceChangePct);

  // 1. Normalized Price Factor (Weight: 40%)
  const priceFactor = Math.min(1.0, absPriceChange / 5.0);

  // 2. Normalized Volume Factor (Weight: 25%)
  let volumeFactor = 0;
  if (typeof factors.volumeRatio === "number" && factors.volumeRatio > 1.0) {
    volumeFactor = Math.min(1.0, (factors.volumeRatio - 1.0) / 2.0);
  }

  // 3. Normalized Benchmark Alpha Factor (Weight: 20%)
  let benchmarkFactor = 0;
  if (typeof factors.benchmarkAlphaPct === "number") {
    benchmarkFactor = Math.min(1.0, Math.abs(factors.benchmarkAlphaPct) / 4.0);
  }

  // 4. Normalized Catalyst Event Factor (Weight: 15%)
  const catalystFactor = Math.min(1.0, Math.max(0, factors.newEventCount) / 2.0);

  // Composite Deterministic Score [0 - 100]
  const rawScore = (40 * priceFactor) + (25 * volumeFactor) + (20 * benchmarkFactor) + (15 * catalystFactor);
  const attentionScore = Math.max(0, Math.min(100, Math.round(rawScore)));

  // Categorization with boundary condition awareness
  let significance: ChangeSignificance = "UNCHANGED";
  if (
    attentionScore >= ATTENTION_THRESHOLDS.NEEDS_ATTENTION_SCORE ||
    absPriceChange >= ATTENTION_THRESHOLDS.PRICE_SWING_HIGH ||
    factors.newEventCount >= ATTENTION_THRESHOLDS.NEW_EVENTS_HIGH
  ) {
    significance = "NEEDS_ATTENTION";
  } else if (
    attentionScore >= ATTENTION_THRESHOLDS.WORTH_A_LOOK_SCORE ||
    absPriceChange >= ATTENTION_THRESHOLDS.PRICE_SWING_MEDIUM
  ) {
    significance = "WORTH_A_LOOK";
  }

  // Generate factual deterministic reasons
  const reasons: DeterministicReason[] = [];

  // Price Reason
  const priceFormatted = `${factors.priceChangePct >= 0 ? "+" : ""}${factors.priceChangePct.toFixed(2)}%`;
  reasons.push({
    category: "PRICE",
    label: `Price moved ${priceFormatted} since last check`,
    value: priceFormatted,
    significance: absPriceChange >= 2.5 ? "HIGH" : absPriceChange >= 1.0 ? "MEDIUM" : "NEUTRAL",
  });

  // Volume Reason (honest phrasing per critique)
  if (typeof factors.volumeRatio === "number" && factors.volumeRatio > 0) {
    const ratioStr = `${factors.volumeRatio.toFixed(1)}×`;
    reasons.push({
      category: "VOLUME",
      label: factors.volumeRatio >= 1.5 
        ? `Volume pace is ${ratioStr} since checkpoint` 
        : `Volume pace steady (${ratioStr} vs checkpoint)`,
      value: ratioStr,
      significance: factors.volumeRatio >= 2.0 ? "HIGH" : factors.volumeRatio >= 1.3 ? "MEDIUM" : "NEUTRAL",
    });
  } else {
    reasons.push({
      category: "VOLUME",
      label: "Checkpoint volume baseline unavailable",
      value: "N/A",
      significance: "NEUTRAL",
    });
  }

  // Benchmark Alpha Reason
  if (typeof factors.benchmarkAlphaPct === "number") {
    const alphaFormatted = `${factors.benchmarkAlphaPct >= 0 ? "+" : ""}${factors.benchmarkAlphaPct.toFixed(2)}%`;
    reasons.push({
      category: "BENCHMARK",
      label: factors.benchmarkAlphaPct >= 0
        ? `Outperformed NIFTY 50 by ${alphaFormatted}`
        : `Underperformed NIFTY 50 by ${alphaFormatted}`,
      value: alphaFormatted,
      significance: Math.abs(factors.benchmarkAlphaPct) >= 2.0 ? "HIGH" : "MEDIUM",
    });
  } else {
    reasons.push({
      category: "BENCHMARK",
      label: "Benchmark (NIFTY 50) comparison unavailable",
      value: "N/A",
      significance: "NEUTRAL",
    });
  }

  // Catalyst Reason
  if (factors.newEventCount > 0) {
    reasons.push({
      category: "CATALYST",
      label: `${factors.newEventCount} new relevant event${factors.newEventCount > 1 ? "s" : ""} recorded since last check`,
      value: `${factors.newEventCount}`,
      significance: factors.newEventCount >= 2 ? "HIGH" : "MEDIUM",
    });
  }

  // Concise synthesized explanation
  let summary = "";
  const volSummary = typeof factors.volumeRatio === "number" && factors.volumeRatio > 0
    ? `checkpoint volume pace ${factors.volumeRatio.toFixed(1)}×`
    : "steady activity";

  if (significance === "NEEDS_ATTENTION") {
    summary = `Significant movement of ${priceFormatted} with ${volSummary}${factors.newEventCount > 0 ? ` and ${factors.newEventCount} new catalyst(s)` : ""}.`;
  } else if (significance === "WORTH_A_LOOK") {
    summary = `Moderate shift of ${priceFormatted} relative to recent baseline.`;
  } else {
    summary = `Price remained steady (${priceFormatted}) since last check.`;
  }

  return {
    attentionScore,
    significance,
    reasons,
    summaryExplanation: summary,
    factorsNormalized: {
      price: Number(priceFactor.toFixed(3)),
      volume: Number(volumeFactor.toFixed(3)),
      benchmark: Number(benchmarkFactor.toFixed(3)),
      catalyst: Number(catalystFactor.toFixed(3)),
    },
  };
}

/**
 * Computes a deterministic response signature used for client/downstream alert deduplication.
 * Bucketing price change to 0.5% intervals prevents spamming new event alerts across sub-tick noise
 * while preserving clear discrete event identity.
 * Note: This produces a stable signature for client-side and webhook deduplication; it does not
 * mutate or claim historical server-side event persistence.
 */
export function computeEventContinuityKey(symbol: string, significance: ChangeSignificance, priceChangePct: number, newEventCount: number): string {
  const bucketedChange = (Math.round(priceChangePct * 2) / 2).toFixed(1);
  return `${symbol.toUpperCase()}:${significance}:${bucketedChange}:${newEventCount}`;
}
