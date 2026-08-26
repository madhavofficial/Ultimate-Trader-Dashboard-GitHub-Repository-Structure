import { prisma } from "../db/client";
import { calculateStatutoryCharges } from "./marketHoursService";
import { SECTOR_KNOWLEDGE_GRAPH } from "./sentiment";

export interface AnalyticsSummary {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  grossRealizedPnl: number;
  estimatedStatutoryCharges: number;
  netRealizedPnl: number;
  profitFactor: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  sectorBreakdown: Array<{
    sector: string;
    tradeCount: number;
    pnl: number;
  }>;
}

export async function computeUserAnalytics(userId: string): Promise<AnalyticsSummary> {
  const [ledgerEntries, trades] = await Promise.all([
    prisma.cashLedgerEntry.findMany({
      where: { userId, realizedPnl: { not: null } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.trade.findMany({
      where: { userId },
      orderBy: { timestamp: "desc" },
    }),
  ]);

  let winningTrades = 0;
  let losingTrades = 0;
  let totalGains = 0;
  let totalLosses = 0;
  let grossPnl = 0;
  let peakPnl = 0;
  let maxDrawdown = 0;

  const returns: number[] = [];

  for (const entry of ledgerEntries) {
    const pnl = Number(entry.realizedPnl ?? 0);
    grossPnl += pnl;
    returns.push(pnl);

    if (pnl > 0) {
      winningTrades++;
      totalGains += pnl;
    } else if (pnl < 0) {
      losingTrades++;
      totalLosses += Math.abs(pnl);
    }

    if (grossPnl > peakPnl) peakPnl = grossPnl;
    const currentDrawdown = peakPnl > 0 ? (peakPnl - grossPnl) / peakPnl : 0;
    if (currentDrawdown > maxDrawdown) maxDrawdown = currentDrawdown;
  }

  const totalTrades = winningTrades + losingTrades;
  const winRatePct = totalTrades > 0 ? Number(((winningTrades / totalTrades) * 100).toFixed(1)) : 0;
  const profitFactor = totalLosses > 0 ? Number((totalGains / totalLosses).toFixed(2)) : totalGains > 0 ? 99.0 : 0.0;

  // Calculate estimated total statutory taxes on trade turnover
  let totalTurnover = 0;
  for (const t of trades) {
    totalTurnover += Number(t.price) * t.qty;
  }
  const taxSummary = calculateStatutoryCharges(totalTurnover, true, false);
  const netPnl = grossPnl - taxSummary.totalCharges;

  // Sharpe Ratio estimation: Mean return / Standard deviation of returns
  let sharpeRatio = 0;
  if (returns.length >= 2) {
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
    const stdDev = Math.sqrt(variance);
    if (stdDev > 0) {
      sharpeRatio = Number(((mean / stdDev) * Math.sqrt(252)).toFixed(2));
    }
  }

  // Sector-wise PnL Breakdown
  const sectorMap = new Map<string, { count: number; pnl: number }>();
  for (const t of trades) {
    let sector = "General Equities";
    for (const [_, data] of Object.entries(SECTOR_KNOWLEDGE_GRAPH)) {
      if (data.directSymbols.includes(t.symbol)) {
        sector = data.sector;
        break;
      }
    }

    const prev = sectorMap.get(sector) ?? { count: 0, pnl: 0 };
    sectorMap.set(sector, { count: prev.count + 1, pnl: prev.pnl });
  }

  const sectorBreakdown = Array.from(sectorMap.entries()).map(([sector, val]) => ({
    sector,
    tradeCount: val.count,
    pnl: Number(val.pnl.toFixed(2)),
  }));

  return {
    totalTrades,
    winningTrades,
    losingTrades,
    winRatePct,
    grossRealizedPnl: Number(grossPnl.toFixed(2)),
    estimatedStatutoryCharges: taxSummary.totalCharges,
    netRealizedPnl: Number(netPnl.toFixed(2)),
    profitFactor,
    maxDrawdownPct: Number((maxDrawdown * 100).toFixed(1)),
    sharpeRatio,
    sectorBreakdown,
  };
}
