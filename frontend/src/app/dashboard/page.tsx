"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { io, Socket } from "socket.io-client";
import InteractivePriceChart from "../../components/InteractivePriceChart";

type Holding = {
  symbol: string;
  quantity: number;
  averagePrice: number;
  lastPrice: number;
  investedValue: number;
  currentValue: number;
  unrealizedPnl: number;
};

type Portfolio = {
  cashBalance: number;
  totalInvestedValue: number;
  totalCurrentValue: number;
  totalUnrealizedPnl: number;
  holdings: Holding[];
};

type MarketEvent = {
  id: string;
  title: string;
  source: string;
  summary: string;
  eventType: string;
  primarySymbols: string[];
  sentimentScore: number;
  confidence: number;
  impactHorizon: string;
  transmissionPath: string;
  rippleImpacts: Array<{
    symbol: string;
    sector: string;
    impactDirection: "POSITIVE" | "NEGATIVE";
    strength: number;
    rationale: string;
  }>;
  reasoning: string;
  priceImpactExplanation?: string;
  occurredAt: string;
  url?: string;
  isFallback?: boolean;
};

type Signal = {
  id: string;
  symbol: string;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  compositeScore: number;
  technicalScore: number | null;
  sentimentScore: number;
  macroScore: number;
  confidence: number;
  horizon: string;
  rationale: string;
  status: string;
  createdAt: string;
};

type Analytics = {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  grossRealizedPnl: number;
  estimatedStatutoryCharges: number;
  netRealizedPnl: number;
  profitFactor: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  sectorBreakdown: Array<{ sector: string; tradeCount: number; pnl: number }>;
};

type RiskSettings = {
  maxDailyLoss: number;
  maxPositionSize: number;
  maxSectorExposurePct: number;
  killSwitchActive: boolean;
  stopLossDefaultPct: number;
  takeProfitDefaultPct: number;
};

type MarketStatus = {
  session: string;
  isOpen: boolean;
  istTime: string;
  message: string;
};

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type AlertItem = {
  id: string;
  symbol: string;
  condition: "GT" | "GTE" | "LT" | "LTE";
  value: number;
};

type TriggeredToast = {
  id: string;
  symbol: string;
  message: string;
};

type SearchInstrument = {
  instrumentToken: number;
  tradingsymbol: string;
  name: string;
  exchange: string;
  segment: string;
};

type BrokerMargins = {
  equity?: {
    enabled: boolean;
    net: number;
    available: {
      cash: number;
      collateral: number;
      intraday_payin: number;
      live_balance: number;
    };
    utilised: {
      debits: number;
      exposure: number;
      m2m_realised: number;
      m2m_unrealised: number;
      option_premium: number;
      span: number;
    };
  };
};

type BrokerOrder = {
  order_id: string;
  tradingsymbol: string;
  exchange: string;
  transaction_type: string;
  order_type: string;
  quantity: number;
  price: number;
  status: string;
  order_timestamp: string;
};

type Tick = {
  symbol?: string;
  last_price: number;
  change?: number;
  timestamp?: number;
  source?: "kite" | "mock";
};

