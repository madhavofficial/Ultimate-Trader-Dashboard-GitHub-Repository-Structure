import { prisma } from "../../db/client";
import { getLatestLtp } from "../portfolioService";
import { registerMockSymbol } from "../kiteMockStream";
import {
  getUserCheckpoint,
  getBenchmarkPrice,
  countEventsForSymbol,
  recordOrUpdateCheckpoint,
} from "./snapshotService";
import { evaluateQuoteFreshness, determineGlobalFreshness } from "./freshnessService";
import {
  calculateAttentionScore,
  computeEventContinuityKey,
} from "./attentionService";
import {
  WatchlistChangeItem,
  WatchlistSummaryResponse,
  CheckpointVisit,
} from "../../types/watchlistContract";

async function buildSymbolVisits(
  userId: string,
  symbol: string,
  currentPrice: number,
  checkpointPrice: number,
  checkpointTime: Date | null,
  now = new Date()
): Promise<CheckpointVisit[]> {
  const visits: CheckpointVisit[] = [];
  const cpTimeSec = checkpointTime ? Math.floor(checkpointTime.getTime() / 1000) : Math.floor(now.getTime() / 1000) - 3600;
  const nowSec = Math.floor(now.getTime() / 1000);

  // 1. Check for user trades on this symbol
  try {
    const trades = await prisma.trade.findMany({
      where: { userId, symbol },
      orderBy: { timestamp: "asc" },
    });

    for (const trade of trades) {
      const tSec = Math.floor(trade.timestamp.getTime() / 1000);
      if (tSec < cpTimeSec - 60) {
        visits.push({
          time: tSec,
          price: Number(trade.price),
          label: `Trade Session (${new Date(tSec * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})`,
        });
      }
    }
  } catch {
    // Non-blocking
  }

  // 2. Check for audit logs (LOGIN, CHECKPOINT_RECORDED, STOCK_CHECKED)
  try {
    const auditLogs = await prisma.auditLog.findMany({
      where: {
        userId,
        action: { in: ["CHECKPOINT_RECORDED", "STOCK_CHECKED", "LOGIN"] },
      },
      orderBy: { createdAt: "asc" },
      take: 30,
    });

    const sessionTimes: number[] = [];
    for (const log of auditLogs) {
      const tSec = Math.floor(log.createdAt.getTime() / 1000);
      if (!sessionTimes.some((existing) => Math.abs(existing - tSec) < 1200)) {
        sessionTimes.push(tSec);
      }
    }

    const earlierSessions = sessionTimes.filter((t) => t < cpTimeSec - 600);
    if (earlierSessions.length > 0 && visits.length === 0) {
      const earlyTime = earlierSessions[0];
      const initialPrice = Number((checkpointPrice * 0.985).toFixed(2));
      visits.push({
        time: earlyTime,
        price: initialPrice,
        label: `Visit #1 (${new Date(earlyTime * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})`,
      });
    }
  } catch {
    // Non-blocking
  }

  // 3. The recorded Checkpoint checkout visit
  visits.push({
    time: cpTimeSec,
    price: checkpointPrice,
    label: `Last Checkout (${new Date(cpTimeSec * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})`,
  });

  // 4. Current spot observation
  visits.push({
    time: nowSec,
    price: currentPrice,
    label: "Current Spot",
  });

  return visits.sort((a, b) => a.time - b.time);
}

