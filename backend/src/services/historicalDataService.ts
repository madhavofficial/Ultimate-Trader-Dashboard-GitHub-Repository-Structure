export interface Candle {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
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