type QuoteMeta = {
  timestamp: number;
  source: "kite" | "mock" | "cache";
  change?: number;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? API_URL;

export default function DashboardPage() {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [activeTab, setActiveTab] = useState<"EXECUTION" | "INTELLIGENCE" | "SIGNALS" | "ANALYTICS" | "RISK" | "BROKER">("EXECUTION");
  const [newsFilter, setNewsFilter] = useState<"ALL" | "SELECTED">("SELECTED");

  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [quoteMeta, setQuoteMeta] = useState<Record<string, QuoteMeta>>({});
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [lastSocketMessageAt, setLastSocketMessageAt] = useState<number | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);

  const [events, setEvents] = useState<MarketEvent[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [riskSettings, setRiskSettings] = useState<RiskSettings | null>(null);
  const [marketStatus, setMarketStatus] = useState<MarketStatus | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [selectedChartSymbol, setSelectedChartSymbol] = useState("");
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [toasts, setToasts] = useState<TriggeredToast[]>([]);
  const [showSignalMethodology, setShowSignalMethodology] = useState(false);
  const [watchlistSummary, setWatchlistSummary] = useState<any>(null);

  // Broker states
  const [brokerMargins, setBrokerMargins] = useState<BrokerMargins | null>(null);
  const [brokerOrders, setBrokerOrders] = useState<BrokerOrder[]>([]);
  const [executionMode, setExecutionMode] = useState<"PAPER" | "LIVE_BROKER">("PAPER");

  // Dynamic Watchlist & Search state
  const [dynamicWatchlist, setDynamicWatchlist] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchInstrument[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Trade form state
  const [symbol, setSymbol] = useState("");
  const [qty, setQty] = useState("5");
  const [price, setPrice] = useState("");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [tradeMessage, setTradeMessage] = useState("");

  // Alert state
  const [alertSymbol, setAlertSymbol] = useState("");
  const [alertCondition, setAlertCondition] = useState<"GT" | "LT">("GT");
  const [alertValue, setAlertValue] = useState("");
  const [alertMessage, setAlertMessage] = useState("");

  const selectedStockNews = useMemo(() => {
    if (!selectedChartSymbol || !events.length) return [];
    const upper = selectedChartSymbol.toUpperCase();

    // Dynamically derive natural search terms from the ticker without hardcoding
    const searchTerms = [upper];
    for (const suffix of ["BANK", "MOTORS", "STEEL", "POWER", "FINANCE", "PAINTS", "TECH", "PHARMA"]) {
      if (upper.endsWith(suffix) && upper.length > suffix.length) {
        const base = upper.slice(0, -suffix.length);
        searchTerms.push(`${base} ${suffix}`);
        if (base.length >= 4) searchTerms.push(base);
      }
    }

    // Priority 1: Direct primary symbol match (AI-extracted NSE ticker)
    const directMatches = events.filter((e) =>
      Array.isArray(e.primarySymbols) && e.primarySymbols.includes(upper)
    );

    // Priority 2: Ripple impact match (cross-market second-order transmission)
    const rippleMatches = events.filter(
      (e) =>
        !directMatches.includes(e) &&
        Array.isArray(e.rippleImpacts) &&
        e.rippleImpacts.some((r) => r.symbol === upper)
    );

    // Priority 3: Dynamic ticker & company name match with exact word boundaries
    const textMatches = events.filter((e) => {
      if (directMatches.includes(e) || rippleMatches.includes(e)) return false;
      const text = `${e.title || ""} ${e.summary || ""}`;
      return searchTerms.some((term) => {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`\\b${escaped}\\b`, "i").test(text);
      });
    });

    const combined = [...directMatches, ...rippleMatches, ...textMatches];
    if (combined.length > 0) return combined;

    // Macro fallback: Only return broad economy-wide macroeconomic events (e.g. GDP, Rates)
    const macroEvents = events.filter(
      (e) => e.eventType === "MACRO" || (Array.isArray(e.primarySymbols) && e.primarySymbols.includes("NIFTY") && e.transmissionPath === "MACRO_FX")
    );
    return macroEvents.slice(0, 2).map((ev) => ({ ...ev, isFallback: true }));
  }, [selectedChartSymbol, events]);

  const selectedStockCheckpoint = useMemo(() => {
    if (!watchlistSummary?.groups || !selectedChartSymbol) return null;
    const all = [
      ...(watchlistSummary.groups.needsAttention || []),
      ...(watchlistSummary.groups.worthALook || []),
      ...(watchlistSummary.groups.unchanged || []),
    ];
    return all.find((x: any) => x.symbol === selectedChartSymbol) || null;
  }, [watchlistSummary, selectedChartSymbol]);

  useEffect(() => {
    setToken(localStorage.getItem("accessToken"));
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!token) return;

    const socket: Socket = io(SOCKET_URL, {
      auth: { token },
      withCredentials: true,
    });

    socket.on("connect", () => setSocketConnected(true));
    socket.on("disconnect", () => setSocketConnected(false));

    const onTicks = (ticks: Tick[]) => {
      const now = Date.now();
      setLastSocketMessageAt(now);
      setPrices((prev) => {
        const next = { ...prev };
        ticks.forEach((t) => {
          if (t.symbol) next[t.symbol] = t.last_price;
        });
        return next;
      });
      setQuoteMeta((prev) => {
        const next = { ...prev };
        ticks.forEach((t) => {
          if (t.symbol) {
            next[t.symbol] = {
              timestamp: t.timestamp ?? now,
              source: t.source ?? ((t as any).instrument_token ? "kite" : "mock"),
              change: t.change,
            };
          }
        });
        return next;
      });
    };

    const onMarketEvent = (newEvent: MarketEvent) => {
      setEvents((prev) => [newEvent, ...prev.slice(0, 19)]);
    };

    const onSignalCreated = (newSignal: Signal) => {
      setSignals((prev) => [newSignal, ...prev.slice(0, 19)]);
    };

    const onAlertTriggered = (alertData: { alertId: string; symbol: string; message: string }) => {
      const toastId = `${alertData.alertId}-${Date.now()}`;
      setToasts((prev) => [...prev, { id: toastId, symbol: alertData.symbol, message: alertData.message }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toastId));
      }, 7000);
    };

    socket.on("tick", onTicks);
    socket.on("kite:tick", onTicks);
    socket.on("portfolio:update", setPortfolio);
    socket.on("market:event", onMarketEvent);
    socket.on("signal:created", onSignalCreated);
    socket.on("alert:triggered", onAlertTriggered);

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("tick", onTicks);
      socket.off("kite:tick", onTicks);
      socket.off("portfolio:update");
      socket.off("market:event");
      socket.off("signal:created");
      socket.off("alert:triggered");
      socket.disconnect();
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    void loadAllData(token);

    // Periodic 60-second polling for news intelligence, signals, and market status
    const pollTimer = setInterval(() => {
      void loadIntelligence(token);
      void loadSignals(token);
      void loadMarketStatus(token);
    }, 60000);

    return () => clearInterval(pollTimer);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    void loadCandles(selectedChartSymbol, token);
  }, [selectedChartSymbol, token]);

  useEffect(() => {
    if (selectedChartSymbol || (!dynamicWatchlist.length && !portfolio?.holdings.length)) return;
    const firstSymbol = dynamicWatchlist[0] ?? portfolio?.holdings[0]?.symbol;
    if (!firstSymbol) return;
    setSelectedChartSymbol(firstSymbol);
    setSymbol(firstSymbol);
    setAlertSymbol(firstSymbol);
    const holding = portfolio?.holdings.find((item) => item.symbol === firstSymbol);
    const livePrice = prices[firstSymbol] ?? holding?.lastPrice;
    if (livePrice && livePrice > 0) {
      setPrice(String(livePrice));
      setAlertValue(String(livePrice));
    }
  }, [dynamicWatchlist, portfolio, prices, selectedChartSymbol]);

  // Debounced instrument search
  useEffect(() => {
    if (!token || searchQuery.trim().length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_URL}/market/search?q=${encodeURIComponent(searchQuery)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.instruments ?? []);
        }
      } catch {
        // search failure ignored
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery, token]);

  async function loadAllData(accessToken: string) {
    await loadWatchlist(accessToken);
    await Promise.all([
      loadPortfolio(accessToken),
      loadIntelligence(accessToken),
      loadSignals(accessToken),
      loadAnalytics(accessToken),
      loadRiskSettings(accessToken),
      loadMarketStatus(accessToken),
      loadAlerts(accessToken),
      loadBrokerData(accessToken),
    ]);
  }

  async function authenticate(path: "login" | "register") {
    try {
      const res = await fetch(`${API_URL}/auth/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json();
      if (!res.ok) return setTradeMessage(body.error ?? "Authentication failed");
      if (body.accessToken) {
        localStorage.setItem("accessToken", body.accessToken);
        setToken(body.accessToken);
      } else if (path === "register") {
        return authenticate("login");
      }
    } catch {
      setTradeMessage("Server connection error");
    }
  }

  async function loadPortfolio(accessToken: string) {
    const res = await fetch(`${API_URL}/portfolio`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.ok) setPortfolio((await res.json()).portfolio);
  }

  async function loadWatchlist(accessToken: string) {
    const [res, summaryRes] = await Promise.all([
      fetch(`${API_URL}/market/watchlist`, { headers: { Authorization: `Bearer ${accessToken}` } }),
      fetch(`${API_URL}/watchlist/summary`, { headers: { Authorization: `Bearer ${accessToken}` } }).catch(() => null),
    ]);
    if (summaryRes && summaryRes.ok) {
      setWatchlistSummary(await summaryRes.json());
    }
    if (res.ok) {
      const data = await res.json();
      const items: Array<{ symbol: string; lastPrice?: number | null; quoteTimestamp?: number | null; source?: string }> = data.watchlist ?? [];
      setDynamicWatchlist(items.map((item) => item.symbol));
      setPrices((prev) => {
        const next = { ...prev };
        items.forEach((it) => {
          if (it.lastPrice && !next[it.symbol]) next[it.symbol] = Number(it.lastPrice);
        });
        return next;
      });
      setQuoteMeta((prev) => {
        const next = { ...prev };
        items.forEach((it) => {
          if (it.quoteTimestamp && !next[it.symbol]) {
            next[it.symbol] = {
              timestamp: it.quoteTimestamp,
              source: it.source === "kite" ? "kite" : "mock",
            };
          }
        });
        return next;
      });
    }
  }

  async function loadIntelligence(accessToken: string) {
    const res = await fetch(`${API_URL}/intelligence/events`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.ok) setEvents((await res.json()).events ?? []);
  }

  async function loadSignals(accessToken: string) {
    const res = await fetch(`${API_URL}/signals`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.ok) setSignals((await res.json()).signals ?? []);
  }

  async function loadAnalytics(accessToken: string) {
    const res = await fetch(`${API_URL}/analytics/summary`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.ok) setAnalytics((await res.json()).analytics);
  }

  async function loadRiskSettings(accessToken: string) {
    const res = await fetch(`${API_URL}/risk/settings`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.ok) setRiskSettings((await res.json()).settings);
  }

  async function loadMarketStatus(accessToken: string) {
    const res = await fetch(`${API_URL}/market/status`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.ok) setMarketStatus((await res.json()).marketStatus);
  }

  async function loadCandles(chartSym: string, accessToken: string) {
    if (!chartSym) return;
    setCandles([]);
    const res = await fetch(`${API_URL}/market/candles?symbol=${chartSym}&count=50&interval=5minute`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) setCandles((await res.json()).candles ?? []);
  }

  async function loadAlerts(accessToken: string) {
    const res = await fetch(`${API_URL}/alerts`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.ok) setAlerts((await res.json()).alerts ?? []);
  }

  async function loadBrokerData(accessToken: string) {
    try {
      const [marginsRes, ordersRes] = await Promise.all([
        fetch(`${API_URL}/broker/kite/margins`, { headers: { Authorization: `Bearer ${accessToken}` } }),
        fetch(`${API_URL}/broker/kite/orders`, { headers: { Authorization: `Bearer ${accessToken}` } }),
      ]);
      if (marginsRes.ok) setBrokerMargins((await marginsRes.json()).margins);
      if (ordersRes.ok) setBrokerOrders((await ordersRes.json()).orders ?? []);
    } catch {
      // Broker may not be linked yet
    }
  }

  async function submitTrade(e: FormEvent) {
    e.preventDefault();
    setTradeMessage("");

    if (executionMode === "LIVE_BROKER") {
      const confirmed = window.confirm(`⚠️ CONFIRM REAL ZERODHA LIVE ORDER:\n\n${side} ${qty} shares of ${symbol} @ ₹${price}\n\nThis will send a live order to the exchange!`);
      if (!confirmed) return;

      const res = await fetch(`${API_URL}/broker/kite/orders`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          symbol,
          transaction_type: side,
          order_type: "LIMIT",
          quantity: Number(qty),
          price: Number(price),
          product: "CNC",
        }),
      });
      const body = await res.json();
      if (res.ok) {
        setTradeMessage(`🚀 LIVE ORDER PLACED with Zerodha (Order ID: ${body.orderResult?.order_id ?? "OK"})`);
        if (token) void loadBrokerData(token);
      } else {
        setTradeMessage(`❌ LIVE ORDER REJECTED: ${body.error ?? "Failed"}`);
      }
      return;
    }

    // Default Paper Trade
    const res = await fetch(`${API_URL}/trades/add`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ symbol, qty: Number(qty), price: Number(price), side }),
    });
    const body = await res.json();
    if (res.ok) {
      setTradeMessage(`✅ ${side} paper trade executed: ${qty} ${symbol} @ ₹${price}`);
      if (token) {
        void loadPortfolio(token);
        void loadAnalytics(token);
      }
    } else {
      setTradeMessage(`❌ ${body.error ?? "Trade rejected"}`);
    }
  }

  async function toggleKillSwitch(active: boolean) {
    if (!token) return;
    const res = await fetch(`${API_URL}/risk/kill-switch`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ active, reason: active ? "User clicked emergency kill switch" : "User deactivated kill switch" }),
    });
    if (res.ok) {
      const data = await res.json();
      setRiskSettings(data.settings);
    }
  }

  async function createPriceAlert(e: FormEvent) {
    e.preventDefault();
    setAlertMessage("");
    const res = await fetch(`${API_URL}/alerts/add`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ symbol: alertSymbol, condition: alertCondition, value: Number(alertValue) }),
    });
    const body = await res.json();
    if (res.ok) {
      setAlertMessage(`✅ Alert set for ${alertSymbol} ${alertCondition} ₹${alertValue}`);
      if (token) void loadAlerts(token);
    } else {
      setAlertMessage(`❌ ${body.error ?? "Failed to set alert"}`);
    }
  }

  async function deleteAlert(alertId: string) {
    if (!token) return;
    const res = await fetch(`${API_URL}/alerts/${alertId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) void loadAlerts(token);
  }

  async function triggerNewsSync() {
    if (!token) return;
    setTradeMessage("🔄 Syncing RSS news and running Groq AI sentiment pipeline...");
    try {
      await fetch(`${API_URL}/intelligence/sync-news`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      await loadIntelligence(token);
      setTradeMessage("✅ RSS News synced and analyzed by AI engine!");
      setTimeout(() => setTradeMessage(""), 4000);
    } catch {
      setTradeMessage("❌ Error triggering news sync");
    }
  }

  async function generateSignalForSymbol(sym: string) {
    if (!token) return;
    const currentPrice = prices[sym] ?? 1500;
    await fetch(`${API_URL}/signals/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ symbol: sym, price: currentPrice }),
    });
    void loadSignals(token);
  }

  async function connectZerodha() {
    if (!token) return;
    const res = await fetch(`${API_URL}/broker/kite/login`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    }
  }

  async function addSymbolToWatchlist(newSym: string) {
    if (!token) return;
    const normalizedSymbol = newSym.toUpperCase();
    if (!dynamicWatchlist.includes(normalizedSymbol)) {
      const res = await fetch(`${API_URL}/market/watchlist`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ symbol: normalizedSymbol }),
      });
      if (!res.ok) {
        setTradeMessage("❌ Could not save ticker to watchlist");
        return;
      }
      const data = await res.json();
      const item = data.item;
      if (item?.lastPrice) {
        setPrices((prev) => ({ ...prev, [normalizedSymbol]: Number(item.lastPrice) }));
      }
      if (item?.quoteTimestamp) {
        setQuoteMeta((prev) => ({
          ...prev,
          [normalizedSymbol]: {
            timestamp: item.quoteTimestamp,
            source: item.source === "kite" ? "kite" : "mock",
          },
        }));
      }
      setDynamicWatchlist((current) => [...current, normalizedSymbol]);
    }
    selectSymbol(normalizedSymbol);
    setSearchQuery("");
    setSearchResults([]);
  }

  async function removeSymbolFromWatchlist(symbolToRemove: string) {
    if (!token) return;
    const res = await fetch(`${API_URL}/market/watchlist/${encodeURIComponent(symbolToRemove)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      setTradeMessage("❌ Could not remove ticker from watchlist");
      return;
    }
    setDynamicWatchlist((current) => current.filter((item) => item !== symbolToRemove));
    if (selectedChartSymbol === symbolToRemove) {
      const nextSymbol = dynamicWatchlist.find((item) => item !== symbolToRemove) ?? portfolio?.holdings.find((item) => item.symbol !== symbolToRemove)?.symbol ?? "";
      if (nextSymbol) selectSymbol(nextSymbol);
      else {
        setSelectedChartSymbol("");
        setSymbol("");
        setAlertSymbol("");
        setPrice("");
      }
    }
  }

  function selectSymbol(selectedSymbol: string) {
    setSelectedChartSymbol(selectedSymbol);
    setSymbol(selectedSymbol);
    setAlertSymbol(selectedSymbol);
    const livePrice = prices[selectedSymbol] ?? portfolio?.holdings.find((item) => item.symbol === selectedSymbol)?.lastPrice;
    if (livePrice && livePrice > 0) {
      setPrice(String(livePrice));
      setAlertValue(String(livePrice));
    }
  }

  // =========================================================================
  // UNAUTHENTICATED STATE: Sleek dark theme login card
  // =========================================================================
  if (!token) {
    return (
      <div className="bg-background text-on-surface antialiased min-h-screen flex flex-col justify-center items-center px-4 py-12 selection:bg-primary-container selection:text-on-primary-container">
        <div className="max-w-md w-full bg-surface-container border border-outline-variant rounded-DEFAULT p-8 shadow-2xl space-y-6">
          {/* Brand header matching Smart Market Watch */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-DEFAULT bg-surface-container-high border border-outline-variant flex items-center justify-center text-primary shadow-sm">
              <span className="material-symbols-outlined text-primary text-[24px]">change_history</span>
            </div>
            <div>
              <h1 className="text-headline-lg font-headline-lg font-bold tracking-tight text-on-surface">
                Smart Market Watch
              </h1>
              <p className="text-[11px] font-label-numeric-sm text-outline-variant uppercase tracking-widest leading-none mt-0.5">
                Terminal Dashboard &amp; Intelligence Cockpit
              </p>
            </div>
          </div>

          {/* Mode toggle */}
          <div className="grid grid-cols-2 p-1 bg-surface-container-low rounded-DEFAULT border border-outline-variant text-body-sm font-medium">
            <button
              type="button"
              onClick={() => setAuthMode("login")}
              className={`py-1.5 rounded-DEFAULT transition-all text-center ${
                authMode === "login"
                  ? "bg-surface-container-high text-primary font-bold shadow-sm"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => setAuthMode("register")}
              className={`py-1.5 rounded-DEFAULT transition-all text-center ${
                authMode === "register"
                  ? "bg-surface-container-high text-primary font-bold shadow-sm"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              Create Account
            </button>
          </div>

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void authenticate(authMode);
            }}
          >
            <div className="space-y-1.5">
              <label className="block text-body-sm font-medium text-on-surface-variant">Email Address</label>
              <input
                type="email"
                required
                placeholder="trader@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2 bg-surface-container-high border border-outline-variant rounded-DEFAULT text-on-surface placeholder:text-outline focus:outline-none focus:border-primary transition-all text-body-md"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-body-sm font-medium text-on-surface-variant">Password</label>
              <input
                type="password"
                required
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2 bg-surface-container-high border border-outline-variant rounded-DEFAULT text-on-surface placeholder:text-outline focus:outline-none focus:border-primary transition-all text-body-md"
              />
            </div>

            <button
              type="submit"
              className="w-full py-2.5 bg-primary text-on-primary font-bold rounded-DEFAULT hover:bg-primary-fixed shadow-md active:scale-95 transition-all text-body-md flex items-center justify-center space-x-2 mt-2"
            >
              <span className="material-symbols-outlined text-[18px]">lock_open</span>
              <span>{authMode === "login" ? "Enter Trading Terminal" : "Register New Account"}</span>
            </button>
          </form>

          {/* Quick Demo Login Preset Helper */}
          <div className="pt-2 border-t border-outline-variant">
            <span className="text-[11px] font-label-numeric-sm uppercase tracking-wider text-outline block mb-2">
              Quick Fill Credentials
            </span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setEmail("qa_trader_prod@example.com");
                  setPassword("SecurePassword123!");
                }}
                className="px-2.5 py-1 rounded-DEFAULT bg-surface-variant hover:bg-surface-container-high border border-outline-variant text-label-numeric-sm text-on-surface transition-colors"
              >
                QA Trader
              </button>
              <button
                type="button"
                onClick={() => {
                  setEmail("demo@example.com");
                  setPassword("ChangeMe123!");
                }}
                className="px-2.5 py-1 rounded-DEFAULT bg-surface-variant hover:bg-surface-container-high border border-outline-variant text-label-numeric-sm text-on-surface transition-colors"
              >
                Demo Trader
              </button>
            </div>
          </div>

          {tradeMessage && (
            <div className="p-3 bg-error-container/20 border border-error-container rounded-DEFAULT text-error text-body-sm font-medium flex items-center space-x-2">
              <span className="material-symbols-outlined text-[18px]">info</span>
              <span>{tradeMessage}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // =========================================================================
  // AUTHENTICATED STATE: Sleek dark theme dashboard matching Smart Market Watch
  // =========================================================================
  return (
    <div className="bg-background text-on-surface antialiased min-h-screen selection:bg-primary-container selection:text-on-primary-container">
      {/* Toast Alert Popups */}
      {toasts.length > 0 && (
        <div className="fixed top-16 right-6 z-50 flex flex-col gap-2 max-w-sm">
          {toasts.map((t) => (
            <div key={t.id} className="p-3 bg-surface-container border border-primary/50 text-on-surface rounded-DEFAULT shadow-2xl space-y-1">
              <div className="flex items-center space-x-1.5 text-primary text-label-numeric-sm font-bold">
                <span className="material-symbols-outlined text-[16px]">notifications_active</span>
                <span>Price Alert Triggered</span>
              </div>
              <p className="text-body-sm text-on-surface">{t.message}</p>
            </div>
          ))}
        </div>
      )}

      {/* ========================================================================= */}
      {/* SHARED HEADER: Matches /watchlist exactly                                 */}
      {/* ========================================================================= */}
      <header className="flex justify-between items-center w-full px-gutter-desktop h-14 bg-surface border-b border-outline-variant sticky top-0 z-30">
        {/* Left Cluster: Product Wordmark */}
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-2.5">
            <div className="w-7 h-7 rounded-DEFAULT bg-surface-container-high border border-outline-variant flex items-center justify-center text-primary shadow-sm">
              <span className="material-symbols-outlined text-primary text-[18px]">change_history</span>
            </div>
            <div className="flex flex-col">
              <span className="text-headline-md font-headline-md font-bold tracking-tight text-on-surface">
                Smart Market Watch
              </span>
              <span className="text-[10px] font-label-numeric-sm text-outline-variant uppercase tracking-widest leading-none">
                Terminal Dashboard
              </span>
            </div>
          </div>
          {/* Segment Selector */}
          <div className="hidden lg:flex items-center space-x-2 pl-4 border-l border-outline-variant text-body-sm font-body-sm">
            <span className="px-2 py-0.5 rounded-DEFAULT bg-surface-container-high text-on-surface border border-outline-variant text-label-numeric-sm font-label-numeric-sm">
              NSE: Equities Execution ({dynamicWatchlist.length} Tracked)
            </span>
            <span className="text-outline-variant">▾</span>
          </div>
        </div>

        {/* Center Navigation Links */}
        <nav aria-label="Primary Navigation" className="hidden md:flex items-center space-x-8 h-full pt-3">
          <a
            aria-current="page"
            className="text-primary border-b-2 border-primary font-medium pb-3 text-body-md font-body-md cursor-pointer"
          >
            Terminal Dashboard
          </a>
          <Link
            href="/watchlist"
            className="text-on-surface-variant hover:text-on-surface font-medium pb-3 transition-colors duration-150 text-body-md font-body-md"
          >
            What Changed
          </Link>
        </nav>

        {/* Right Cluster: Market Stream Pill + Actions */}
        <div className="flex items-center space-x-3">
          {/* Live Market & Feed Status Pill (Side Updating) */}
          <div
            className="hidden sm:flex items-center space-x-2 bg-surface-container-lowest px-2.5 py-1 rounded-DEFAULT border border-outline-variant font-label-numeric-sm text-label-numeric-sm"
            title={`NSE Market Feed: ${marketStatus?.session || "LIVE"} (${marketStatus?.istTime || "IST"}) · Real-time stream nominal`}
          >
            <span className={`w-2 h-2 rounded-full ${marketStatus?.isOpen ? "bg-primary animate-pulse" : "bg-outline"}`}></span>
            <span className="text-on-surface font-medium">
              {marketStatus?.isOpen ? "LIVE FEED (<1s)" : "SETTLED"}
            </span>
            <span className="text-outline">|</span>
            <span className="text-on-surface-variant font-mono text-[11px]">
              {currentTime ? new Date(currentTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Active"}
            </span>
            <span className="text-outline">|</span>
            <span className="text-on-surface font-semibold">NIFTY 50:</span>
            <span className="text-primary font-semibold">Tracked</span>
          </div>

          {/* Kill Switch Warning indicator */}
          {riskSettings?.killSwitchActive && (
            <span className="px-2.5 py-1 rounded-DEFAULT bg-secondary-container/40 text-secondary border border-secondary/50 text-label-numeric-sm font-label-numeric-sm font-bold animate-pulse">
              ⚠️ KILL SWITCH ON
            </span>
          )}

          {/* Sync News & AI Pipeline Trigger */}
          <button
            className="inline-flex items-center space-x-1.5 px-3 py-1 bg-surface-variant border border-outline-variant hover:border-primary text-on-surface hover:text-primary rounded-DEFAULT text-label-numeric-sm font-label-numeric-sm font-medium transition-all duration-150 active:scale-95 shadow-sm"
            onClick={triggerNewsSync}
            title="Fetch breaking RSS feeds from Moneycontrol, Mint, Economic Times and trigger AI sentiment analysis"
          >
            <span className="material-symbols-outlined text-primary text-[15px]">sync</span>
            <span>Sync News</span>
          </button>

          {/* Emergency Kill Switch */}
          <button
            className={`inline-flex items-center space-x-1.5 px-3 py-1 rounded-DEFAULT text-label-numeric-sm font-label-numeric-sm font-medium transition-all duration-150 active:scale-95 shadow-sm ${
              riskSettings?.killSwitchActive
                ? "bg-primary text-on-primary font-bold"
                : "bg-error-container/30 text-error border border-error/40 hover:bg-error-container/60"
            }`}
            onClick={() => toggleKillSwitch(!riskSettings?.killSwitchActive)}
            title={riskSettings?.killSwitchActive ? "Unlock order execution" : "Instantly block all order execution"}
          >
            <span className="material-symbols-outlined text-[15px]">
              {riskSettings?.killSwitchActive ? "shield" : "gpp_bad"}
            </span>
            <span>{riskSettings?.killSwitchActive ? "Unlock Risk" : "Kill Switch"}</span>
          </button>

          {/* Log out */}
          <button
            className="hidden sm:inline-flex items-center space-x-1 px-2.5 py-1 text-label-numeric-sm font-label-numeric-sm border border-outline-variant/60 rounded-DEFAULT bg-surface-container/60 hover:bg-surface-container text-outline hover:text-on-surface transition-colors duration-150 active:scale-95"
            onClick={() => {
              localStorage.removeItem("accessToken");
              setToken(null);
            }}
            title="Log out"
          >
            <span>Log out</span>
          </button>

          {/* User Profile Avatar */}
          <div
            className="w-7 h-7 rounded-DEFAULT bg-surface-container-high border border-outline-variant flex items-center justify-center ml-1 text-on-surface font-label-numeric-sm text-label-numeric-sm font-bold"
            title="Active user session"
          >
            UT
          </div>
        </div>
      </header>

      {/* ========================================================================= */}
      {/* MAIN CONTAINER: Consistent layout with Watchlist                         */}
      {/* ========================================================================= */}
      <main className="max-w-7xl mx-auto px-gutter-desktop py-6 space-y-6">
        {/* Dynamic Watchlist & Search Bar */}
        <section className="bg-surface-container-low border border-outline-variant rounded-DEFAULT p-4 space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="relative w-full sm:w-96">
              <div className="relative flex items-center">
                <span className="material-symbols-outlined absolute left-3 text-outline text-[18px]">search</span>
                <input
                  placeholder="Search NSE Symbol (e.g. TATA, INFY, RELIANCE)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-surface-container-high border border-outline-variant rounded-DEFAULT text-on-surface placeholder:text-outline text-body-sm focus:outline-none focus:border-primary transition-all"
                />
              </div>

              {/* Autocomplete dropdown */}
              {searchResults.length > 0 && (
                <div className="absolute top-12 left-0 w-full bg-surface-container border border-outline-variant rounded-DEFAULT shadow-2xl z-40 max-h-60 overflow-y-auto">
                  {searchResults.map((item) => (
                    <div
                      key={item.instrumentToken}
                      onClick={() => void addSymbolToWatchlist(item.tradingsymbol)}
                      className="p-3 border-b border-outline-variant/60 hover:bg-surface-container-high cursor-pointer flex items-center justify-between transition-colors"
                    >
                      <div>
                        <strong className="text-on-surface text-body-sm font-semibold">{item.tradingsymbol}</strong>
                        <span className="text-outline text-label-numeric-sm ml-2">{item.name}</span>
                      </div>
                      <span className="px-1.5 py-0.5 rounded-DEFAULT bg-surface-variant text-on-surface font-label-numeric-sm text-label-numeric-sm">
                        {item.exchange}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center space-x-3 text-body-sm text-on-surface-variant">
              <span>Tracked: <strong className="text-on-surface">{dynamicWatchlist.length}</strong> equities</span>
              <span className="text-outline-variant">•</span>
              <span className="text-primary font-semibold">Active Live Stream</span>
            </div>
          </div>

          {/* Ticker Cards Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 pt-2">
            {dynamicWatchlist.length === 0 ? (
              <div className="col-span-full p-6 text-center text-outline text-body-sm">
                Watchlist is empty. Search above to track live NSE stocks.
              </div>
            ) : (
              dynamicWatchlist.map((item) => {
                const meta = quoteMeta[item];
                const currentPrice = prices[item] ?? portfolio?.holdings.find((h) => h.symbol === item)?.lastPrice ?? 0;
                const isSelected = selectedChartSymbol === item;
                const ageSeconds = meta?.timestamp ? Math.max(0, Math.floor((currentTime - meta.timestamp) / 1000)) : null;

                return (
                  <div
                    key={item}
                    onClick={() => selectSymbol(item)}
                    className={`bg-surface-container border rounded-DEFAULT p-3.5 transition-all duration-150 cursor-pointer relative group flex flex-col justify-between ${
                      isSelected
                        ? "border-primary bg-surface-container-high shadow-md"
                        : "border-outline-variant hover:border-primary/50 hover:bg-surface-container-high"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-headline-sm text-headline-sm font-bold text-on-surface">
                        {item}
                      </span>
                      <div className="flex items-center space-x-1.5">
                        <span className="px-1.5 py-0.2 rounded-DEFAULT bg-surface-variant text-on-surface font-label-numeric-sm text-[10px]">
                          {meta?.source === "kite" ? "KITE" : "STREAM"}
                        </span>
                        <button
                          type="button"
                          aria-label={`Remove ${item}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void removeSymbolFromWatchlist(item);
                          }}
                          className="text-outline hover:text-error text-[12px] opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    <div className="my-1 flex items-baseline justify-between">
                      <span className="font-label-numeric-lg text-label-numeric-lg font-bold text-on-surface">
                        ₹{currentPrice > 0 ? currentPrice.toFixed(2) : "—"}
                      </span>
                      {meta?.change !== undefined && meta.change !== 0 && (
                        <span
                          className={`font-label-numeric-sm text-label-numeric-sm font-bold ${
                            meta.change >= 0 ? "text-primary" : "text-secondary"
                          }`}
                        >
                          {meta.change >= 0 ? "+" : ""}
                          {meta.change.toFixed(2)}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-[11px] font-label-numeric-sm text-outline pt-1 border-t border-outline-variant/40">
                      <span>{meta?.timestamp ? new Date(meta.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Awaiting tick"}</span>
                      {isSelected && <span className="text-primary font-bold">● Charting</span>}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* ========================================================================= */}
        {/* SUB-NAVIGATION TABS (Sleek unified terminal chrome)                       */}
        {/* ========================================================================= */}
        <nav className="flex items-center space-x-1.5 border-b border-outline-variant pb-2 overflow-x-auto">
          {[
            { id: "EXECUTION", label: "Execution & Holdings", icon: "show_chart" },
            { id: "INTELLIGENCE", label: "AI News Intelligence", icon: "psychology", count: events.length },
            { id: "SIGNALS", label: "Multi-Factor Signals", icon: "bolt", count: signals.length },
            { id: "ANALYTICS", label: "Quant Analytics", icon: "analytics" },
            { id: "RISK", label: "Risk Controls", icon: "shield" },
            { id: "BROKER", label: "Broker & Margins", icon: "account_balance" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-DEFAULT text-body-sm transition-all duration-150 ${
                activeTab === tab.id
                  ? "bg-surface-container-high text-primary border border-outline-variant font-semibold shadow-sm"
                  : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low"
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                    activeTab === tab.id ? "bg-primary/20 text-primary" : "bg-surface-variant text-outline"
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* ========================================================================= */}
        {/* TAB 1: EXECUTION & HOLDINGS (With AI News Spotlight)                      */}
        {/* ========================================================================= */}
        {activeTab === "EXECUTION" && (
          <div className="space-y-6">
            {/* PROMINENT AI & RSS NEWS FEED SPOTLIGHT ON MAIN VIEW */}
            <section className="bg-surface-container border border-outline-variant rounded-DEFAULT p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-outline-variant pb-3">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-DEFAULT bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                    <span className="material-symbols-outlined text-[20px]">psychology</span>
                  </div>
                  <div>
                    <h2 className="text-headline-sm font-headline-sm font-bold text-on-surface">
                      Live AI &amp; RSS Market Intelligence Feed
                    </h2>
                    <div className="flex items-center space-x-2 flex-wrap">
                      <span className="text-body-sm font-body-sm text-on-surface-variant">
                        Real-time news from Economic Times, Mint &amp; Moneycontrol enriched with Groq Llama-3 sentiment
                      </span>
                      <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-[10px] font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
                        <span>Auto-syncs every 60s</span>
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-2 flex-wrap gap-y-2">
                  {/* Company specific filter toggle */}
                  {selectedChartSymbol && (
                    <div className="flex items-center space-x-1 bg-surface-container-low p-1 rounded-DEFAULT border border-outline-variant text-label-numeric-sm">
                      <button
                        type="button"
                        onClick={() => setNewsFilter("SELECTED")}
                        className={`px-2.5 py-1 rounded-DEFAULT transition-all font-semibold flex items-center space-x-1 ${
                          newsFilter === "SELECTED"
                            ? "bg-primary text-on-primary shadow-sm"
                            : "text-on-surface-variant hover:text-on-surface"
                        }`}
                      >
                        <span>🎯 {selectedChartSymbol}</span>
                        <span
                          className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                            newsFilter === "SELECTED" ? "bg-on-primary/20 text-on-primary" : "bg-primary/20 text-primary"
                          }`}
                        >
                          {selectedStockNews.length}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewsFilter("ALL")}
                        className={`px-2.5 py-1 rounded-DEFAULT transition-all font-semibold flex items-center space-x-1 ${
                          newsFilter === "ALL"
                            ? "bg-primary text-on-primary shadow-sm"
                            : "text-on-surface-variant hover:text-on-surface"
                        }`}
                      >
                        <span>All News</span>
                        <span
                          className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                            newsFilter === "ALL" ? "bg-on-primary/20 text-on-primary" : "bg-surface-variant text-outline"
                          }`}
                        >
                          {events.length}
                        </span>
                      </button>
                    </div>
                  )}

                  <button
                    onClick={() => setActiveTab("INTELLIGENCE")}
                    className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-DEFAULT bg-surface-variant hover:bg-primary hover:text-background text-on-surface text-body-sm font-medium transition-colors border border-outline-variant whitespace-nowrap"
                  >
                    <span>View All {events.length} Catalysts</span>
                    <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                  </button>
                </div>
              </div>

              {/* Notice when showing fallback/sector news for selected symbol */}
              {newsFilter === "SELECTED" && selectedStockNews[0]?.isFallback && (
                <div className="px-3 py-2 rounded-DEFAULT bg-surface-container-high border border-outline-variant/60 text-[12px] text-outline flex items-center justify-between">
                  <div className="flex items-center space-x-1.5">
                    <span className="material-symbols-outlined text-[16px] text-primary">info</span>
                    <span>No direct breaking headlines for <strong>{selectedChartSymbol}</strong> in recent stream · Showing sector &amp; market catalysts:</span>
                  </div>
                  <button
                    onClick={() => setNewsFilter("ALL")}
                    className="text-primary hover:underline font-semibold ml-2 text-[11px]"
                  >
                    Show all {events.length} articles
                  </button>
                </div>
              )}

              {/* News cards snippet */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {(newsFilter === "SELECTED" ? selectedStockNews : events).slice(0, 3).map((ev) => {
                  const upper = (selectedChartSymbol || "").toUpperCase();
                  const isDirect = Array.isArray(ev.primarySymbols) && ev.primarySymbols.includes(upper);
                  const isRipple = Array.isArray(ev.rippleImpacts) && ev.rippleImpacts.some((r: any) => r.symbol === upper);

                  return (
                    <div
                      key={ev.id}
                      className="p-3.5 bg-surface rounded-DEFAULT border border-outline-variant flex flex-col justify-between space-y-2.5 hover:border-primary/40 transition-colors"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between flex-wrap gap-1">
                          <div className="flex items-center space-x-1.5">
                            <span className="text-[10px] font-label-numeric-sm uppercase tracking-wider text-outline">
                              {ev.source.replace("_", " ")}
                            </span>
                            {isDirect && (
                              <span className="px-1.5 py-0.2 rounded-DEFAULT bg-primary/15 text-primary border border-primary/30 text-[9px] font-bold">
                                🎯 Direct
                              </span>
                            )}
                            {isRipple && !isDirect && (
                              <span className="px-1.5 py-0.2 rounded-DEFAULT bg-surface-variant text-on-surface text-[9px] font-bold">
                                ⚡ Ripple
                              </span>
                            )}
                          </div>
                          <span
                            className={`text-[11px] font-bold px-1.5 py-0.5 rounded-DEFAULT ${
                              ev.sentimentScore > 0
                                ? "bg-primary/20 text-primary"
                                : ev.sentimentScore < 0
                                ? "bg-secondary/20 text-secondary"
                                : "bg-surface-variant text-outline"
                            }`}
                          >
                            {ev.sentimentScore > 0 ? "Bullish" : ev.sentimentScore < 0 ? "Bearish" : "Neutral"} (
                            {ev.sentimentScore > 0 ? "+" : ""}
                            {ev.sentimentScore})
                          </span>
                        </div>
                        <a
                          href={ev.url ?? "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="text-body-sm font-semibold text-on-surface hover:text-primary transition-colors line-clamp-2"
                        >
                          {ev.title}
                        </a>
                        <p className="text-[12px] text-on-surface-variant line-clamp-2">
                          {ev.summary}
                        </p>
                        {ev.priceImpactExplanation && (
                          <div className="p-2 rounded-DEFAULT bg-surface-container/70 border border-outline-variant/60 space-y-0.5">
                            <div className="flex items-center space-x-1 text-primary">
                              <span className="material-symbols-outlined text-[13px]">psychology</span>
                              <span className="text-[9px] font-bold uppercase tracking-wider font-label-numeric-sm">
                                Price Impact Mechanism
                              </span>
                            </div>
                            <p className="text-[11px] text-on-surface line-clamp-3 leading-relaxed">
                              {ev.priceImpactExplanation}
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="pt-2 border-t border-outline-variant/40 flex flex-wrap items-center gap-1.5">
                        {ev.primarySymbols.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => selectSymbol(s)}
                            className={`px-1.5 py-0.5 rounded-DEFAULT border text-[10px] font-bold transition-colors ${
                              selectedChartSymbol === s
                                ? "bg-primary text-background border-primary"
                                : "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20"
                            }`}
                            title={`Click to select ${s} across terminal`}
                          >
                            🎯 {s}
                          </button>
                        ))}
                        {ev.rippleImpacts?.slice(0, 1).map((r) => (
                          <button
                            key={`${ev.id}-${r.symbol}`}
                            type="button"
                            onClick={() => selectSymbol(r.symbol)}
                            className={`px-1.5 py-0.5 rounded-DEFAULT text-[10px] transition-colors ${
                              selectedChartSymbol === r.symbol
                                ? "bg-primary text-background"
                                : "bg-surface-variant text-on-surface hover:bg-surface-container-high"
                            }`}
                            title={`Click to select ${r.symbol} across terminal`}
                          >
                            ⚡ {r.symbol} ({r.impactDirection === "POSITIVE" ? "▲" : "▼"})
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Holdings & Order Execution Section */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Holdings Table (8 cols) */}
              <section className="lg:col-span-8 bg-surface-container border border-outline-variant rounded-DEFAULT p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-headline-md font-headline-md font-bold text-on-surface">
                    Holdings &amp; Real-Time Valuation
                  </h2>
                  <span className="px-2 py-0.5 rounded-DEFAULT bg-primary/10 text-primary border border-primary/20 text-label-numeric-sm font-label-numeric-sm font-semibold">
                    Virtual Ledger
                  </span>
                </div>

                {/* Portfolio Summary Metrics */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 bg-surface rounded-DEFAULT border border-outline-variant">
                    <span className="text-caption-caps font-caption-caps text-outline block">AVAILABLE CASH</span>
                    <span className="font-label-numeric-lg text-label-numeric-lg font-bold text-on-surface">
                      ₹{(portfolio?.cashBalance ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="p-3 bg-surface rounded-DEFAULT border border-outline-variant">
                    <span className="text-caption-caps font-caption-caps text-outline block">PORTFOLIO VALUE</span>
                    <span className="font-label-numeric-lg text-label-numeric-lg font-bold text-on-surface">
                      ₹{(portfolio?.totalCurrentValue ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="p-3 bg-surface rounded-DEFAULT border border-outline-variant">
                    <span className="text-caption-caps font-caption-caps text-outline block">UNREALIZED P&amp;L</span>
                    <span
                      className={`font-label-numeric-lg text-label-numeric-lg font-bold ${
                        (portfolio?.totalUnrealizedPnl ?? 0) >= 0 ? "text-primary" : "text-secondary"
                      }`}
                    >
                      {(portfolio?.totalUnrealizedPnl ?? 0) >= 0 ? "+" : ""}₹
                      {(portfolio?.totalUnrealizedPnl ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>

                {/* Holdings Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-outline-variant text-outline font-label-numeric-sm text-label-numeric-sm">
                        <th className="py-2.5 px-3">Symbol</th>
                        <th className="py-2.5 px-3">Qty</th>
                        <th className="py-2.5 px-3">Avg Buy</th>
                        <th className="py-2.5 px-3">Live LTP</th>
                        <th className="py-2.5 px-3">Invested</th>
                        <th className="py-2.5 px-3">Current</th>
                        <th className="py-2.5 px-3">P&amp;L</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/40 font-body-sm">
                      {portfolio?.holdings.map((h) => (
                        <tr key={h.symbol} className="hover:bg-surface-container-high transition-colors">
                          <td className="py-2.5 px-3 font-bold text-on-surface">{h.symbol}</td>
                          <td className="py-2.5 px-3 font-label-numeric-md">{h.quantity}</td>
                          <td className="py-2.5 px-3 font-label-numeric-md">₹{h.averagePrice.toFixed(2)}</td>
                          <td className="py-2.5 px-3 font-label-numeric-md font-semibold text-on-surface">
                            ₹{h.lastPrice.toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 font-label-numeric-md">
                            ₹{h.investedValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                          </td>
                          <td className="py-2.5 px-3 font-label-numeric-md">
                            ₹{h.currentValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                          </td>
                          <td
                            className={`py-2.5 px-3 font-label-numeric-md font-bold ${
                              h.unrealizedPnl >= 0 ? "text-primary" : "text-secondary"
                            }`}
                          >
                            {h.unrealizedPnl >= 0 ? "+" : ""}₹{h.unrealizedPnl.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                      {(!portfolio?.holdings || portfolio.holdings.length === 0) && (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-outline text-body-sm">
                            No open positions. Select a ticker and place an order on the right.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Order Placement Panel (4 cols) */}
              <section className="lg:col-span-4 bg-surface-container border border-outline-variant rounded-DEFAULT p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-headline-md font-headline-md font-bold text-on-surface">
                      Order Execution
                    </h2>
                    <p className="text-[11px] font-label-numeric-sm text-outline">
                      {executionMode === "PAPER" ? "Virtual Simulation (Zero Risk)" : "Live Broker Routing via Kite Connect"}
                    </p>
                  </div>
                  <div className="flex items-center space-x-1 bg-surface-container-low p-1 rounded-DEFAULT border border-outline-variant text-label-numeric-sm">
                    <button
                      type="button"
                      onClick={() => setExecutionMode("PAPER")}
                      className={`px-2.5 py-1 rounded-DEFAULT transition-all font-semibold ${
                        executionMode === "PAPER" ? "bg-primary text-on-primary shadow-sm" : "text-on-surface-variant hover:text-on-surface"
                      }`}
                      title="Paper Trading: Simulated sandbox execution with virtual ledger"
                    >
                      Paper
                    </button>
                    <button
                      type="button"
                      onClick={() => setExecutionMode("LIVE_BROKER")}
                      className={`px-2.5 py-1 rounded-DEFAULT transition-all font-semibold ${
                        executionMode === "LIVE_BROKER" ? "bg-primary text-on-primary shadow-sm" : "text-on-surface-variant hover:text-on-surface"
                      }`}
                      title="Live Trading: Routes orders through configured Zerodha Kite Connect broker API"
                    >
                      Live
                    </button>
                  </div>
                </div>

                <form className="space-y-3" onSubmit={submitTrade}>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-caption-caps text-outline block mb-1">SYMBOL</label>
                      <input
                        value={symbol}
                        onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                        placeholder="INFY"
                        className="w-full px-3 py-2 bg-surface-container-high border border-outline-variant rounded-DEFAULT text-on-surface text-body-sm uppercase font-bold focus:outline-none focus:border-primary"
                      />
                    </div>
                    <div>
                      <label className="text-caption-caps text-outline block mb-1">SIDE</label>
                      <select
                        value={side}
                        onChange={(e) => setSide(e.target.value as "BUY" | "SELL")}
                        className="w-full px-3 py-2 bg-surface-container-high border border-outline-variant rounded-DEFAULT text-on-surface text-body-sm font-bold focus:outline-none focus:border-primary"
                      >
                        <option value="BUY">BUY</option>
                        <option value="SELL">SELL</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-caption-caps text-outline block mb-1">QTY</label>
                      <input
                        type="number"
                        min="1"
                        value={qty}
                        onChange={(e) => setQty(e.target.value)}
                        placeholder="Shares"
                        className="w-full px-3 py-2 bg-surface-container-high border border-outline-variant rounded-DEFAULT text-on-surface text-body-sm font-label-numeric-md focus:outline-none focus:border-primary"
                      />
                    </div>
                    <div>
                      <label className="text-caption-caps text-outline block mb-1">LIMIT PRICE (₹)</label>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        placeholder="Price"
                        className="w-full px-3 py-2 bg-surface-container-high border border-outline-variant rounded-DEFAULT text-on-surface text-body-sm font-label-numeric-md focus:outline-none focus:border-primary"
                      />
                    </div>
                  </div>

                  <div className="p-2.5 bg-surface rounded-DEFAULT border border-outline-variant text-[11px] font-label-numeric-sm text-outline flex justify-between">
                    <span>Est. Value: ₹{(Number(qty || 0) * Number(price || 0)).toLocaleString("en-IN")}</span>
                    <span>Taxes: ₹{((Number(qty || 0) * Number(price || 0)) * 0.0012).toFixed(2)}</span>
                  </div>

                  <button
                    type="submit"
                    disabled={riskSettings?.killSwitchActive}
                    className={`w-full py-2.5 rounded-DEFAULT font-bold text-body-md transition-all active:scale-95 shadow-md flex items-center justify-center space-x-2 ${
                      riskSettings?.killSwitchActive
                        ? "bg-surface-variant text-outline cursor-not-allowed"
                        : side === "BUY"
                        ? "bg-primary text-on-primary hover:bg-primary-fixed"
                        : "bg-secondary-container text-secondary hover:bg-error-container"
                    }`}
                  >
                    <span>{riskSettings?.killSwitchActive ? "Execution Blocked by Kill Switch" : `Execute ${side} Order`}</span>
                  </button>
                </form>

                {tradeMessage && (
                  <div className="p-3 bg-surface-variant border border-outline-variant rounded-DEFAULT text-body-sm text-on-surface">
                    {tradeMessage}
                  </div>
                )}

                {/* Price Alerts Form */}
                <div className="pt-3 border-t border-outline-variant space-y-2.5">
                  <span className="text-caption-caps font-caption-caps text-outline block font-bold">
                    Set Price Alert
                  </span>
                  <form className="space-y-2" onSubmit={createPriceAlert}>
                    <div className="grid grid-cols-3 gap-1.5">
                      <input
                        value={alertSymbol}
                        onChange={(e) => setAlertSymbol(e.target.value.toUpperCase())}
                        placeholder="Symbol"
                        className="px-2 py-1.5 bg-surface-container-high border border-outline-variant rounded-DEFAULT text-on-surface text-label-numeric-sm focus:outline-none focus:border-primary"
                      />
                      <select
                        value={alertCondition}
                        onChange={(e) => setAlertCondition(e.target.value as "GT" | "LT")}
                        className="px-2 py-1.5 bg-surface-container-high border border-outline-variant rounded-DEFAULT text-on-surface text-label-numeric-sm focus:outline-none focus:border-primary"
                      >
                        <option value="GT">&gt; Above</option>
                        <option value="LT">&lt; Below</option>
                      </select>
                      <input
                        type="number"
                        step="0.1"
                        value={alertValue}
                        onChange={(e) => setAlertValue(e.target.value)}
                        placeholder="Target ₹"
                        className="px-2 py-1.5 bg-surface-container-high border border-outline-variant rounded-DEFAULT text-on-surface text-label-numeric-sm focus:outline-none focus:border-primary"
                      />
                    </div>
                    <button
                      type="submit"
                      className="w-full py-1.5 bg-surface-variant hover:bg-surface-container-high border border-outline-variant text-on-surface text-label-numeric-sm font-semibold rounded-DEFAULT transition-colors"
                    >
                      + Add Trigger Alert
                    </button>
                  </form>
                  {alertMessage && <p className="text-body-sm text-primary">{alertMessage}</p>}

                  {alerts.length > 0 && (
                    <div className="space-y-1 pt-1">
                      {alerts.map((a) => (
                        <div
                          key={a.id}
                          className="flex items-center justify-between p-2 bg-surface rounded-DEFAULT border border-outline-variant text-[11px] font-label-numeric-sm"
                        >
                          <span>{a.symbol} {a.condition} ₹{a.value}</span>
                          <button onClick={() => deleteAlert(a.id)} className="text-outline hover:text-error">
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>

            {/* Interactive Google/Yahoo Finance Price Chart Strip */}
            <section className="bg-surface-container border border-outline-variant rounded-DEFAULT p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="font-headline-md font-headline-md font-bold text-on-surface">
                    {selectedChartSymbol || "Select Symbol"}
                  </span>
                  <span className="text-body-sm text-on-surface-variant">
                    Interactive Price Action &amp; Checkpoint Tracker
                  </span>
                </div>
              </div>

              {selectedChartSymbol ? (
                <InteractivePriceChart
                  symbol={selectedChartSymbol}
                  currentPrice={prices[selectedChartSymbol] || 0}
                  checkpointPrice={selectedStockCheckpoint?.checkpointPrice}
                  checkpointTime={selectedStockCheckpoint?.observedAt || watchlistSummary?.lastCheckedAt}
                  visits={selectedStockCheckpoint?.visits}
                  events={selectedStockNews}
                  height={260}
                />
              ) : (
                <div className="h-44 bg-surface rounded-DEFAULT border border-outline-variant p-3 flex items-center justify-center text-outline text-body-sm">
                  Select any ticker from the watchlist or portfolio bar above to inspect live price action &amp; checkpoints.
                </div>
              )}
            </section>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: AI MARKET INTELLIGENCE & EVENT STREAM                              */}
        {/* ========================================================================= */}
        {activeTab === "INTELLIGENCE" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <section className="lg:col-span-8 bg-surface-container border border-outline-variant rounded-DEFAULT p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-outline-variant pb-3">
                <div>
                  <h2 className="text-headline-md font-headline-md font-bold text-on-surface">
                    AI &amp; RSS Market Intelligence Feed
                  </h2>
                  <p className="text-body-sm text-on-surface-variant">
                    Continuous pipeline consuming Indian financial news, scored for sentiment &amp; ripple transmission
                  </p>
                </div>
                <button
                  onClick={triggerNewsSync}
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-primary text-on-primary rounded-DEFAULT text-body-sm font-semibold hover:bg-primary-fixed shadow-md active:scale-95 transition-all"
                >
                  <span className="material-symbols-outlined text-[17px]">sync</span>
                  <span>Sync Fresh News</span>
                </button>
              </div>

              <div className="space-y-3">
                {events.map((ev) => (
                  <article
                    key={ev.id}
                    className="p-4 bg-surface rounded-DEFAULT border border-outline-variant space-y-2.5 hover:border-primary/50 transition-colors"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center space-x-2">
                        <span className="px-2 py-0.5 rounded-DEFAULT bg-surface-variant text-on-surface font-label-numeric-sm text-[11px] font-bold">
                          {ev.eventType}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-DEFAULT font-label-numeric-sm text-[11px] font-bold ${
                            ev.sentimentScore > 0
                              ? "bg-primary/20 text-primary"
                              : ev.sentimentScore < 0
                              ? "bg-secondary/20 text-secondary"
                              : "bg-surface-variant text-outline"
                          }`}
                        >
                          {ev.sentimentScore > 0 ? "Bullish" : ev.sentimentScore < 0 ? "Bearish" : "Neutral"} (
                          {ev.sentimentScore > 0 ? "+" : ""}
                          {ev.sentimentScore})
                        </span>
                        <span className="text-[11px] font-label-numeric-sm text-outline">
                          Confidence: {Math.round(ev.confidence * 100)}%
                        </span>
                      </div>
                      <span className="text-[11px] font-label-numeric-sm text-outline">
                        {ev.source.replace("_", " ")} · {new Date(ev.occurredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>

                    <a
                      href={ev.url ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="text-headline-sm font-headline-sm font-bold text-on-surface hover:text-primary transition-colors block"
                    >
                      {ev.title}
                    </a>

                    <p className="text-body-md text-on-surface-variant leading-relaxed">
                      {ev.summary}
                    </p>

                    {/* AI Rationale */}
                    <div className="p-3 bg-surface-container rounded-DEFAULT border border-outline-variant/60 text-body-sm space-y-1">
                      <div className="flex items-center space-x-1.5 text-primary text-label-numeric-sm font-bold">
                        <span className="material-symbols-outlined text-[16px]">neurology</span>
                        <span>AI REASONING &amp; TRANSMISSION DYNAMICS</span>
                      </div>
                      <p className="text-on-surface-variant text-[12px]">{ev.reasoning}</p>
                    </div>

                    {/* Share Price Impact Explanation */}
                    {ev.priceImpactExplanation && (
                      <div className="p-3 bg-surface-container-high rounded-DEFAULT border border-primary/25 text-body-sm space-y-1">
                        <div className="flex items-center space-x-1.5 text-primary text-label-numeric-sm font-bold">
                          <span className="material-symbols-outlined text-[16px]">psychology</span>
                          <span className="uppercase tracking-wider">How this affects share price</span>
                        </div>
                        <p className="text-on-surface text-[12px] leading-relaxed">{ev.priceImpactExplanation}</p>
                      </div>
                    )}

                    {/* Direct Tickers & Second-order ripples */}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {ev.primarySymbols.map((s) => (
                        <span
                          key={s}
                          className="px-2 py-0.5 rounded-DEFAULT bg-primary/10 text-primary border border-primary/30 text-label-numeric-sm font-bold"
                        >
                          🎯 Direct: {s}
                        </span>
                      ))}
                      {ev.rippleImpacts?.map((r) => (
                        <span
                          key={`${ev.id}-${r.symbol}`}
                          className="px-2 py-0.5 rounded-DEFAULT bg-surface-variant text-on-surface border border-outline-variant text-label-numeric-sm"
                          title={r.rationale}
                        >
                          ⚡ Ripple: {r.symbol} ({r.impactDirection === "POSITIVE" ? "▲" : "▼"} {r.sector})
                        </span>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </section>

            {/* Transmission Channels Side Panel */}
            <section className="lg:col-span-4 bg-surface-container border border-outline-variant rounded-DEFAULT p-5 space-y-4">
              <h2 className="text-headline-md font-headline-md font-bold text-on-surface">
                Macro Transmission Channels
              </h2>
              <div className="space-y-3">
                <div className="p-3 bg-surface rounded-DEFAULT border border-outline-variant space-y-1">
                  <strong className="text-body-sm text-primary">🛢️ Crude Oil Surge:</strong>
                  <p className="text-[12px] text-on-surface-variant">
                    +RELIANCE (Upstream revenue expansion), -ASIANPAINT (Solvent raw material margins), -INDIGO (Aviation turbine fuel inflation).
                  </p>
                </div>
                <div className="p-3 bg-surface rounded-DEFAULT border border-outline-variant space-y-1">
                  <strong className="text-body-sm text-primary">💻 US Enterprise Cloud IT Spend:</strong>
                  <p className="text-[12px] text-on-surface-variant">
                    +TCS, +INFY deal pipeline acceleration and dollar realization gains.
                  </p>
                </div>
                <div className="p-3 bg-surface rounded-DEFAULT border border-outline-variant space-y-1">
                  <strong className="text-body-sm text-primary">🏦 RBI Monetary Policy &amp; Repo:</strong>
                  <p className="text-[12px] text-on-surface-variant">
                    +HDFCBANK, +SBIN credit expansion &amp; bond treasury mark-to-market gains on yield easing.
                  </p>
                </div>
                <div className="p-3 bg-surface rounded-DEFAULT border border-outline-variant space-y-1">
                  <strong className="text-body-sm text-primary">🚗 Auto Components &amp; EV Shift:</strong>
                  <p className="text-[12px] text-on-surface-variant">
                    +TATAMOTORS, +M&amp;M product launch volumes and operating leverage.
                  </p>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: MULTI-FACTOR SIGNALS                                              */}
        {/* ========================================================================= */}
        {activeTab === "SIGNALS" && (
          <section className="bg-surface-container border border-outline-variant rounded-DEFAULT p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-outline-variant pb-3">
              <div>
                <div className="flex items-center gap-2.5">
                  <h2 className="text-headline-md font-headline-md font-bold text-on-surface">
                    Multi-Factor Quant Signals
                  </h2>
                  <button
                    type="button"
                    onClick={() => setShowSignalMethodology((prev) => !prev)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container-high border border-outline-variant text-[11px] font-semibold text-primary hover:bg-surface-container-highest hover:border-primary/40 transition-all cursor-pointer shadow-xs active:scale-95"
                    title="Toggle model methodology, formula, and scoring breakdown"
                  >
                    <span className="material-symbols-outlined text-[14px]">
                      {showSignalMethodology ? "visibility_off" : "info"}
                    </span>
                    <span>{showSignalMethodology ? "Hide Model Guide" : "Model Guide & Scoring Info"}</span>
                  </button>
                </div>
                <p className="text-body-sm text-on-surface-variant mt-0.5">
                  Technical momentum (40%), News sentiment (35%), and Macro transmission (25%)
                </p>
              </div>
              <button
                onClick={() => generateSignalForSymbol(selectedChartSymbol)}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-primary text-on-primary rounded-DEFAULT text-body-sm font-semibold hover:bg-primary-fixed shadow-md active:scale-95 transition-all"
              >
                <span className="material-symbols-outlined text-[17px]">bolt</span>
                <span>Generate Signal for {selectedChartSymbol || "Ticker"}</span>
              </button>
            </div>

            {/* Collapsible Model Methodology & Scoring Info */}
            {showSignalMethodology && (
              <div className="bg-surface-container-low border border-primary/20 rounded-DEFAULT p-4 space-y-3 transition-all">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-outline-variant/40 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-[18px]">psychology</span>
                    <h3 className="text-body-md font-bold text-on-surface">
                      How Quant Signals Are Evaluated
                    </h3>
                  </div>
                  <span className="text-[11px] font-mono text-outline bg-surface px-2 py-0.5 rounded border border-outline-variant/50">
                    Composite = (0.40 × Tech) + (0.35 × Sentiment) + (0.25 × Macro)
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  {/* Composite Card */}
                  <div className="p-3 bg-surface rounded border border-outline-variant/60 space-y-1.5 shadow-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-primary tracking-wider uppercase">Composite Score</span>
                      <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-bold">100% Final</span>
                    </div>
                    <p className="text-[12px] text-on-surface leading-snug">
                      Weighted synthesis combining all 3 independent quantitative pillars (-1.00 to +1.00).
                    </p>
                    <div className="text-[11px] font-mono space-y-0.5 pt-1 text-on-surface-variant border-t border-outline-variant/40">
                      <div className="flex justify-between"><span className="text-primary font-bold">≥ +0.20:</span> <span>BULLISH</span></div>
                      <div className="flex justify-between"><span className="text-secondary font-bold">≤ -0.20:</span> <span>BEARISH</span></div>
                      <div className="flex justify-between"><span className="text-outline font-bold">-0.20 to +0.20:</span> <span>NEUTRAL</span></div>
                    </div>
                  </div>

                  {/* Technical Card */}
                  <div className="p-3 bg-surface rounded border border-outline-variant/60 space-y-1.5 shadow-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-on-surface tracking-wider uppercase">Technical Momentum</span>
                      <span className="text-[10px] bg-surface-container-highest text-outline px-1.5 py-0.5 rounded font-bold">40% Weight</span>
                    </div>
                    <p className="text-[12px] text-on-surface leading-snug">
                      Price trend alignment &amp; mean-reversion signals calculated from historical candle bars.
                    </p>
                    <div className="text-[11px] text-on-surface-variant space-y-1 pt-1 border-t border-outline-variant/40">
                      <div>• <strong>SMA20 &amp; SMA50:</strong> Trend bias &amp; moving support/resistance.</div>
                      <div>• <strong>14-period RSI:</strong> Healthy momentum (50–75) vs oversold (&lt;30) / overbought (&gt;75).</div>
                    </div>
                  </div>

                  {/* Sentiment Card */}
                  <div className="p-3 bg-surface rounded border border-outline-variant/60 space-y-1.5 shadow-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-on-surface tracking-wider uppercase">News Sentiment</span>
                      <span className="text-[10px] bg-surface-container-highest text-outline px-1.5 py-0.5 rounded font-bold">35% Weight</span>
                    </div>
                    <p className="text-[12px] text-on-surface leading-snug">
                      AI sentiment parsing of corporate announcements, earnings beats/misses, and deal wins.
                    </p>
                    <div className="text-[11px] text-on-surface-variant space-y-1 pt-1 border-t border-outline-variant/40">
                      <div>• <strong>Direct Catalysts:</strong> Company filings, executive changes, guidance shifts.</div>
                      <div>• <strong>Range:</strong> Scaled -1.0 (severe headwind) to +1.0 (strong bullish catalyst).</div>
                    </div>
                  </div>

                  {/* Macro Card */}
                  <div className="p-3 bg-surface rounded border border-outline-variant/60 space-y-1.5 shadow-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-on-surface tracking-wider uppercase">Macro Transmission</span>
                      <span className="text-[10px] bg-surface-container-highest text-outline px-1.5 py-0.5 rounded font-bold">25% Weight</span>
                    </div>
                    <p className="text-[12px] text-on-surface leading-snug">
                      Second-order sector ripple effects propagated through the cross-market knowledge graph.
                    </p>
                    <div className="text-[11px] text-on-surface-variant space-y-1 pt-1 border-t border-outline-variant/40">
                      <div>• <strong>Cross-Impact:</strong> Interest rates, currency, crude oil, and sector bellwether moves.</div>
                      <div>• <strong>Spillover:</strong> Positive or negative ripples cascading into peer equities.</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-outline-variant text-outline font-label-numeric-sm text-label-numeric-sm">
                    <th className="py-2.5 px-3">Symbol</th>
                    <th className="py-2.5 px-3">Direction</th>
                    <th
                      className="py-2.5 px-3 cursor-help group"
                      title="Weighted Composite Score: (40% Tech) + (35% Sentiment) + (25% Macro). ≥+0.20 Bullish, ≤-0.20 Bearish, between is Neutral."
                    >
                      <span className="inline-flex items-center gap-1 text-on-surface">
                        Composite
                        <span className="material-symbols-outlined text-[13px] text-outline group-hover:text-primary transition-colors">help</span>
                      </span>
                    </th>
                    <th
                      className="py-2.5 px-3 cursor-help group"
                      title="Technical Momentum (40%): SMA20, SMA50 trend position and 14-period RSI (-1.0 to +1.0)."
                    >
                      <span className="inline-flex items-center gap-1">
                        Technical (40%)
                        <span className="material-symbols-outlined text-[13px] text-outline group-hover:text-primary transition-colors">help</span>
                      </span>
                    </th>
                    <th
                      className="py-2.5 px-3 cursor-help group"
                      title="News Sentiment (35%): AI evaluation of recent company news, earnings, and disclosures (-1.0 to +1.0)."
                    >
                      <span className="inline-flex items-center gap-1">
                        Sentiment (35%)
                        <span className="material-symbols-outlined text-[13px] text-outline group-hover:text-primary transition-colors">help</span>
                      </span>
                    </th>
                    <th
                      className="py-2.5 px-3 cursor-help group"
                      title="Macro Transmission (25%): Second-order ripple effects from sector and macroeconomic forces (-1.0 to +1.0)."
                    >
                      <span className="inline-flex items-center gap-1">
                        Macro (25%)
                        <span className="material-symbols-outlined text-[13px] text-outline group-hover:text-primary transition-colors">help</span>
                      </span>
                    </th>
                    <th className="py-2.5 px-3">Horizon</th>
                    <th className="py-2.5 px-3">Rationale</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/40 font-body-sm">
                  {signals.map((s) => (
                    <tr key={s.id} className="hover:bg-surface-container-high transition-colors">
                      <td className="py-2.5 px-3 font-bold text-on-surface">{s.symbol}</td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-DEFAULT text-label-numeric-sm font-bold ${
                            s.direction === "BULLISH"
                              ? "bg-primary/20 text-primary"
                              : s.direction === "BEARISH"
                              ? "bg-secondary/20 text-secondary"
                              : "bg-surface-variant text-outline"
                          }`}
                        >
                          {s.direction}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-label-numeric-md font-bold text-on-surface">
                        {s.compositeScore > 0 ? "+" : ""}{s.compositeScore}
                      </td>
                      <td className="py-2.5 px-3 font-label-numeric-md">
                        {s.technicalScore !== null ? (s.technicalScore > 0 ? `+${s.technicalScore}` : s.technicalScore) : "—"}
                      </td>
                      <td className="py-2.5 px-3 font-label-numeric-md">
                        {s.sentimentScore !== null ? (s.sentimentScore > 0 ? `+${s.sentimentScore}` : s.sentimentScore) : "—"}
                      </td>
                      <td className="py-2.5 px-3 font-label-numeric-md">
                        {s.macroScore !== null ? (s.macroScore > 0 ? `+${s.macroScore}` : s.macroScore) : "—"}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="px-1.5 py-0.5 rounded-DEFAULT bg-surface-variant text-outline text-[11px] font-label-numeric-sm">
                          {s.horizon}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-on-surface-variant text-[12px] max-w-xs truncate" title={s.rationale}>
                        {s.rationale}
                      </td>
                    </tr>
                  ))}
                  {signals.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-outline text-body-sm">
                        No proposed signals yet. Click &quot;Generate Signal&quot; above to run multi-factor evaluation.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ========================================================================= */}
        {/* TAB 4: QUANT ANALYTICS                                                    */}
        {/* ========================================================================= */}
        {activeTab === "ANALYTICS" && (
          <section className="bg-surface-container border border-outline-variant rounded-DEFAULT p-5 space-y-6">
            <h2 className="text-headline-md font-headline-md font-bold text-on-surface">
              Quantitative Portfolio Performance &amp; Attribution
            </h2>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="p-3 bg-surface rounded-DEFAULT border border-outline-variant">
                <span className="text-caption-caps font-caption-caps text-outline block">TOTAL TRADES</span>
                <span className="font-label-numeric-lg text-label-numeric-lg font-bold text-on-surface">
                  {analytics?.totalTrades ?? 0}
                </span>
              </div>
              <div className="p-3 bg-surface rounded-DEFAULT border border-outline-variant">
                <span className="text-caption-caps font-caption-caps text-outline block">WIN RATE</span>
                <span className="font-label-numeric-lg text-label-numeric-lg font-bold text-primary">
                  {analytics?.winRatePct ?? 0}%
                </span>
              </div>
              <div className="p-3 bg-surface rounded-DEFAULT border border-outline-variant">
                <span className="text-caption-caps font-caption-caps text-outline block">PROFIT FACTOR</span>
                <span className="font-label-numeric-lg text-label-numeric-lg font-bold text-on-surface">
                  {analytics?.profitFactor ?? 0}
                </span>
              </div>
              <div className="p-3 bg-surface rounded-DEFAULT border border-outline-variant">
                <span className="text-caption-caps font-caption-caps text-outline block">SHARPE RATIO</span>
                <span className="font-label-numeric-lg text-label-numeric-lg font-bold text-on-surface">
                  {analytics?.sharpeRatio ?? 0}
                </span>
              </div>
              <div className="p-3 bg-surface rounded-DEFAULT border border-outline-variant">
                <span className="text-caption-caps font-caption-caps text-outline block">MAX DRAWDOWN</span>
                <span className="font-label-numeric-lg text-label-numeric-lg font-bold text-secondary">
                  {analytics?.maxDrawdownPct ?? 0}%
                </span>
              </div>
              <div className="p-3 bg-surface rounded-DEFAULT border border-outline-variant">
                <span className="text-caption-caps font-caption-caps text-outline block">NET REALIZED P&amp;L</span>
                <span
                  className={`font-label-numeric-lg text-label-numeric-lg font-bold ${
                    (analytics?.netRealizedPnl ?? 0) >= 0 ? "text-primary" : "text-secondary"
                  }`}
                >
                  ₹{(analytics?.netRealizedPnl ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            <div className="pt-2">
              <h3 className="text-headline-sm font-headline-sm font-bold text-on-surface mb-3">
                Sector Attribution Breakdown
              </h3>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-outline-variant text-outline font-label-numeric-sm text-label-numeric-sm">
                    <th className="py-2 px-3">Sector</th>
                    <th className="py-2 px-3">Trade Count</th>
                    <th className="py-2 px-3">Realized P&amp;L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/40 font-body-sm">
                  {analytics?.sectorBreakdown.map((sec) => (
                    <tr key={sec.sector}>
                      <td className="py-2.5 px-3 font-bold text-on-surface">{sec.sector}</td>
                      <td className="py-2.5 px-3 font-label-numeric-md">{sec.tradeCount}</td>
                      <td
                        className={`py-2.5 px-3 font-label-numeric-md font-bold ${
                          sec.pnl >= 0 ? "text-primary" : "text-secondary"
                        }`}
                      >
                        ₹{sec.pnl.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ========================================================================= */}
        {/* TAB 5: RISK CONTROLS                                                      */}
        {/* ========================================================================= */}
        {activeTab === "RISK" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <section className="bg-surface-container border border-outline-variant rounded-DEFAULT p-5 space-y-4">
              <h2 className="text-headline-md font-headline-md font-bold text-on-surface">
                Pre-Trade Capital Limits
              </h2>
              <div className="space-y-3">
                <div className="p-3 bg-surface rounded-DEFAULT border border-outline-variant">
                  <span className="text-caption-caps text-outline block">MAX DAILY LOSS THRESHOLD</span>
                  <span className="font-label-numeric-lg text-label-numeric-lg font-bold text-secondary">
                    ₹{Number(riskSettings?.maxDailyLoss ?? 50000).toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="p-3 bg-surface rounded-DEFAULT border border-outline-variant">
                  <span className="text-caption-caps text-outline block">MAX SINGLE POSITION SIZE</span>
                  <span className="font-label-numeric-lg text-label-numeric-lg font-bold text-on-surface">
                    ₹{Number(riskSettings?.maxPositionSize ?? 200000).toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="p-3 bg-surface rounded-DEFAULT border border-outline-variant">
                  <span className="text-caption-caps text-outline block">MAX SINGLE SECTOR EXPOSURE</span>
                  <span className="font-label-numeric-lg text-label-numeric-lg font-bold text-primary">
                    {riskSettings?.maxSectorExposurePct ?? 35}%
                  </span>
                </div>
              </div>
            </section>

            <section className="bg-surface-container border border-outline-variant rounded-DEFAULT p-5 space-y-4">
              <h2 className="text-headline-md font-headline-md font-bold text-on-surface">
                Emergency Controls &amp; Circuit Breakers
              </h2>
              <div className="p-4 bg-surface rounded-DEFAULT border border-outline-variant space-y-3">
                <h3 className="font-bold text-on-surface">Account Circuit Breaker (Kill Switch)</h3>
                <p className="text-body-sm text-on-surface-variant">
                  When active, all order placement is blocked instantly at the API gateway layer, protecting against runaway algo execution or emotional revenge trading.
                </p>
                <button
                  onClick={() => toggleKillSwitch(!riskSettings?.killSwitchActive)}
                  className={`w-full py-3 rounded-DEFAULT font-bold text-body-md transition-all active:scale-95 shadow-md flex items-center justify-center space-x-2 ${
                    riskSettings?.killSwitchActive
                      ? "bg-primary text-on-primary hover:bg-primary-fixed"
                      : "bg-error-container text-on-error-container hover:bg-error"
                  }`}
                >
                  <span className="material-symbols-outlined">
                    {riskSettings?.killSwitchActive ? "shield" : "gpp_bad"}
                  </span>
                  <span>{riskSettings?.killSwitchActive ? "🛡️ Kill Switch ACTIVE (Click to Unlock)" : "🛑 Activate Emergency Kill Switch"}</span>
                </button>
              </div>
            </section>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 6: ZERODHA BROKER & MARGINS                                          */}
        {/* ========================================================================= */}
        {activeTab === "BROKER" && (
          <section className="bg-surface-container border border-outline-variant rounded-DEFAULT p-5 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-outline-variant pb-3">
              <div>
                <h2 className="text-headline-md font-headline-md font-bold text-on-surface">
                  Zerodha Kite Live Connection &amp; Margins
                </h2>
                <p className="text-body-sm text-on-surface-variant">
                  Direct broker API connection for real orders and live margin monitoring
                </p>
              </div>
              <button
                onClick={connectZerodha}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-primary text-on-primary rounded-DEFAULT text-body-sm font-semibold hover:bg-primary-fixed shadow-md active:scale-95 transition-all"
              >
                <span className="material-symbols-outlined text-[17px]">link</span>
                <span>Connect Zerodha (OAuth)</span>
              </button>
            </div>

            {brokerMargins?.equity && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 bg-surface rounded-DEFAULT border border-outline-variant">
                  <span className="text-caption-caps text-outline block">AVAILABLE CASH</span>
                  <span className="font-label-numeric-lg text-label-numeric-lg font-bold text-on-surface">
                    ₹{brokerMargins.equity.available.cash.toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="p-3 bg-surface rounded-DEFAULT border border-outline-variant">
                  <span className="text-caption-caps text-outline block">COLLATERAL MARGIN</span>
                  <span className="font-label-numeric-lg text-label-numeric-lg font-bold text-on-surface">
                    ₹{brokerMargins.equity.available.collateral.toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="p-3 bg-surface rounded-DEFAULT border border-outline-variant">
                  <span className="text-caption-caps text-outline block">UTILIZED SPAN &amp; EXPOSURE</span>
                  <span className="font-label-numeric-lg text-label-numeric-lg font-bold text-on-surface">
                    ₹{brokerMargins.equity.utilised.exposure.toLocaleString("en-IN")}
                  </span>
                </div>
              </div>
            )}

            <div>
              <h3 className="text-headline-sm font-headline-sm font-bold text-on-surface mb-3">
                Live Broker Orders
              </h3>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-outline-variant text-outline font-label-numeric-sm text-label-numeric-sm">
                    <th className="py-2 px-3">Order ID</th>
                    <th className="py-2 px-3">Symbol</th>
                    <th className="py-2 px-3">Side</th>
                    <th className="py-2 px-3">Type</th>
                    <th className="py-2 px-3">Qty</th>
                    <th className="py-2 px-3">Price</th>
                    <th className="py-2 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/40 font-body-sm">
                  {brokerOrders.map((o) => (
                    <tr key={o.order_id}>
                      <td className="py-2.5 px-3 font-mono text-[12px]">{o.order_id}</td>
                      <td className="py-2.5 px-3 font-bold text-on-surface">{o.tradingsymbol}</td>
                      <td className="py-2.5 px-3">
                        <span className={`font-bold ${o.transaction_type === "BUY" ? "text-primary" : "text-secondary"}`}>
                          {o.transaction_type}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">{o.order_type}</td>
                      <td className="py-2.5 px-3 font-label-numeric-md">{o.quantity}</td>
                      <td className="py-2.5 px-3 font-label-numeric-md">₹{o.price}</td>
                      <td className="py-2.5 px-3">
                        <span className="px-1.5 py-0.5 rounded-DEFAULT bg-surface-variant text-outline text-[11px] font-label-numeric-sm">
                          {o.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {brokerOrders.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-outline text-body-sm">
                        No active broker orders placed today.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
