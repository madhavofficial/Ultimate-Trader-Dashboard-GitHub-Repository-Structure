import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import { AppError } from "../errors/appError";
import { writeAuditLog } from "./auditLog";
import { SECTOR_KNOWLEDGE_GRAPH } from "./sentiment";

export async function ensureRiskSettings(userId: string) {
  return prisma.riskSettings.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
}

export async function toggleKillSwitch(userId: string, active: boolean, reason?: string) {
  const settings = await prisma.riskSettings.upsert({
    where: { userId },
    update: { killSwitchActive: active },
    create: { userId, killSwitchActive: active },
  });

  await writeAuditLog({
    userId,
    action: active ? "KILL_SWITCH_ACTIVATED" : "KILL_SWITCH_DEACTIVATED",
    entityType: "RiskSettings",
    entityId: settings.id,
    metadata: { killSwitchActive: active, reason: reason ?? "User manual toggle" },
  });

  return settings;
}

export async function validatePreTradeRisk(input: {
  userId: string;
  symbol: string;
  qty: number;
  price: number;
  side: "BUY" | "SELL";
}) {
  const settings = await ensureRiskSettings(input.userId);
  const notional = new Prisma.Decimal(input.price).mul(input.qty);

  // 1. Kill Switch Check
  if (settings.killSwitchActive) {
    throw new AppError(403, "Risk Kill Switch is active. All order placement is currently frozen.");
  }

  // 2. Max Position Size / Order Value Cap
  if (notional.gt(settings.maxPositionSize)) {
    throw new AppError(
      400,
      `Order value ₹${notional.toNumber().toLocaleString("en-IN")} exceeds maximum position size limit of ₹${Number(settings.maxPositionSize).toLocaleString("en-IN")}`
    );
  }

  // 3. Max Daily Drawdown Check
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const todaysLedger = await prisma.cashLedgerEntry.findMany({
    where: {
      userId: input.userId,
      createdAt: { gte: startOfDay },
      realizedPnl: { not: null },
    },
  });

  const cumulativeRealizedLoss = todaysLedger.reduce((sum, entry) => {
    const pnl = Number(entry.realizedPnl ?? 0);
    return pnl < 0 ? sum + Math.abs(pnl) : sum;
  }, 0);

  if (cumulativeRealizedLoss >= Number(settings.maxDailyLoss)) {
    // Auto-trip the kill switch to prevent further capital erosion
    await toggleKillSwitch(input.userId, true, `Auto-tripped: Daily loss of ₹${cumulativeRealizedLoss} reached max threshold ₹${settings.maxDailyLoss}`);
    throw new AppError(
      403,
      `Daily loss limit of ₹${Number(settings.maxDailyLoss).toLocaleString("en-IN")} reached. Trading auto-frozen by risk engine.`
    );
  }

  // 4. Sector Concentration Check (on BUY)
  if (input.side === "BUY") {
    let targetSector = "General";
    for (const [key, data] of Object.entries(SECTOR_KNOWLEDGE_GRAPH)) {
      if (data.directSymbols.includes(input.symbol)) {
        targetSector = data.sector;
        break;
      }
    }

    const [account, allHoldings] = await Promise.all([
      prisma.portfolioAccount.findUnique({ where: { userId: input.userId } }),
      prisma.holding.findMany({ where: { userId: input.userId } }),
    ]);

    const cash = account ? Number(account.cashBalance) : 1000000;
    const totalInvested = allHoldings.reduce((sum, h) => sum + Number(h.avg) * h.qty, 0);
    const totalPortfolioCapital = cash + totalInvested;

    // Calculate current exposure in target sector
    let currentSectorExposure = 0;
    for (const h of allHoldings) {
      let hSector = "General";
      for (const [_, data] of Object.entries(SECTOR_KNOWLEDGE_GRAPH)) {
        if (data.directSymbols.includes(h.symbol)) {
          hSector = data.sector;
          break;
        }
      }
      if (hSector === targetSector) {
        currentSectorExposure += Number(h.avg) * h.qty;
      }
    }

    const newSectorExposure = currentSectorExposure + notional.toNumber();
    const sectorExposurePct = (newSectorExposure / totalPortfolioCapital) * 100;

    if (sectorExposurePct > settings.maxSectorExposurePct && totalPortfolioCapital > 50000) {
      throw new AppError(
        400,
        `Sector exposure to "${targetSector}" would reach ${sectorExposurePct.toFixed(1)}%, exceeding risk limit of ${settings.maxSectorExposurePct}%`
      );
    }
  }

  return { passed: true };
}
