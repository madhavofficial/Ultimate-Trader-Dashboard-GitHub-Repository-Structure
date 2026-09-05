import { Server } from "socket.io";
import { prisma } from "../db/client";
import { symbolsForTokens } from "./instrumentService";
import { userRoom } from "./socketRooms";

type IncomingTick = { symbol?: string; token?: number; instrument_token?: number; last_price: number; timestamp?: number; source?: string; volume?: number; volume_traded?: number };
const ltpMap = new Map<string, { price: number; timestamp: number; source?: string; volume?: number }>();

export function getLatestLtp(symbol: string) {
  return ltpMap.get(symbol.toUpperCase());
}

export function getAllLatestLtps() {
  return ltpMap;
}

export async function updateLtpAndBroadcast(io: Server, ticks: IncomingTick[], onlyUserId?: string) {
  const tokenIds = ticks.map((tick) => tick.instrument_token ?? tick.token).filter((token): token is number => typeof token === "number");
  const tokenSymbols = tokenIds.length > 0 ? await symbolsForTokens(tokenIds) : new Map<number, string>();
  const symbols = new Set<string>();

  for (const tick of ticks) {
    const symbol = tick.symbol ?? (tick.instrument_token || tick.token ? tokenSymbols.get(tick.instrument_token ?? tick.token!) : undefined);
    if (!symbol || !Number.isFinite(tick.last_price) || tick.last_price <= 0) continue;
    const vol = typeof (tick as any).volume_traded === "number"
      ? (tick as any).volume_traded
      : typeof tick.volume === "number"
      ? tick.volume
      : undefined;
    ltpMap.set(symbol, { price: tick.last_price, timestamp: tick.timestamp ?? Date.now(), source: tick.source ?? "stream", volume: vol });
    symbols.add(symbol);
  }
  if (symbols.size === 0) return;

  const holdings = await prisma.holding.findMany({ where: { symbol: { in: [...symbols] }, ...(onlyUserId ? { userId: onlyUserId } : {}) } });
  const userIds = [...new Set(holdings.map((holding) => holding.userId))];
  await Promise.all(userIds.map(async (userId) => {
    const snapshot = await getPortfolioSnapshot(userId);
    io.to(userRoom(userId)).emit("portfolio:update", snapshot);
  }));
}

export async function getPortfolioSnapshot(userId: string) {
  const [account, holdings] = await Promise.all([
    prisma.portfolioAccount.findUnique({ where: { userId } }),
    prisma.holding.findMany({ where: { userId }, orderBy: { symbol: "asc" } }),
  ]);

  const rows = holdings.map((holding) => {
    const averagePrice = Number(holding.avg);
    const ltp = ltpMap.get(holding.symbol);
    const lastPrice = ltp?.price ?? averagePrice;
    const investedValue = averagePrice * holding.qty;
    const currentValue = lastPrice * holding.qty;
    return {
      symbol: holding.symbol,
      quantity: holding.qty,
      averagePrice,
      lastPrice,
      investedValue,
      currentValue,
      unrealizedPnl: currentValue - investedValue,
      priceTimestamp: ltp?.timestamp ?? null,
    };
  });

  return {
    cashBalance: account ? Number(account.cashBalance) : 0,
    reservedMargin: account ? Number(account.reservedMargin) : 0,
    holdings: rows,
    totalInvestedValue: rows.reduce((sum, row) => sum + row.investedValue, 0),
    totalCurrentValue: rows.reduce((sum, row) => sum + row.currentValue, 0),
    totalUnrealizedPnl: rows.reduce((sum, row) => sum + row.unrealizedPnl, 0),
  };
}
