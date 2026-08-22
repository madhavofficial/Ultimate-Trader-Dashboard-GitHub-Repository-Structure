import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";

test("weighted average price calculation on buying more shares", () => {
  const existingQty = 10;
  const existingAvg = new Prisma.Decimal(1500);
  const buyQty = 5;
  const buyPrice = new Prisma.Decimal(1650);

  const totalQty = existingQty + buyQty;
  const totalNotional = existingAvg.mul(existingQty).add(buyPrice.mul(buyQty));
  const newAvg = totalNotional.div(totalQty);

  assert.equal(totalQty, 15);
  assert.equal(newAvg.toNumber(), 1550);
});

test("unrealized PnL calculation on portfolio holdings", () => {
  const quantity = 20;
  const averagePrice = 2500;
  const ltp = 2650;

  const investedValue = averagePrice * quantity;
  const currentValue = ltp * quantity;
  const unrealizedPnl = currentValue - investedValue;

  assert.equal(investedValue, 50000);
  assert.equal(currentValue, 53000);
  assert.equal(unrealizedPnl, 3000);
});

test("negative unrealized PnL calculation when LTP drops", () => {
  const quantity = 10;
  const averagePrice = 3800;
  const ltp = 3650;

  const investedValue = averagePrice * quantity;
  const currentValue = ltp * quantity;
  const unrealizedPnl = currentValue - investedValue;

  assert.equal(investedValue, 38000);
  assert.equal(currentValue, 36500);
  assert.equal(unrealizedPnl, -1500);
});