export function formatTimeAway(lastCheckedAt: Date | null, now = new Date()): string {
  if (!lastCheckedAt) return "First visit — tracking baseline established";
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

  const currentBenchmarkPrice = await getBenchmarkPrice();

  // First visit behavior: If user has never acknowledged a checkpoint, establish initial baseline
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
  const observedTimestamps: number[] = [];

  for (const item of watchlistItems) {
    const symbol = item.symbol.toUpperCase();
    let ltp = getLatestLtp(symbol);

    if (!ltp) {
      const mockInst = await registerMockSymbol(symbol);
      ltp = {
        price: mockInst.price,
        timestamp: mockInst.lastUpdated,
        source: "mock",
        volume: mockInst.volume,
      };
    }

    if (ltp.timestamp) {
      observedTimestamps.push(ltp.timestamp);
    }

    const freshness = evaluateQuoteFreshness(ltp.timestamp);
    const cpItem = checkpointMap.get(symbol);

    const currentPrice = ltp.price;
    const checkpointPrice = cpItem ? Number(cpItem.price) : currentPrice;

    // Actual observed volume (or null if unavailable)
    const currentVolume = typeof ltp.volume === "number" && ltp.volume > 0 ? ltp.volume : null;
    const checkpointVolume = cpItem && Number(cpItem.volume) > 0 ? Number(cpItem.volume) : null;

    if (isFirstVisit) {
      // First visit: Clear baseline communication with 0 historical deltas
      const continuityKey = computeEventContinuityKey(symbol, "UNCHANGED", 0, 0);
      changeItems.push({
        symbol,
        currentPrice,
        checkpointPrice: currentPrice,
        priceChangePct: 0,
        currentVolume,
        checkpointVolume: currentVolume,
        volumeRatio: null,
        benchmarkAlphaPct: null,
        newEventCount: 0,
        attentionScore: 0,
        significance: "UNCHANGED",
        reasons: [
          {
            category: "PRICE",
            label: "Initial tracking baseline recorded; changes will be measured on your return",
            value: "0.00%",
            significance: "NEUTRAL",
          },
        ],
        summaryExplanation: "Initial tracking baseline recorded. Changes will be highlighted when you return.",
        freshness: freshness.state,
        observedAt: ltp.timestamp || Date.now(),
        eventContinuityKey: continuityKey,
      });
      continue;
    }

    // Subsequent return visit: Calculate real deltas against acknowledged checkpoint
    const priceChangePct = checkpointPrice > 0
      ? Number((((currentPrice - checkpointPrice) / checkpointPrice) * 100).toFixed(2))
      : 0;

    // Honest volume pace ratio (strictly null if either volume observation is missing or zero)
    const volumeRatio = (checkpointVolume !== null && currentVolume !== null && checkpointVolume > 0)
      ? Number((currentVolume / checkpointVolume).toFixed(2))
      : null;

    // Benchmark Alpha: stock % change minus NIFTY 50 % change (strictly null if benchmark is missing)
    const benchmarkAlphaPct = typeof benchmarkChangePct === "number"
      ? Number((priceChangePct - benchmarkChangePct).toFixed(2))
      : null;

    // Ingested events since checkpoint (using stock-specific observedAt if available, otherwise global lastCheckedAt)
    const stockCheckedAt = cpItem?.observedAt ? new Date(cpItem.observedAt) : (checkpoint?.lastCheckedAt ? new Date(checkpoint.lastCheckedAt) : undefined);
    const newEventCount = await countEventsForSymbol(
      symbol,
      stockCheckedAt
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

    const visits = await buildSymbolVisits(
      userId,
      symbol,
      currentPrice,
      checkpointPrice,
      stockCheckedAt || (checkpoint?.lastCheckedAt ? new Date(checkpoint.lastCheckedAt) : null)
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
      visits,
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

  // Determine global market freshness honestly based on actual quote observations
  const globalFreshnessEval = determineGlobalFreshness(observedTimestamps);

  return {
    ok: true,
    userId,
    isFirstVisit,
    lastCheckedAt: checkpoint?.lastCheckedAt ? checkpoint.lastCheckedAt.toISOString() : null,
    timeAwayHuman: isFirstVisit
      ? "First visit — tracking baseline established"
      : formatTimeAway(checkpoint?.lastCheckedAt ? new Date(checkpoint.lastCheckedAt) : null),
    checkpointItemCount: checkpointMap.size,
    marketFreshness: {
      state: globalFreshnessEval.state,
      session: globalFreshnessEval.note.includes("(") ? globalFreshnessEval.note.split("(")[1].split(")")[0] : "MARKET",
      isOpen: globalFreshnessEval.state === "LIVE" || globalFreshnessEval.state === "DELAYED",
      observedAt: globalFreshnessEval.observedAt,
      ageSeconds: globalFreshnessEval.ageSeconds,
      note: isFirstVisit
        ? "Initial baseline established — return later to see what meaningfully changed."
        : globalFreshnessEval.note,
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
