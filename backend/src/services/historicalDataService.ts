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

    if (!instrument) return [];

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

  return [];
}
