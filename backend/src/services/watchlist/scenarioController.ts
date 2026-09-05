import { Server } from "socket.io";
import { injectScenarioTicks } from "../portfolioService";
import {
  setMockInstrumentState,
  pauseMockStream,
  resumeMockStream,
  isMockStreamPaused,
} from "../kiteMockStream";
import { setMarketSessionOverride, MarketSession } from "../marketHoursService";

export type MarketScenarioName =
  | "baseline"
  | "big_move"
  | "volume_spike"
  | "stale"
  | "market_closed"
  | "unchanged";

export interface ScenarioResult {
  scenario: MarketScenarioName;
  description: string;
  appliedAt: string;
  marketSession: string;
  mockStreamActive: boolean;
  affectedSymbols: string[];
}

interface SymbolSpec {
  symbol: string;
  price: number;
  volume: number;
}

const BASELINE_SYMBOLS: SymbolSpec[] = [
  { symbol: "INFY", price: 1520.0, volume: 820000 },
  { symbol: "RELIANCE", price: 2485.0, volume: 1450000 },
  { symbol: "TCS", price: 3805.0, volume: 490000 },
  { symbol: "ASIANPAINT", price: 2890.0, volume: 310000 },
  { symbol: "INDIGO", price: 4350.0, volume: 220000 },
  { symbol: "HDFCBANK", price: 1620.0, volume: 1600000 },
  { symbol: "TATAMOTORS", price: 980.0, volume: 890000 },
  { symbol: "ICICIBANK", price: 1210.0, volume: 780000 },
  { symbol: "ITC", price: 485.0, volume: 2100000 },
  { symbol: "SBIN", price: 815.0, volume: 1300000 },
  { symbol: "BHARTIARTL", price: 1530.0, volume: 640000 },
  { symbol: "NIFTY 50", price: 24500.0, volume: 0 },
];

let activeScenario: MarketScenarioName = "baseline";

export function getCurrentScenarioName(): MarketScenarioName {
  return activeScenario;
}

export async function applyMarketScenario(
  rawName: string,
  io?: Server
): Promise<ScenarioResult> {
  const normalized = rawName.toLowerCase().replace(/[-_]/g, "");
  let scenario: MarketScenarioName;

  if (normalized === "baseline" || normalized === "reset") {
    scenario = "baseline";
  } else if (normalized.includes("bigmove") || normalized.includes("strongmove") || normalized === "big") {
    scenario = "big_move";
  } else if (normalized.includes("volumespike") || normalized.includes("volume") || normalized.includes("spike")) {
    scenario = "volume_spike";
  } else if (normalized === "stale" || normalized.includes("stalefeed")) {
    scenario = "stale";
  } else if (normalized.includes("closed") || normalized.includes("marketclosed")) {
    scenario = "market_closed";
  } else if (normalized.includes("unchanged") || normalized.includes("quiet") || normalized.includes("flat")) {
    scenario = "unchanged";
  } else {
    throw new Error(
      `Unknown scenario '${rawName}'. Supported scenarios: baseline, big_move, volume_spike, stale, market_closed, unchanged`
    );
  }

  activeScenario = scenario;
  const now = Date.now();
  let sessionOverride: MarketSession | null = "REGULAR_SESSION";
  let streamPaused = false;
  let quoteTimestamp = now;
  let symbolSpecs: SymbolSpec[] = [];
  let description = "";

  switch (scenario) {
    case "baseline":
      description = "Standard calm trading day. Baseline prices and healthy volumes across all symbols.";
      sessionOverride = "REGULAR_SESSION";
      streamPaused = false;
      quoteTimestamp = now;
      symbolSpecs = BASELINE_SYMBOLS.map((s) => ({ ...s }));
      break;

    case "big_move":
      description =
        "Major price divergence: TATAMOTORS rallies +4.59% (Alpha +4.39%), INFY plunges -2.96% against flat NIFTY 50.";
      sessionOverride = "REGULAR_SESSION";
      streamPaused = false;
      quoteTimestamp = now;
      symbolSpecs = BASELINE_SYMBOLS.map((s) => {
        if (s.symbol === "TATAMOTORS") return { ...s, price: 1025.0, volume: 1100000 };
        if (s.symbol === "INFY") return { ...s, price: 1475.0, volume: 980000 };
        if (s.symbol === "RELIANCE") return { ...s, price: 2510.0, volume: 1550000 };
        if (s.symbol === "NIFTY 50") return { ...s, price: 24550.0 };
        return { ...s };
      });
      break;

    case "volume_spike":
      description =
        "Institutional accumulation surge: RELIANCE volume spikes to 2.90x baseline, TCS surges to 2.82x normal pace.";
      sessionOverride = "REGULAR_SESSION";
      streamPaused = false;
      quoteTimestamp = now;
      symbolSpecs = BASELINE_SYMBOLS.map((s) => {
        if (s.symbol === "RELIANCE") return { ...s, price: 2515.0, volume: 4200000 };
        if (s.symbol === "TCS") return { ...s, price: 3870.0, volume: 1380000 };
        if (s.symbol === "NIFTY 50") return { ...s, price: 24520.0 };
        return { ...s };
      });
      break;

    case "stale":
      description =
        "Market stream latency alert: active trading session with feed interrupted for >60s, triggering STALE warning.";
      sessionOverride = "REGULAR_SESSION";
      streamPaused = true;
      quoteTimestamp = now - 75000; // 75 seconds ago
      symbolSpecs = BASELINE_SYMBOLS.map((s) => ({ ...s }));
      break;

    case "market_closed":
      description =
        "Exchange closed session: official session closing prices displayed with confident evaluation.";
      sessionOverride = "CLOSED";
      streamPaused = true;
      quoteTimestamp = now - 180000; // 3 minutes ago
      symbolSpecs = BASELINE_SYMBOLS.map((s) => ({ ...s }));
      break;

    case "unchanged":
      description =
        "Quiet session: price movements within 0.05% noise threshold; all symbols categorized as UNCHANGED.";
      sessionOverride = "REGULAR_SESSION";
      streamPaused = false;
      quoteTimestamp = now;
      symbolSpecs = BASELINE_SYMBOLS.map((s) => ({
        ...s,
        price: Number((s.price * (1 + (Math.random() * 0.001 - 0.0005))).toFixed(2)),
      }));
      break;
  }

  // 1. Set market session
  setMarketSessionOverride(sessionOverride);

  // 2. Control mock stream interval
  if (streamPaused) {
    pauseMockStream();
  } else {
    resumeMockStream();
  }

  // 3. Update mock instruments state
  for (const s of symbolSpecs) {
    setMockInstrumentState(s.symbol, {
      price: s.price,
      volume: s.volume,
      lastUpdated: quoteTimestamp,
    });
  }

  // 4. Inject directly into ltpMap and broadcast
  const ticks = symbolSpecs.map((s) => ({
    symbol: s.symbol,
    price: s.price,
    volume: s.volume,
    timestamp: quoteTimestamp,
    source: `scenario:${scenario}`,
  }));

  injectScenarioTicks(ticks, io);

  return {
    scenario,
    description,
    appliedAt: new Date(now).toISOString(),
    marketSession: sessionOverride,
    mockStreamActive: !isMockStreamPaused(),
    affectedSymbols: symbolSpecs.map((s) => s.symbol),
  };
}
