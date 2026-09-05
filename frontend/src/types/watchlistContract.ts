export type MarketFreshnessState =
  | "LIVE"              // Active market ticks streaming under 5s
  | "DELAYED"           // Stream latency between 5s and 30s
  | "STALE"             // Active trading session, but no ticks received in > 30s
  | "MARKET_CLOSED"     // Weekend / outside NSE trading hours (9:15 - 15:30 IST)
  | "DATA_UNAVAILABLE"; // No market feed discoverable

export type ChangeSignificance = "NEEDS_ATTENTION" | "WORTH_A_LOOK" | "UNCHANGED";

export interface DeterministicReason {
  category: "PRICE" | "VOLUME" | "BENCHMARK" | "CATALYST";
  label: string;
  value: string;
  significance: "HIGH" | "MEDIUM" | "NEUTRAL";
}

export interface WatchlistChangeItem {
  symbol: string;
  currentPrice: number;
  checkpointPrice: number;
  priceChangePct: number;
  currentVolume: number;
  checkpointVolume: number;
  volumeRatio: number | null;       // volume pace since checkpoint (null if checkpoint volume was 0)
  benchmarkAlphaPct: number | null; // stock change % minus NIFTY 50 change % (null if benchmark missing)
  newEventCount: number;
  attentionScore: number;           // 0 to 100 (deterministic normalized composite score)
  significance: ChangeSignificance;
  reasons: DeterministicReason[];
  summaryExplanation?: string;
  freshness: MarketFreshnessState;
  observedAt: number;               // Epoch milliseconds
  eventContinuityKey: string;       // Stable signature to avoid alert fatigue on small incremental ticks
}

export interface WatchlistSummaryResponse {
  ok: boolean;
  userId: string;
  isFirstVisit: boolean;
  lastCheckedAt: string | null;     // ISO timestamp or null if first visit
  timeAwayHuman: string;            // e.g. "2h 17m ago" or "First visit — baseline established"
  checkpointItemCount: number;
  marketFreshness: {
    state: MarketFreshnessState;
    session: string;                // e.g. "REGULAR_SESSION", "WEEKEND", "CLOSED"
    isOpen: boolean;
    observedAt: number;
    ageSeconds: number;
    note: string;                   // e.g. "Market closed — showing Friday's closing session"
  };
  counts: {
    total: number;
    needsAttention: number;
    worthALook: number;
    unchanged: number;
  };
  groups: {
    needsAttention: WatchlistChangeItem[];
    worthALook: WatchlistChangeItem[];
    unchanged: WatchlistChangeItem[];
  };
  demoActive?: boolean;
}
