import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import { AppError } from "../errors/appError";

export async function ensurePortfolioAccount(userId: string) {
  return prisma.portfolioAccount.upsert({ where: { userId }, update: {}, create: { userId } });
}

export async function executePaperTrade(input: { userId: string; symbol: string; qty: number; price: number; side: "BUY" | "SELL" }) {
  await ensurePortfolioAccount(input.userId);
  const price = new Prisma.Decimal(input.price);
  const quantity = new Prisma.Decimal(input.qty);
  const notional = price.mul(quantity);

  return prisma.$transaction(async (tx) => {
    const accountRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "PortfolioAccount" WHERE "userId" = ${input.userId} FOR UPDATE
    `;
    if (!accountRows[0]) throw new AppError(500, "Portfolio account could not be locked");
    const account = await tx.portfolioAccount.findUniqueOrThrow({ where: { id: accountRows[0].id } });
    const holding = await tx.holding.findUnique({ where: { userId_symbol: { userId: input.userId, symbol: input.symbol } } });
    let realizedPnl: Prisma.Decimal | undefined;

    if (input.side === "BUY") {
      if (account.cashBalance.lt(notional)) throw new AppError(400, "Insufficient paper-trading cash");
      const oldQty = holding?.qty ?? 0;
      const newQty = oldQty + input.qty;
      const weightedAverage = holding
        ? new Prisma.Decimal(holding.avg).mul(oldQty).add(notional).div(newQty)
        : price;
      await tx.portfolioAccount.update({ where: { id: account.id }, data: { cashBalance: { decrement: notional } } });
      await tx.holding.upsert({
        where: { userId_symbol: { userId: input.userId, symbol: input.symbol } },
        update: { qty: newQty, avg: weightedAverage },
        create: { userId: input.userId, symbol: input.symbol, qty: input.qty, avg: price },
      });
    } else {
      if (!holding || holding.qty < input.qty) throw new AppError(400, "Insufficient paper-trading holdings");
      realizedPnl = price.sub(holding.avg).mul(quantity);
      await tx.portfolioAccount.update({ where: { id: account.id }, data: { cashBalance: { increment: notional } } });
      const remaining = holding.qty - input.qty;
      if (remaining === 0) await tx.holding.delete({ where: { id: holding.id } });
      else await tx.holding.update({ where: { id: holding.id }, data: { qty: remaining } });
    }

    const trade = await tx.trade.create({
      data: { userId: input.userId, symbol: input.symbol, qty: input.qty, price, side: input.side },
    });
    const updatedAccount = await tx.portfolioAccount.findUniqueOrThrow({ where: { id: account.id } });
    await tx.cashLedgerEntry.create({
      data: {
        userId: input.userId,
        amount: input.side === "BUY" ? notional.neg() : notional,
        balanceAfter: updatedAccount.cashBalance,
        realizedPnl,
        reason: `PAPER_${input.side}`,
        tradeId: trade.id,
      },
    });
    return { trade, account: updatedAccount };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
