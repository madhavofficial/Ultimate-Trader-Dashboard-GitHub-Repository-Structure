import { Server } from "socket.io";
import { updateLtpAndBroadcast } from "./portfolioService";
import { evaluateAlertsOnTicks } from "./alertEngine";
import { prisma } from "../db/client";

interface MockInstrument {
  token: number;
  symbol: string;
  price: number;
  volume?: number;
  lastUpdated: number;
}

const mockInstruments = new Map<string, MockInstrument>([
  ["INFY", { token: 1, symbol: "INFY", price: 1520, volume: 820000, lastUpdated: Date.now() }],
  ["RELIANCE", { token: 2, symbol: "RELIANCE", price: 2485, volume: 1450000, lastUpdated: Date.now() }],
  ["TCS", { token: 3, symbol: "TCS", price: 3805, volume: 490000, lastUpdated: Date.now() }],
  ["ASIANPAINT", { token: 4, symbol: "ASIANPAINT", price: 2890, volume: 310000, lastUpdated: Date.now() }],
  ["INDIGO", { token: 5, symbol: "INDIGO", price: 4350, volume: 220000, lastUpdated: Date.now() }],
  ["HDFCBANK", { token: 6, symbol: "HDFCBANK", price: 1620, volume: 1600000, lastUpdated: Date.now() }],
  ["TATAMOTORS", { token: 7, symbol: "TATAMOTORS", price: 980, volume: 890000, lastUpdated: Date.now() }],
  ["ICICIBANK", { token: 8, symbol: "ICICIBANK", price: 1210, volume: 780000, lastUpdated: Date.now() }],
  ["ITC", { token: 9, symbol: "ITC", price: 485, volume: 2100000, lastUpdated: Date.now() }],
  ["SBIN", { token: 10, symbol: "SBIN", price: 815, volume: 1300000, lastUpdated: Date.now() }],
  ["BHARTIARTL", { token: 11, symbol: "BHARTIARTL", price: 1530, volume: 640000, lastUpdated: Date.now() }],
]);

let nextToken = 100;

export async function registerMockSymbol(symbol: string, initialPrice?: number): Promise<MockInstrument> {
  const upper = symbol.toUpperCase().trim();
  const existing = mockInstruments.get(upper);
  if (existing) return existing;

  let price = initialPrice;
  let token = nextToken++;

  try {
    const inst = await prisma.instrument.findFirst({
      where: { tradingsymbol: upper, exchange: "NSE" },
    });
    if (inst) {
      token = inst.instrumentToken;
      if (!price && inst.lastPrice && Number(inst.lastPrice) > 0) {
        price = Number(inst.lastPrice);
      }
    }
  } catch {
    // Database lookup failure falls back gracefully
  }

  if (!price || price <= 0) {
    let hash = 0;
    for (let i = 0; i < upper.length; i++) {
      hash = (hash << 5) - hash + upper.charCodeAt(i);
      hash |= 0;
    }
    price = 400 + (Math.abs(hash) % 2600);
  }

  const newInst: MockInstrument = {
    token,
    symbol: upper,
    price: Number(price.toFixed(2)),
    lastUpdated: Date.now(),
  };

  mockInstruments.set(upper, newInst);
  return newInst;
}

export async function registerAllWatchlistAndHoldingSymbols() {
  try {
    const [watchItems, holdings] = await Promise.all([
      prisma.watchlistItem.findMany({ select: { symbol: true } }),
      prisma.holding.findMany({ select: { symbol: true } }),
    ]);
    const symbols = new Set([
      ...watchItems.map((w) => w.symbol),
      ...holdings.map((h) => h.symbol),
    ]);
    for (const sym of symbols) {
      await registerMockSymbol(sym);
    }
  } catch (err) {
    console.warn("Failed to pre-register watchlist symbols for mock stream", err);
  }
}

export function startMockKiteStream(io: Server) {
  console.log("Starting enhanced mock Kite market stream with dynamic coverage...");
  void registerAllWatchlistAndHoldingSymbols();

  setInterval(() => {
    const now = Date.now();
    const ticks = Array.from(mockInstruments.values()).map((inst) => {
      const pctChange = (Math.random() - 0.495) * 0.003;
      const change = inst.price * pctChange;
      inst.price = Math.max(1, inst.price + change);
      inst.volume = (inst.volume ?? 100000) + Math.floor(Math.random() * 500);
      inst.lastUpdated = now;

      return {
        token: inst.token,
        instrument_token: inst.token,
        symbol: inst.symbol,
        last_price: Number(inst.price.toFixed(2)),
        change: Number(change.toFixed(2)),
        volume: inst.volume,
        volume_traded: inst.volume,
        timestamp: now,
        source: "mock" as const,
      };
    });

    io.emit("tick", ticks);
    void updateLtpAndBroadcast(io, ticks).catch((error) => console.error("Mock portfolio update failed", error));
    void evaluateAlertsOnTicks(io, ticks).catch((error) => console.error("Mock alert evaluation failed", error));
  }, 1000);
}
