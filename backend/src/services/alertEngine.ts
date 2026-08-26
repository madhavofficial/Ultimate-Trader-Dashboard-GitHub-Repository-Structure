import { Server } from "socket.io";
import { prisma } from "../db/client";
import { userRoom } from "./socketRooms";
import { writeAuditLog } from "./auditLog";

export interface PriceTick {
  symbol?: string;
  last_price: number;
}

// Fire once per threshold crossing and re-arm after the price returns below
// or above the threshold. This avoids one notification per market tick.
const activeAlerts = new Set<string>();

export async function evaluateAlertsOnTicks(io: Server, ticks: PriceTick[]) {
  if (!ticks || ticks.length === 0) return;

  const symbolMap = new Map<string, number>();
  for (const tick of ticks) {
    if (tick.symbol && Number.isFinite(tick.last_price)) {
      symbolMap.set(tick.symbol, tick.last_price);
    }
  }

  if (symbolMap.size === 0) return;

  const relevantAlerts = await prisma.alert.findMany({
    where: { symbol: { in: Array.from(symbolMap.keys()) } },
  });

  if (relevantAlerts.length === 0) return;

  for (const alert of relevantAlerts) {
    const currentPrice = symbolMap.get(alert.symbol);
    if (currentPrice === undefined) continue;

    let triggered = false;
    switch (alert.condition) {
      case "GT":
        triggered = currentPrice > alert.value;
        break;
      case "GTE":
        triggered = currentPrice >= alert.value;
        break;
      case "LT":
        triggered = currentPrice < alert.value;
        break;
      case "LTE":
        triggered = currentPrice <= alert.value;
        break;
    }

    if (triggered) {
      if (activeAlerts.has(alert.id)) continue;
      activeAlerts.add(alert.id);
      const payload = {
        alertId: alert.id,
        symbol: alert.symbol,
        condition: alert.condition,
        threshold: alert.value,
        currentPrice,
        timestamp: new Date().toISOString(),
        message: `Alert triggered: ${alert.symbol} reached ₹${currentPrice.toFixed(2)} (${alert.condition} ₹${alert.value})`,
      };

      // Push real-time notification to user's private Socket.IO room
      io.to(userRoom(alert.userId)).emit("alert:triggered", payload);

      // Audit log the alert trigger
      void writeAuditLog({
        userId: alert.userId,
        action: "ALERT_TRIGGERED",
        entityType: "Alert",
        entityId: alert.id,
        metadata: payload,
      });
    } else {
      activeAlerts.delete(alert.id);
    }
  }
}
