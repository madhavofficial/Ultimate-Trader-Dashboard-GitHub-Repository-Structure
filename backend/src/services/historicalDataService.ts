import { getKiteClient } from "./kiteService";
import { prisma } from "../db/client";

export interface Candle {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type KiteInterval = "day" | "minute" | "5minute" | "3minute" | "10minute" | "15minute" | "30minute" | "60minute";

export async function fetchKiteHistoricalCandles(
  userId: string,
  symbol: string,
  interval: KiteInterval = "5minute",
  count = 60
): Promise<Candle[]> {

  try {
    const instrument = await prisma.instrument.findFirst({
      where: { tradingsymbol: symbol, exchange: "NSE" },
    });

    if (!instrument) {
      return generateHistoricalCandles(symbol, 1500, count);
    }

    const client = await getKiteClient(userId);
    const to = new Date();
    const from = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // Past 5 days

    const rawData = await client.getHistoricalData(instrument.instrumentToken, interval, from, to);
    if (Array.isArray(rawData) && rawData.length > 0) {
      return rawData.slice(-count).map((d: any) => ({
        time: Math.floor(new Date(d.date).getTime() / 1000),
        open: Number(d.open),
        high: Number(d.high),
        low: Number(d.low),
        close: Number(d.close),
        volume: Number(d.volume ?? 0),
      }));
    }
  } catch (err) {
    console.warn(`Kite historical data fetch failed for ${symbol}, falling back:`, err);
  }

  return generateHistoricalCandles(symbol, 1500, count);
}

export function generateHistoricalCandles(symbol: string, basePrice = 1500, count = 60, intervalMinutes = 5): Candle[] {
  const candles: Candle[] = [];
  let currentClose = basePrice;
  const now = Math.floor(Date.now() / 1000);
  const intervalSeconds = intervalMinutes * 60;
  const startTime = now - count * intervalSeconds;

  for (let i = 0; i < count; i++) {
    const time = startTime + i * intervalSeconds;
    const changePct = (Math.sin(i / 4) + (Math.random() - 0.48)) * 0.008;
    const open = Number(currentClose.toFixed(2));
    const close = Number(Math.max(1, open * (1 + changePct)).toFixed(2));
    const high = Number((Math.max(open, close) * (1 + Math.random() * 0.004)).toFixed(2));
    const low = Number((Math.min(open, close) * (1 - Math.random() * 0.004)).toFixed(2));
    const volume = Math.floor(10000 + Math.random() * 50000);

    candles.push({
      time,
      open,
      high,
      low,
      close,
      volume,
    });

    currentClose = close;
  }

  return candles;
}

