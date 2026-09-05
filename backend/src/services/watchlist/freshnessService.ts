import { getCurrentMarketStatus, MarketStatus } from "../marketHoursService";
import { MarketFreshnessState } from "../../types/watchlistContract";

export interface FreshnessEvaluation {
  state: MarketFreshnessState;
  observedAt: number;
  ageSeconds: number;
  canEvaluateConfidently: boolean;
  note: string;
}

export function evaluateQuoteFreshness(quoteTimestamp?: number, now = Date.now()): FreshnessEvaluation {
  const marketStatus: MarketStatus = getCurrentMarketStatus(new Date(now));

  if (!quoteTimestamp || quoteTimestamp <= 0) {
    return {
      state: "DATA_UNAVAILABLE",
      observedAt: now,
      ageSeconds: 0,
      canEvaluateConfidently: false,
      note: "Market data feed unavailable for this instrument.",
    };
  }

  const ageSeconds = Math.max(0, Math.floor((now - quoteTimestamp) / 1000));

  // Critical product rule: MARKET_CLOSED != STALE
  // On weekends or after market hours, the exchange is closed. The closing quote is completely valid.
  if (!marketStatus.isOpen) {
    return {
      state: "MARKET_CLOSED",
      observedAt: quoteTimestamp,
      ageSeconds,
      canEvaluateConfidently: true,
      note: `Market closed (${marketStatus.session}) — showing official session closing prices.`,
    };
  }

  // During active market sessions (09:15 - 15:30 IST):
  if (ageSeconds <= 5) {
    return {
      state: "LIVE",
      observedAt: quoteTimestamp,
      ageSeconds,
      canEvaluateConfidently: true,
      note: `Live market ticks streaming (<${Math.max(1, ageSeconds)}s latency).`,
    };
  }

  if (ageSeconds <= 30) {
    return {
      state: "DELAYED",
      observedAt: quoteTimestamp,
      ageSeconds,
      canEvaluateConfidently: true,
      note: `Market stream delayed by ${ageSeconds}s.`,
    };
  }

  // If age > 30s during an active session, stream has dropped
  return {
    state: "STALE",
    observedAt: quoteTimestamp,
    ageSeconds,
    canEvaluateConfidently: false,
    note: `⚠️ Live market stream stale: no updates in ${ageSeconds}s during regular trading hours.`,
  };
}

export function getGlobalMarketFreshness(now = Date.now()) {
  const marketStatus: MarketStatus = getCurrentMarketStatus(new Date(now));
  return {
    session: marketStatus.session,
    isOpen: marketStatus.isOpen,
    istTime: marketStatus.istTime,
    message: marketStatus.message,
  };
}
