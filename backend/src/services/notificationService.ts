import { Server } from "socket.io";
import { prisma } from "../db/client";
import { env } from "../config/env";
import { userRoom } from "./socketRooms";

export type NotificationChannel = "IN_APP" | "TELEGRAM" | "WEBHOOK";

export interface DispatchNotificationInput {
  userId: string;
  alertId?: string;
  symbol: string;
  title: string;
  message: string;
  channel?: NotificationChannel;
  io?: Server;
}

// In-memory cooldown tracker: key -> last timestamp
const notificationCooldowns = new Map<string, number>();
const COOLDOWN_PERIOD_MS = 3 * 60 * 1000; // 3 minutes cooldown

export async function dispatchNotification(input: DispatchNotificationInput) {
  const cooldownKey = `${input.userId}:${input.symbol}:${input.title}`;
  const now = Date.now();
  const lastFired = notificationCooldowns.get(cooldownKey);

  // Check cooldown suppression
  if (lastFired && now - lastFired < COOLDOWN_PERIOD_MS) {
    try {
      await prisma.alertNotification.create({
        data: {
          userId: input.userId,
          alertId: input.alertId,
          symbol: input.symbol,
          channel: input.channel ?? "IN_APP",
          title: input.title,
          message: input.message,
          status: "SUPPRESSED_COOLDOWN",
        },
      });
    } catch {
      // Ignore DB error on suppressed cooldown log
    }
    return { status: "SUPPRESSED_COOLDOWN" };
  }


  notificationCooldowns.set(cooldownKey, now);
  let deliveryStatus = "DELIVERED";

  // 1. In-App WebSockets
  if (input.io && (!input.channel || input.channel === "IN_APP")) {
    input.io.to(userRoom(input.userId)).emit("alert:triggered", {
      alertId: input.alertId,
      symbol: input.symbol,
      message: input.message,
      title: input.title,
      timestamp: new Date().toISOString(),
    });
  }

  // 2. Telegram Bot Webhook
  if ((!input.channel || input.channel === "TELEGRAM") && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    try {
      const tgText = `🔔 *${input.title}*\n\n📈 *Symbol:* ${input.symbol}\n💬 ${input.message}\n🕒 _${new Date().toLocaleTimeString()} IST_`;
      const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text: tgText,
          parse_mode: "Markdown",
        }),
      });
      if (!res.ok) deliveryStatus = "PARTIALLY_FAILED";
    } catch (err) {
      console.warn("Telegram dispatch error:", err);
      deliveryStatus = "PARTIALLY_FAILED";
    }
  }

  // 3. Custom Webhook (Discord / Slack / Endpoint)
  if ((!input.channel || input.channel === "WEBHOOK") && env.WEBHOOK_URL) {
    try {
      const res = await fetch(env.WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "ALERT_TRIGGERED",
          userId: input.userId,
          alertId: input.alertId,
          symbol: input.symbol,
          title: input.title,
          message: input.message,
          timestamp: new Date().toISOString(),
        }),
      });
      if (!res.ok) deliveryStatus = "PARTIALLY_FAILED";
    } catch (err) {
      console.warn("Custom webhook dispatch error:", err);
      deliveryStatus = "PARTIALLY_FAILED";
    }
  }


  // Save persistent record in Database (graceful if DB offline)
  let record: any = null;
  try {
    record = await prisma.alertNotification.create({
      data: {
        userId: input.userId,
        alertId: input.alertId,
        symbol: input.symbol,
        channel: input.channel ?? "IN_APP",
        title: input.title,
        message: input.message,
        status: deliveryStatus,
      },
    });
  } catch {
    // Database logging error should not block notification delivery
  }

  return { status: deliveryStatus, notification: record };
}
