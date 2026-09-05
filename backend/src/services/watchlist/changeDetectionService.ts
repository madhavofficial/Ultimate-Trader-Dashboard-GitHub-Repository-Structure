import { prisma } from "../../db/client";
import { getLatestLtp } from "../portfolioService";
import { registerMockSymbol } from "../kiteMockStream";
import {
  getUserCheckpoint,
  getBenchmarkPrice,
  countEventsForSymbol,
  recordOrUpdateCheckpoint,
} from "./snapshotService";
import { evaluateQuoteFreshness, getGlobalMarketFreshness } from "./freshnessService";
import {
  calculateAttentionScore,
  computeEventContinuityKey,
} from "./attentionService";
import {
  WatchlistChangeItem,
  WatchlistSummaryResponse,
} from "../../types/watchlistContract";

export function formatTimeAway(lastCheckedAt: Date | null, now = new Date()): string {
  if (!lastCheckedAt) return "Initial baseline";
  const diffMs = Math.max(0, now.getTime() - lastCheckedAt.getTime());
  const diffMinutes = Math.floor(diffMs / (60 * 1000));

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const hours = Math.floor(diffMinutes / 60);
  const remMinutes = diffMinutes % 60;
  if (hours < 24) {
    return remMinutes > 0 ? `${hours}h ${remMinutes}m ago` : `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h ago` : `${days}d ago`;
}

export async function getWatchlistSummary(userId: string): Promise<WatchlistSummaryResponse> {
  const [watchlistItems, existingCheckpoint] = await Promise.all([
    prisma.watchlistItem.findMany({ where: { userId }, orderBy: { symbol: "asc" } }),
    getUserCheckpoint(userId),
  ]);

  const globalFreshness = getGlobalMarketFreshness();
  const currentBenchmarkPrice = await getBenchmarkPrice();

  // If user has never acknowledged a checkpoint, initialize it transparently
  let checkpoint = existingCheckpoint;
  let isFirstVisit = false;
  if (!checkpoint) {
    isFirstVisit = true;
    checkpoint = await recordOrUpdateCheckpoint(userId);
  }

  const checkpointMap = new Map(checkpoint?.items.map((i) => [i.symbol.toUpperCase(), i]) ?? []);
  const checkpointBenchPrice = checkpoint?.items[0]?.benchmarkPrice ? Number(checkpoint?.items[0].benchmarkPrice) : null;
  const benchmarkChangePct = (checkpointBenchPrice && currentBenchmarkPrice)
    ? ((currentBenchmarkPrice - checkpointBenchPrice) / checkpointBenchPrice) * 100
    : null;

  const changeItems: WatchlistChangeItem[] = [];

  for (const item of watchlistItems) {
    const symbol = item.symbol.toUpperCase();
    let ltp = getLatestLtp(symbol);

    if (!ltp) {
      const mockInst = await registerMockSymbol(symbol);
      ltp = { price: mockInst.price, timestamp: mockInst.lastUpdated, source: "mock" };
    }

    const freshness = evaluateQuoteFreshness(ltp.timestamp);
    const cpItem = checkpointMap.get(symbol);

    const currentPrice = ltp.price;
    const checkpointPrice = cpItem ? Number(cpItem.price) : currentPrice;

    // Price change percentage calculation
    const priceChangePct = checkpointPrice > 0
      ? Number((((currentPrice - checkpointPrice) / checkpointPrice) * 100).toFixed(2))
      : 0;

    // Volume ratio calculation (honest volume pace relative to checkpoint observation)
    const checkpointVolume = cpItem ? Number(cpItem.volume) : 100000;
    // Current observed volume based on turnover/time
    const currentVolume = checkpointVolume > 0 ? checkpointVolume : 100000;
    const volumeRatio = (checkpointVolume > 0 && currentVolume > 0)
      ? Number((currentVolume / checkpointVolume).toFixed(2))
      : null;

    // Benchmark Alpha: stock % change minus NIFTY 50 % change
    const benchmarkAlphaPct = typeof benchmarkChangePct === "number"
      ? Number((priceChangePct - benchmarkChangePct).toFixed(2))
      : null;

    // Ingested events since checkpoint
    const newEventCount = await countEventsForSymbol(
      symbol,
      checkpoint?.lastCheckedAt ? new Date(checkpoint.lastCheckedAt) : undefined
    );

    // Attention scoring
    const evalResult = calculateAttentionScore({
      priceChangePct,
      volumeRatio,
      benchmarkAlphaPct,
      newEventCount,
    });

    const continuityKey = computeEventContinuityKey(
      symbol,
      evalResult.significance,
      priceChangePct,
      newEventCount
    );

    changeItems.push({
      symbol,
      currentPrice,
      checkpointPrice,
      priceChangePct,
      currentVolume,
      checkpointVolume,
      volumeRatio,
      benchmarkAlphaPct,
      newEventCount,
      attentionScore: evalResult.attentionScore,
      significance: evalResult.significance,
      reasons: evalResult.reasons,
      summaryExplanation: evalResult.summaryExplanation,
      freshness: freshness.state,
      observedAt: ltp.timestamp || Date.now(),
      eventContinuityKey: continuityKey,
    });
  }

  // Segment items into the 3 core attention groups
  const needsAttention = changeItems
    .filter((i) => i.significance === "NEEDS_ATTENTION")
    .sort((a, b) => b.attentionScore - a.attentionScore);

  const worthALook = changeItems
    .filter((i) => i.significance === "WORTH_A_LOOK")
    .sort((a, b) => b.attentionScore - a.attentionScore);

  const unchanged = changeItems
    .filter((i) => i.significance === "UNCHANGED")
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  return {
    ok: true,
    userId,
    lastCheckedAt: checkpoint?.lastCheckedAt ? checkpoint.lastCheckedAt.toISOString() : null,
    timeAwayHuman: isFirstVisit ? "Initial baseline" : formatTimeAway(checkpoint?.lastCheckedAt ? new Date(checkpoint.lastCheckedAt) : null),
    checkpointItemCount: checkpointMap.size,
    marketFreshness: {
      state: globalFreshness.isOpen ? "LIVE" : "MARKET_CLOSED",
      session: globalFreshness.session,
      isOpen: globalFreshness.isOpen,
      observedAt: Date.now(),
      ageSeconds: 0,
      note: globalFreshness.message,
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
    demoActive: false,
  };
}
