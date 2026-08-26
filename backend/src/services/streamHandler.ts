import { Server } from "socket.io";
import { KiteTicker, Tick, Ticker } from "kiteconnect";
import { getKiteTickerCredentials } from "./kiteService";
import { updateLtpAndBroadcast } from "./portfolioService";
import { userRoom } from "./socketRooms";

const activeTickers = new Map<string, Ticker>();

export async function startKiteTicker(io: Server, userId: string, tokens: number[]) {
  stopKiteTicker(userId);
  const credentials = await getKiteTickerCredentials(userId);
  const ticker = new KiteTicker({ api_key: credentials.apiKey, access_token: credentials.accessToken, reconnect: true });

  ticker.on("connect", () => {
    ticker.subscribe(tokens);
    ticker.setMode(ticker.modeQuote, tokens);
  });
  ticker.on("ticks", (ticks: Tick[]) => {
    io.to(userRoom(userId)).emit("kite:tick", ticks);
    void updateLtpAndBroadcast(io, ticks, userId).catch((error) => console.error("Kite portfolio update failed", error));
  });
  ticker.on("error", (error) => console.error("KiteTicker error", error));
  ticker.on("disconnect", (error) => console.warn("KiteTicker disconnected", error?.message));
  ticker.on("noreconnect", () => console.error(`KiteTicker stopped reconnecting for user ${userId}`));

  activeTickers.set(userId, ticker);
  ticker.connect();
  return { userId, tokens };
}

export function stopKiteTicker(userId: string) {
  const ticker = activeTickers.get(userId);
  if (ticker) {
    ticker.disconnect();
    activeTickers.delete(userId);
  }
}
