import { Server } from "socket.io";
import { prisma } from "../db/client";
import { SECTOR_KNOWLEDGE_GRAPH } from "./sentiment";
import { fetchKiteHistoricalCandles } from "./historicalDataService";

export interface TechnicalSnapshot {
  symbol: string;
  ltp: number;
  sma20: number;
  sma50: number;
  rsi: number;
  technicalScore: number; // -1.0 to 1.0
  signalBias: "BULLISH" | "BEARISH" | "NEUTRAL";
}

export function computeRsi(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50; // default neutral
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Number((100 - 100 / (1 + rs)).toFixed(2));
}

export function computeTechnicalIndicators(symbol: string, currentPrice: number, priceHistory: number[]): TechnicalSnapshot {
  const history = priceHistory.length >= 20 ? priceHistory : [currentPrice * 0.98, currentPrice * 0.99, currentPrice];
  const sma20 = history.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, history.length);
  const sma50 = history.slice(-50).reduce((a, b) => a + b, 0) / Math.min(50, history.length);
  const rsi = computeRsi(history);

  let score = 0;
  // Trend score (above SMA20 is bullish, above SMA50 is strong bullish)
  if (currentPrice > sma20) score += 0.4;
  else score -= 0.4;

  if (currentPrice > sma50) score += 0.2;
  else score -= 0.2;

  // RSI Momentum & Reversal score
  if (rsi >= 50 && rsi <= 75) score += 0.2; // Healthy bullish momentum
  else if (rsi < 30) score += 0.3; // Oversold potential bounce
  else if (rsi > 75) score -= 0.2; // Overbought caution
  else if (rsi >= 30 && rsi < 50) score -= 0.2; // Weak bearish drift

  score = Math.max(-1.0, Math.min(1.0, Number(score.toFixed(2))));
  const signalBias = score >= 0.2 ? "BULLISH" : score <= -0.2 ? "BEARISH" : "NEUTRAL";


  return {
    symbol,
    ltp: currentPrice,
    sma20: Number(sma20.toFixed(2)),
    sma50: Number(sma50.toFixed(2)),
    rsi,
    technicalScore: score,
    signalBias,
  };
}

export async function generateCompositeSignalForUser(userId: string, symbol: string, currentPrice: number, io?: Server) {
  // Technical indicators are only calculated from real broker history.
  const candles = userId ? await fetchKiteHistoricalCandles(userId, symbol, "5minute", 50) : [];
  const technical = candles.length >= 20
    ? computeTechnicalIndicators(symbol, currentPrice, candles.map((candle) => candle.close))
    : null;

  // 2. News & Sentiment Score
  const recentEvents = await prisma.event.findMany({
    where: { status: "PROCESSED" },
    orderBy: { occurredAt: "desc" },
    take: 10,
  });

  let sentimentScore = 0;
  let relevantNewsCount = 0;
  let matchedRationale = technical
    ? "Neutral price momentum and steady order book depth."
    : "No technical setup generated: insufficient historical market data.";

  for (const ev of recentEvents) {
    const payload = ev.payload as any;
    if (payload?.primarySymbols?.includes(symbol)) {
      sentimentScore += Number(payload.sentimentScore ?? 0);
      relevantNewsCount++;
      matchedRationale = payload.reasoning ?? payload.title;
    }
  }

  if (relevantNewsCount > 0) {
    sentimentScore = Number((sentimentScore / relevantNewsCount).toFixed(2));
  }

  // 3. Macro / Sector Score
  let macroScore = 0;
  for (const ev of recentEvents) {
    const payload = ev.payload as any;
    const ripple = payload?.rippleImpacts?.find((r: any) => r.symbol === symbol);
    if (ripple) {
      macroScore += ripple.impactDirection === "POSITIVE" ? ripple.strength : -ripple.strength;
      matchedRationale = `Second-order transmission: ${ripple.rationale}`;
    }
  }
  macroScore = Math.max(-1.0, Math.min(1.0, Number(macroScore.toFixed(2))));

  // 4. Weighted Composite Score: 40% Tech + 35% News Sentiment + 25% Macro/Sector
  const compositeScore = technical
    ? Number((0.4 * technical.technicalScore + 0.35 * sentimentScore + 0.25 * macroScore).toFixed(2))
    : Number((0.7 * sentimentScore + 0.3 * macroScore).toFixed(2));

  const direction = compositeScore >= 0.2 ? "BULLISH" : compositeScore <= -0.2 ? "BEARISH" : "NEUTRAL";
  const confidence = Number((0.65 + Math.abs(compositeScore) * 0.3).toFixed(2));

  const signalRecord = await prisma.signal.create({
    data: {
      symbol,
      direction,
      compositeScore,
      technicalScore: technical?.technicalScore ?? null,
      sentimentScore,
      macroScore,
      confidence,
      horizon: "SWING",
      rationale: matchedRationale,
      keyFactors: technical
        ? { sma20: technical.sma20, sma50: technical.sma50, rsi: technical.rsi, sentimentScore, macroScore }
        : { sentimentScore, macroScore, dataQuality: "INSUFFICIENT_HISTORICAL_DATA" },
      status: "ACTIVE",
    },
  });

  if (io) {
    io.emit("signal:created", signalRecord);
  }

  return signalRecord;
}
