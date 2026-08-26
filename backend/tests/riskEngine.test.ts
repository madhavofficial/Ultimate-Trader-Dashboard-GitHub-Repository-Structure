import assert from "node:assert/strict";
import test from "node:test";
import { getCurrentMarketStatus, calculateStatutoryCharges } from "../src/services/marketHoursService";
import { computeRsi, computeTechnicalIndicators } from "../src/services/signalEngine";

test("calculates Indian equity statutory charges and taxes accurately", () => {
  const turnover = 100000; // ₹1,00,000 turnover
  const deliveryTax = calculateStatutoryCharges(turnover, true, false);

  assert.equal(deliveryTax.turnover, 100000);
  assert.equal(deliveryTax.stt, 100); // 0.1% STT on delivery = ₹100
  assert.ok(deliveryTax.exchangeCharges > 0);
  assert.ok(deliveryTax.gst > 0);
  assert.ok(deliveryTax.totalCharges > 100);
  assert.ok(deliveryTax.effectivePct < 0.2); // Total friction should be ~0.12%
});

test("calculates intraday statutory charges with lower STT", () => {
  const turnover = 100000;
  const intradayTax = calculateStatutoryCharges(turnover, false, true);

  assert.equal(intradayTax.stt, 25); // 0.025% on intraday sell = ₹25
  assert.ok(intradayTax.totalCharges < 50);
});

test("evaluates market sessions based on mock dates", () => {
  // Sunday (Weekend)
  const sunday = new Date("2026-08-23T05:00:00.000Z");
  const sundayStatus = getCurrentMarketStatus(sunday);
  assert.equal(sundayStatus.session, "WEEKEND");
  assert.equal(sundayStatus.isOpen, false);

  // Wednesday 10:30 AM IST (05:00 UTC)
  const wednesdayOpen = new Date("2026-08-26T05:00:00.000Z");
  const openStatus = getCurrentMarketStatus(wednesdayOpen);
  assert.equal(openStatus.session, "REGULAR_SESSION");
  assert.equal(openStatus.isOpen, true);
});

test("computes RSI oscillator accurately", () => {
  const steadyUp = [100, 102, 104, 106, 108, 110, 112, 114, 116, 118, 120, 122, 124, 126, 128];
  const rsiUp = computeRsi(steadyUp);
  assert.equal(rsiUp, 100); // Only gains -> RSI 100

  const balanced = [100, 102, 100, 102, 100, 102, 100, 102, 100, 102, 100, 102, 100, 102, 100];
  const rsiBalanced = computeRsi(balanced);
  assert.ok(rsiBalanced >= 45 && rsiBalanced <= 55);
});

test("computes technical indicator scoring and bias", () => {
  const prices = Array.from({ length: 30 }, (_, i) => 1500 + i * 5);
  const result = computeTechnicalIndicators("INFY", 1650, prices);

  assert.equal(result.symbol, "INFY");
  assert.equal(result.ltp, 1650);
  assert.ok(result.technicalScore > 0, "Uptrend should yield positive technical score");
  assert.equal(result.signalBias, "BULLISH");
});
