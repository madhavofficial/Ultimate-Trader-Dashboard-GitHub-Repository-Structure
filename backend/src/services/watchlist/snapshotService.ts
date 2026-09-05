import { prisma } from "../../db/client";
import { getLatestLtp } from "../portfolioService";
import { registerMockSymbol } from "../kiteMockStream";

export interface CapturedSymbolState {
  symbol: string;
  price: number;
  volume: bigint;
  benchmarkPrice: number | null;
  sentiment: number | null;
  eventCount: number;
  observedAt: Date;
}

export async function countEventsForSymbol(symbol: string, sinceDate?: Date): Promise<number> {
  try {
    const events = await prisma.event.findMany({
      where: sinceDate ? { ingestedAt: { gte: sinceDate } } : undefined,
      select: { payload: true },
      take: 150,
    });
    const upper = symbol.toUpperCase();
    let count = 0;
    for (const evt of events) {
      const p = evt.payload as any;
      if (Array.isArray(p?.primarySymbols) && p.primarySymbols.includes(upper)) {
        count++;
      } else if (typeof p?.title === "string" && p.title.toUpperCase().includes(upper)) {
        count++;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

export async function getBenchmarkPrice(): Promise<number | null> {
  const ltp = getLatestLtp("NIFTY 50") ?? getLatestLtp("NIFTY");
  if (ltp && ltp.price > 0) return ltp.price;

  try {
    const inst = await prisma.instrument.findFirst({
      where: { tradingsymbol: { in: ["NIFTY 50", "NIFTY"] } },
      select: { lastPrice: true },
    });
    if (inst?.lastPrice && Number(inst.lastPrice) > 0) {
      return Number(inst.lastPrice);
    }
  } catch {
    // Database lookup failure falls back gracefully
  }

  // Missing benchmark data must remain null per requirement
  return null;
}

export async function captureCurrentWatchlistState(userId: string): Promise<CapturedSymbolState[]> {
  const watchlist = await prisma.watchlistItem.findMany({
    where: { userId },
    orderBy: { symbol: "asc" },
  });

  if (watchlist.length === 0) return [];

  const benchmarkPrice = await getBenchmarkPrice();
  const states: CapturedSymbolState[] = [];

  for (const item of watchlist) {
    const upper = item.symbol.toUpperCase();
    let ltp = getLatestLtp(upper);

    if (!ltp) {
      const mockInst = await registerMockSymbol(upper);
      ltp = { price: mockInst.price, timestamp: mockInst.lastUpdated, source: "mock", volume: mockInst.volume };
    }

    const eventCount = await countEventsForSymbol(upper);

    // Actual observed volume or 0 if unavailable
    const volumeBigInt = typeof ltp.volume === "number" && ltp.volume > 0 ? BigInt(ltp.volume) : BigInt(0);

    states.push({
      symbol: upper,
      price: ltp.price,
      volume: volumeBigInt,
      benchmarkPrice,
      sentiment: null,
      eventCount,
      observedAt: new Date(ltp.timestamp || Date.now()),
    });
  }

  return states;
}

export async function getUserCheckpoint(userId: string) {
  return prisma.watchlistCheckpoint.findUnique({
    where: { userId },
    include: {
      items: {
        orderBy: { symbol: "asc" },
      },
    },
  });
}

export async function recordOrUpdateCheckpoint(userId: string) {
  const capturedStates = await captureCurrentWatchlistState(userId);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const checkpoint = await tx.watchlistCheckpoint.upsert({
      where: { userId },
      create: {
        userId,
        lastCheckedAt: now,
      },
      update: {
        lastCheckedAt: now,
      },
    });

    // Replace checkpoint items for a consistent atomic observation
    await tx.watchlistCheckpointItem.deleteMany({
      where: { checkpointId: checkpoint.id },
    });

    if (capturedStates.length > 0) {
      await tx.watchlistCheckpointItem.createMany({
        data: capturedStates.map((s) => ({
          checkpointId: checkpoint.id,
          symbol: s.symbol,
          price: s.price,
          volume: s.volume,
          benchmarkPrice: s.benchmarkPrice,
          sentiment: s.sentiment,
          eventCount: s.eventCount,
          observedAt: s.observedAt,
        })),
      });
    }

    return tx.watchlistCheckpoint.findUnique({
      where: { id: checkpoint.id },
      include: { items: true },
    });
  });
}
