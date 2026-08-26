import assert from "node:assert/strict";
import test from "node:test";
import { analyzeNewsText } from "../src/services/sentiment";

test("extracts primary symbol and classifies earnings event", () => {
  const result = analyzeNewsText(
    "Infosys reports 15% revenue growth in Q2; beats street estimates",
    "Strong deal pipeline and enterprise cloud adoption drive quarterly performance."
  );

  assert.ok(result.primarySymbols.includes("INFY"));
  assert.equal(result.eventType, "EARNINGS");
  assert.ok(result.sentimentScore > 0, "Sentiment score should be positive");
  assert.ok(result.confidence >= 0.6);
});

test("models second-order transmission from crude oil surge to paints and aviation", () => {
  const result = analyzeNewsText(
    "Brent Crude surges past $90 on supply disruption",
    "Rising energy costs put pressure on consumer goods and transportation."
  );

  assert.equal(result.eventType, "COMMODITY");
  assert.equal(result.transmissionPath, "COMMODITY_INPUT");

  const asianPaintImpact = result.rippleImpacts.find((r) => r.symbol === "ASIANPAINT");
  const indigoImpact = result.rippleImpacts.find((r) => r.symbol === "INDIGO");
  const relianceImpact = result.rippleImpacts.find((r) => r.symbol === "RELIANCE");

  assert.ok(asianPaintImpact, "Should identify Asian Paints as affected");
  assert.equal(asianPaintImpact?.impactDirection, "NEGATIVE");

  assert.ok(indigoImpact, "Should identify IndiGo as affected");
  assert.equal(indigoImpact?.impactDirection, "NEGATIVE");

  assert.ok(relianceImpact, "Should identify Reliance upstream as positively impacted");
  assert.equal(relianceImpact?.impactDirection, "POSITIVE");
});

test("detects regulatory and government policy events", () => {
  const result = analyzeNewsText(
    "SEBI imposes penalty on fraudulent disclosure scheme",
    "Regulator issues strict warnings to non-compliant intermediaries."
  );

  assert.equal(result.eventType, "REGULATORY");
  assert.ok(result.sentimentScore < 0, "Regulatory penalty should score negative sentiment");
});
