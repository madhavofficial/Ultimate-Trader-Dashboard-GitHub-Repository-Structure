import assert from "node:assert/strict";
import test from "node:test";
import { alertInputSchema, tradeInputSchema } from "../src/utils/validation";

test("trade validation normalizes symbols and accepts numeric strings", () => {
  const result = tradeInputSchema.parse({ symbol: " infy ", qty: "10", price: "1520.5", side: "BUY" });
  assert.deepEqual(result, { symbol: "INFY", qty: 10, price: 1520.5, side: "BUY" });
});

test("trade validation rejects non-positive quantities", () => {
  assert.throws(() => tradeInputSchema.parse({ symbol: "INFY", qty: 0, price: 1520, side: "BUY" }));
});

test("alert validation supports threshold conditions", () => {
  const result = alertInputSchema.parse({ symbol: "tcs", condition: "LTE", value: "3800" });
  assert.deepEqual(result, { symbol: "TCS", condition: "LTE", value: 3800 });
});

test("alert validation rejects unknown conditions", () => {
  assert.throws(() => alertInputSchema.parse({ symbol: "TCS", condition: "equals", value: 3800 }));
});
