/**
 * MarketDataProvider abstraction.
 * Both Mock and Kite providers write into the shared ltpMap via updateLtpAndBroadcast.
 * The downstream pipeline (snapshotService, changeDetectionService) reads from ltpMap
 * via getLatestLtp() — that is the single source of truth.
 *
 * Provider selection is controlled by MARKET_DATA_MODE env variable.
 */
import { Server } from "socket.io";
import { getLatestLtp } from "./portfolioService";
import { startMockKiteStream } from "./kiteMockStream";

export interface MarketDataProvider {
  /** Called once on server startup to begin streaming market data into ltpMap. */
  start(io: Server): void;
  /** Returns the name of this provider, used for logging/status only. */
  readonly name: string;
  /** Returns a price for a given symbol if known, or null if not registered. */
  getPrice(symbol: string): number | null;
}

export class MockMarketDataProvider implements MarketDataProvider {
  readonly name = "mock";

  start(io: Server): void {
    // This is the same startMockKiteStream call that was in server.ts
    startMockKiteStream(io);
  }

  getPrice(symbol: string): number | null {
    const upper = symbol.toUpperCase();
    // Try ltpMap first
    const ltp = getLatestLtp(upper);
    if (ltp) return ltp.price;
    // Register and return seed price synchronously from mockInstruments if available
    // (the async registration will happen; return null if not yet registered)
    return null;
  }
}

export class KiteMarketDataProvider implements MarketDataProvider {
  readonly name = "kite";
  private io: Server | null = null;

  start(io: Server): void {
    // Kite does not auto-stream on boot — tickers are started per-user after OAuth.
    // This method is intentionally a no-op at server level; startKiteTickerForUser
    // is called from the OAuth callback.
    this.io = io;
  }

  getPrice(symbol: string): number | null {
    const ltp = getLatestLtp(symbol.toUpperCase());
    return ltp ? ltp.price : null;
  }

  getIo(): Server | null {
    return this.io;
  }
}

export function createMarketDataProvider(mode: string): MarketDataProvider {
  if (mode === "kite") return new KiteMarketDataProvider();
  return new MockMarketDataProvider(); // default: mock
}

// Singleton — set once in server startup, used by rest of the app
let _provider: MarketDataProvider | null = null;

export function setMarketDataProvider(provider: MarketDataProvider): void {
  _provider = provider;
}

export function getMarketDataProvider(): MarketDataProvider {
  if (!_provider) throw new Error("MarketDataProvider not initialized");
  return _provider;
}

/** Resolves a price for any symbol regardless of provider. Falls back to ltpMap. */
export async function resolveSymbolPrice(symbol: string): Promise<{ price: number; timestamp: number; source: string; volume?: number } | null> {
  const upper = symbol.toUpperCase();
  // ltpMap is the single source of truth for both providers
  const ltp = getLatestLtp(upper);
  if (ltp) return { price: ltp.price, timestamp: ltp.timestamp, source: ltp.source ?? "stream", volume: ltp.volume };
  // In mock mode or before provider init: register symbol to get a deterministic seed price
  if (!_provider || _provider.name === "mock") {
    const { registerMockSymbol } = await import("./kiteMockStream");
    const inst = await registerMockSymbol(upper);
    return { price: inst.price, timestamp: inst.lastUpdated, source: "mock", volume: inst.volume };
  }
  return null;
}
