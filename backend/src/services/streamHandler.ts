import { Server } from "socket.io";
import { KiteTicker, Tick, Ticker } from "kiteconnect";
import { getKiteTickerCredentials } from "./kiteService";
import { updateLtpAndBroadcast } from "./portfolioService";
import { userRoom } from "./socketRooms";
import { prisma } from "../db/client";

const activeTickers = new Map<string, Ticker>();
const userSubscribedTokens = new Map<string, Set<number>>();

export async function startKiteTicker(io: Server, userId: string, tokens: number[] = []) {
  stopKiteTicker(userId);
  const credentials = await getKiteTickerCredentials(userId);
  const ticker = new KiteTicker({ api_key: credentials.apiKey, access_token: credentials.accessToken, reconnect: true });

  const tokenSet = new Set<number>(tokens);
  try {
    const [watchlist, holdings] = await Promise.all([
      prisma.watchlistItem.findMany({ where: { userId }, select: { symbol: true } }),
      prisma.holding.findMany({ where: { userId }, select: { symbol: true } }),
    ]);
    const symbols = [...new Set([...watchlist.map((w) => w.symbol), ...holdings.map((h) => h.symbol)])];
    if (symbols.length > 0) {
      const instruments = await prisma.instrument.findMany({
        where: { tradingsymbol: { in: symbols }, exchange: "NSE" },
        select: { instrumentToken: true },
      });
      instruments.forEach((inst) => tokenSet.add(inst.instrumentToken));
    }
  } catch (err) {
    console.warn("Could not prefetch user watchlist tokens for KiteTicker", err);
  }

  const allTokens = Array.from(tokenSet);
  userSubscribedTokens.set(userId, tokenSet);

  ticker.on("connect", () => {
    if (allTokens.length > 0) {
      ticker.subscribe(allTokens);
      ticker.setMode(ticker.modeQuote, allTokens);
    }
  });

  ticker.on("ticks", (rawTicks: Tick[]) => {
    const now = Date.now();
    const ticks = rawTicks.map((t) => {
      const rawTime = (t as any).timestamp ?? (t as any).last_trade_time;
      return {
        ...t,
        timestamp: rawTime ? new Date(rawTime).getTime() : now,
        source: "kite" as const,
      };
    });
    io.to(userRoom(userId)).emit("kite:tick", ticks);
    void updateLtpAndBroadcast(io, ticks, userId).catch((error) => console.error("Kite portfolio update failed", error));
  });

  ticker.on("error", (error) => console.error("KiteTicker error", error));
  ticker.on("disconnect", (error) => console.warn("KiteTicker disconnected", error?.message));
  ticker.on("noreconnect", () => console.error(`KiteTicker stopped reconnecting for user ${userId}`));

  activeTickers.set(userId, ticker);
  ticker.connect();
  return { userId, tokens: allTokens };
}

export async function subscribeSymbolToKite(userId: string, symbol: string) {
  const ticker = activeTickers.get(userId);
  let tokenSet = userSubscribedTokens.get(userId);
  if (!tokenSet) {
    tokenSet = new Set<number>();
    userSubscribedTokens.set(userId, tokenSet);
  }

  try {
    const instrument = await prisma.instrument.findFirst({
      where: { tradingsymbol: symbol.toUpperCase(), exchange: "NSE" },
      select: { instrumentToken: true },
    });
    if (instrument?.instrumentToken) {
      tokenSet.add(instrument.instrumentToken);
      if (ticker) {
        ticker.subscribe([instrument.instrumentToken]);
        ticker.setMode(ticker.modeQuote, [instrument.instrumentToken]);
      }
    }
  } catch (err) {
    console.warn(`Failed to auto-subscribe Kite token for ${symbol}:`, err);
  }
}

export async function unsubscribeSymbolFromKite(userId: string, symbol: string) {
  const ticker = activeTickers.get(userId);
  const tokenSet = userSubscribedTokens.get(userId);

  try {
    const isHolding = await prisma.holding.findFirst({
      where: { userId, symbol: symbol.toUpperCase() },
    });
    if (isHolding) return;

    const instrument = await prisma.instrument.findFirst({
      where: { tradingsymbol: symbol.toUpperCase(), exchange: "NSE" },
      select: { instrumentToken: true },
    });
    if (instrument?.instrumentToken) {
      tokenSet?.delete(instrument.instrumentToken);
      if (ticker) {
        ticker.unsubscribe([instrument.instrumentToken]);
      }
    }
  } catch (err) {
    console.warn(`Failed to unsubscribe Kite token for ${symbol}:`, err);
  }
}

export function stopKiteTicker(userId: string) {
  const ticker = activeTickers.get(userId);
  if (ticker) {
    ticker.disconnect();
    activeTickers.delete(userId);
    userSubscribedTokens.delete(userId);
  }
}
