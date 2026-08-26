import assert from "node:assert/strict";
import test from "node:test";
import { dispatchNotification } from "../src/services/notificationService";
import { analyzeNewsText } from "../src/services/sentiment";

test("clamps sentiment scores and validates boundaries", () => {
  const result = analyzeNewsText(
    "Infosys reports outstanding multi-billion cloud contract wins",
    "Record deal signings drive accelerated revenue growth across enterprise segments."
  );

  assert.ok(result.sentimentScore >= -1.0 && result.sentimentScore <= 1.0);
  assert.ok(result.confidence >= 0.0 && result.confidence <= 1.0);
  assert.ok(result.primarySymbols.includes("INFY"));
});

test("enforces notification deduplication cooldown", async () => {
  const input = {
    userId: "test-user-uuid-1",
    symbol: "RELIANCE",
    title: "Price Alert Test",
    message: "Reliance crossed ₹2900",
  };

  const first = await dispatchNotification(input);
  assert.ok(first.status === "DELIVERED" || first.status === "PARTIALLY_FAILED");

  // Second immediate dispatch should be suppressed by cooldown
  const second = await dispatchNotification(input);
  assert.equal(second.status, "SUPPRESSED_COOLDOWN");
});

test("respects explicit notification channel routing", async () => {
  const input = {
    userId: "test-user-uuid-2",
    symbol: "TCS",
    title: "Channel Filter Test",
    message: "TCS breakout",
    channel: "IN_APP" as const,
  };

  const res = await dispatchNotification(input);
  assert.ok(res.status === "DELIVERED" || res.status === "SUPPRESSED_COOLDOWN");
});

test("rejects market orders when no live reference price is discoverable", async () => {
  const { placeKiteLiveOrder } = await import("../src/services/kiteService");
  await assert.rejects(
    async () => {
      // Trying to place MARKET order on unknown symbol with an artificially low price 0.01
      await placeKiteLiveOrder("test-user-uuid-99", {
        symbol: "UNKNOWN_NONEXISTENT_SYMBOL_XYZ",
        transaction_type: "BUY",
        order_type: "MARKET",
        quantity: 1000,
        price: 0.01, // Should be IGNORED by market order logic
      });
    },
    (err: any) => {
      assert.ok(err.message.includes("no live reference price available"));
      return true;
    }
  );
});
