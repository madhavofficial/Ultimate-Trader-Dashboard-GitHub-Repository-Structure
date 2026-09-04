"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { io, Socket } from "socket.io-client";

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
  occurredAt: string;
};

type Signal = {
  id: string;
  symbol: string;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  compositeScore: number;
  technicalScore: number;
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

type Tick = { symbol?: string; last_price: number };

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? API_URL;

export default function DashboardPage() {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [activeTab, setActiveTab] = useState<"EXECUTION" | "INTELLIGENCE" | "SIGNALS" | "ANALYTICS" | "RISK" | "BROKER">("EXECUTION");

  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [events, setEvents] = useState<MarketEvent[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [riskSettings, setRiskSettings] = useState<RiskSettings | null>(null);
  const [marketStatus, setMarketStatus] = useState<MarketStatus | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [selectedChartSymbol, setSelectedChartSymbol] = useState("");
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [toasts, setToasts] = useState<TriggeredToast[]>([]);

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

  useEffect(() => {
    setToken(localStorage.getItem("accessToken"));
  }, []);

  useEffect(() => {
    if (!token) return;

    const socket: Socket = io(SOCKET_URL, {
      auth: { token },
      withCredentials: true,
    });

    const onTicks = (ticks: Tick[]) => {
      setPrices((prev) => {
        const next = { ...prev };
        ticks.forEach((t) => {
          if (t.symbol) next[t.symbol] = t.last_price;
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
      localStorage.setItem("accessToken", body.accessToken ?? "");
      setToken(body.accessToken ?? null);
    } catch {
      setTradeMessage("Server connection error");
    }
  }

  async function loadPortfolio(accessToken: string) {
    const res = await fetch(`${API_URL}/portfolio`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.ok) setPortfolio((await res.json()).portfolio);
  }

  async function loadWatchlist(accessToken: string) {
    const res = await fetch(`${API_URL}/market/watchlist`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.ok) setDynamicWatchlist((await res.json()).watchlist?.map((item: { symbol: string }) => item.symbol) ?? []);
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
    await fetch(`${API_URL}/intelligence/sync-news`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    void loadIntelligence(token);
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

  if (!token) {
    return (
      <main className="shell">
        <section className="panel" style={{ maxWidth: 420, margin: "15vh auto" }}>
          <h1>Ultimate Trader</h1>
          <p className="muted">Indian Equities Intelligence &amp; Quantitative Cockpit</p>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void authenticate("login"); }}>
            <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <div className="row">
              <button className="primary" type="submit">Log in</button>
              <button className="secondary" type="button" onClick={() => void authenticate("register")}>Register</button>
            </div>
          </form>
          {tradeMessage && <p className="muted" style={{ marginTop: 12 }}>{tradeMessage}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      {/* Toast Alert Popups */}
      <div className="toast-container">
        {toasts.map((t) => (
          <div className="toast" key={t.id}>
            <strong>🔔 Price Alert Triggered</strong>
            <p style={{ margin: "4px 0 0", color: "#eef3ff" }}>{t.message}</p>
          </div>
        ))}
      </div>

      {/* Header with Market Session & Kill Switch */}
      <header className="header">
        <div>
          <div className="row" style={{ gap: 12 }}>
            <h1>Market Intelligence Cockpit</h1>
            <span className={`badge ${marketStatus?.isOpen ? "badge-positive" : "badge-neutral"}`}>
              ● {marketStatus?.session ?? "SESSION"} ({marketStatus?.istTime ?? "IST"})
            </span>
            {riskSettings?.killSwitchActive && (
              <span className="badge badge-negative" style={{ animation: "pulse 1s infinite" }}>
                ⚠️ KILL SWITCH ACTIVE
              </span>
            )}
          </div>
          <span className="muted">{marketStatus?.message ?? "Live tick streaming, AI decision support & multi-factor alpha"}</span>
        </div>
        <div className="row">
          <button className="secondary" onClick={triggerNewsSync}>🔄 Sync News</button>
          <button
            className={riskSettings?.killSwitchActive ? "primary" : "danger"}
            onClick={() => toggleKillSwitch(!riskSettings?.killSwitchActive)}
          >
            {riskSettings?.killSwitchActive ? "🛡️ Deactivate Kill Switch" : "🛑 Emergency Kill Switch"}
          </button>
          <button className="secondary" onClick={() => { localStorage.removeItem("accessToken"); setToken(null); }}>Log out</button>
        </div>
      </header>

      {/* Dynamic Watchlist Bar with Search Autocomplete */}
      <div className="row" style={{ marginBottom: 12, position: "relative" }}>
        <input
          placeholder="🔍 Search NSE Symbol (e.g. TATA, HDFC, RELIANCE)..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ maxWidth: 380 }}
        />
        {isSearching && <span className="muted" style={{ fontSize: 12 }}>Searching...</span>}

        {/* Autocomplete Dropdown */}
        {searchResults.length > 0 && (
          <div style={{ position: "absolute", top: 44, left: 0, width: 380, background: "#131b30", border: "1px solid var(--line)", borderRadius: 8, zIndex: 100, boxShadow: "0 8px 24px rgba(0,0,0,0.6)", maxHeight: 220, overflowY: "auto" }}>
            {searchResults.map((item) => (
              <div
                key={item.instrumentToken}
                onClick={() => void addSymbolToWatchlist(item.tradingsymbol)}
                style={{ padding: "8px 12px", borderBottom: "1px solid var(--line)", cursor: "pointer", display: "flex", justifyContent: "space-between" }}
              >
                <div>
                  <strong>{item.tradingsymbol}</strong>
                  <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>{item.name}</span>
                </div>
                <span className="badge badge-blue">{item.exchange}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <section className="ticker">
        {dynamicWatchlist.map((item) => {
          const currentPrice = prices[item] ?? portfolio?.holdings.find((h) => h.symbol === item)?.lastPrice ?? 0;
          const isSelected = selectedChartSymbol === item;
          return (
            <div
              className="panel ticker-card"
              key={item}
              style={{ cursor: "pointer", borderColor: isSelected ? "var(--blue)" : "var(--line)" }}
              onClick={() => selectSymbol(item)}
            >
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="muted">NSE · {item}</span>
                <div className="row" style={{ gap: 6 }}>
                  <span className="badge badge-blue">LTP</span>
                  <button
                    type="button"
                    className="danger"
                    aria-label={`Remove ${item} from watchlist`}
                    onClick={(event) => { event.stopPropagation(); void removeSymbolFromWatchlist(item); }}
                    style={{ padding: "2px 6px", fontSize: 11 }}
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div className="metric">₹{currentPrice > 0 ? currentPrice.toFixed(2) : "—"}</div>
              <span className="muted" style={{ fontSize: 10 }}>Click to chart &amp; trade</span>
            </div>
          );
        })}
      </section>

      {/* Navigation Tabs */}
      <div className="row" style={{ marginBottom: 16, borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
        <button className={activeTab === "EXECUTION" ? "primary" : "secondary"} onClick={() => setActiveTab("EXECUTION")}>
          📊 Execution &amp; Holdings
        </button>
        <button className={activeTab === "INTELLIGENCE" ? "primary" : "secondary"} onClick={() => setActiveTab("INTELLIGENCE")}>
          🌐 Market Intelligence ({events.length})
        </button>
        <button className={activeTab === "SIGNALS" ? "primary" : "secondary"} onClick={() => setActiveTab("SIGNALS")}>
          ⚡ Multi-Factor Signals ({signals.length})
        </button>
        <button className={activeTab === "ANALYTICS" ? "primary" : "secondary"} onClick={() => setActiveTab("ANALYTICS")}>
          📈 Quant Analytics
        </button>
        <button className={activeTab === "RISK" ? "primary" : "secondary"} onClick={() => setActiveTab("RISK")}>
          🛡️ Risk Controls
        </button>
        <button className={activeTab === "BROKER" ? "primary" : "secondary"} onClick={() => setActiveTab("BROKER")}>
          🔗 Zerodha Broker &amp; Margins
        </button>
      </div>

      {/* TAB 1: EXECUTION & HOLDINGS */}
      {activeTab === "EXECUTION" && (
        <div className="grid">
          {/* Holdings & Real-time PnL */}
          <section className="panel wide">
            <h2>
              Holdings &amp; Real-Time Valuation
              <span className="badge badge-blue">Virtual Ledger</span>
            </h2>
            <div className="row" style={{ gap: 24, marginBottom: 14 }}>
              <div>
                <span className="muted">Available Cash</span>
                <div className="metric">₹{(portfolio?.cashBalance ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
              </div>
              <div>
                <span className="muted">Portfolio Value</span>
                <div className="metric">₹{(portfolio?.totalCurrentValue ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
              </div>
              <div>
                <span className="muted">Unrealized P&amp;L</span>
                <div className={`metric ${(portfolio?.totalUnrealizedPnl ?? 0) >= 0 ? "positive" : "negative"}`}>
                  {(portfolio?.totalUnrealizedPnl ?? 0) >= 0 ? "+" : ""}₹{(portfolio?.totalUnrealizedPnl ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Qty</th>
                  <th>Avg Buy</th>
                  <th>Live LTP</th>
                  <th>Invested</th>
                  <th>Current</th>
                  <th>P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {portfolio?.holdings.map((h) => (
                  <tr key={h.symbol}>
                    <td><strong>{h.symbol}</strong></td>
                    <td>{h.quantity}</td>
                    <td>₹{h.averagePrice.toFixed(2)}</td>
                    <td>₹{h.lastPrice.toFixed(2)}</td>
                    <td>₹{h.investedValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td>₹{h.currentValue.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td className={h.unrealizedPnl >= 0 ? "positive" : "negative"}>
                      {h.unrealizedPnl >= 0 ? "+" : ""}₹{h.unrealizedPnl.toFixed(2)}
                    </td>
                  </tr>
                ))}
                {(!portfolio?.holdings || portfolio.holdings.length === 0) && (
                  <tr>
                    <td colSpan={7} className="muted" style={{ textAlign: "center", padding: 24 }}>No open holdings. Place a trade below.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          {/* Trade Placement Drawer */}
          <section className="panel side">
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
              <h2>Order Execution</h2>
              <div className="row" style={{ gap: 4 }}>
                <button
                  type="button"
                  className={executionMode === "PAPER" ? "primary" : "secondary"}
                  style={{ fontSize: 11, padding: "4px 8px" }}
                  onClick={() => setExecutionMode("PAPER")}
                >
                  Paper
                </button>
                <button
                  type="button"
                  className={executionMode === "LIVE_BROKER" ? "primary" : "secondary"}
                  style={{ fontSize: 11, padding: "4px 8px" }}
                  onClick={() => setExecutionMode("LIVE_BROKER")}
                >
                  Live (Zerodha)
                </button>
              </div>
            </div>

            <form className="stack" onSubmit={submitTrade}>
              <div className="row">
                <input
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  placeholder="Symbol (e.g. INFY)"
                />
                <select value={side} onChange={(e) => setSide(e.target.value as "BUY" | "SELL")}>
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
              </div>
              <div className="row">
                <input
                  type="number"
                  min="1"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  placeholder="Quantity"
                />
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="Price"
                />
              </div>
              <div className="muted" style={{ fontSize: 11 }}>
                Order Value: ₹{(Number(qty || 0) * Number(price || 0)).toLocaleString("en-IN")} · Est. Statutory Tax (STT/GST): ₹{((Number(qty || 0) * Number(price || 0)) * 0.0012).toFixed(2)}
              </div>
              <button
                className={executionMode === "LIVE_BROKER" ? "danger" : "primary"}
                type="submit"
                disabled={riskSettings?.killSwitchActive}
              >
                {riskSettings?.killSwitchActive
                  ? "Blocked by Kill Switch"
                  : `${executionMode === "LIVE_BROKER" ? "🚀 Live Zerodha" : "Place"} ${side} Order`}
              </button>
            </form>
            {tradeMessage && <p className="muted" style={{ marginTop: 10 }}>{tradeMessage}</p>}

            <hr style={{ borderColor: "var(--line)", margin: "16px 0" }} />

            {/* Set Price Alert */}
            <h2>Set Price Alert</h2>
            <form className="stack" onSubmit={createPriceAlert}>
              <div className="row">
                <input
                  value={alertSymbol}
                  onChange={(e) => setAlertSymbol(e.target.value.toUpperCase())}
                  placeholder="Symbol"
                />
                <select value={alertCondition} onChange={(e) => setAlertCondition(e.target.value as "GT" | "LT")}>
                  <option value="GT">&gt; Above</option>
                  <option value="LT">&lt; Below</option>
                </select>
                <input
                  type="number"
                  step="0.1"
                  value={alertValue}
                  onChange={(e) => setAlertValue(e.target.value)}
                  placeholder="Target"
                />
              </div>
              <button className="secondary" type="submit">Add Alert</button>
            </form>
            {alertMessage && <p className="muted" style={{ marginTop: 8 }}>{alertMessage}</p>}

            {alerts.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <span className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>Active Alerts ({alerts.length})</span>
                <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
                  {alerts.map((a) => (
                    <div className="row" key={a.id} style={{ justifyContent: "space-between", background: "#0c1222", padding: "6px 10px", borderRadius: 6 }}>
                      <span style={{ fontSize: 12 }}>{a.symbol} {a.condition} ₹{a.value}</span>
                      <button className="danger" onClick={() => deleteAlert(a.id)}>✕</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Interactive Candlestick / OHLC Chart Strip */}
          <section className="panel full">
            <h2>
              {selectedChartSymbol} · 5m Candlestick Price Action
              <span className="badge badge-blue">{candles.length} Candles</span>
            </h2>
            <div style={{ display: "flex", alignItems: "end", gap: 4, height: 160, padding: "12px 0", background: "#0a0f1d", borderRadius: 8, paddingLeft: 12, paddingRight: 12 }}>
              {candles.map((c, idx) => {
                const isGreen = c.close >= c.open;
                const minPrice = Math.min(...candles.map((x) => x.low));
                const maxPrice = Math.max(...candles.map((x) => x.high));
                const range = maxPrice - minPrice || 1;
                const heightPct = Math.max(8, ((Math.abs(c.close - c.open)) / range) * 120);
                return (
                  <div key={idx} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end" }} title={`Time: ${new Date(c.time * 1000).toLocaleTimeString()} | O: ₹${c.open} H: ₹${c.high} L: ₹${c.low} C: ₹${c.close}`}>
                    <div style={{ width: 1, height: "100%", background: isGreen ? "var(--green)" : "var(--red)", opacity: 0.3 }} />
                    <div style={{ width: "100%", height: `${heightPct}%`, background: isGreen ? "var(--green)" : "var(--red)", borderRadius: 2 }} />
                  </div>
                );
              })}
            </div>
            <span className="muted">Hover candles to view OHLCV. Select another ticker in watchlist to re-chart.</span>
          </section>
        </div>
      )}

      {/* TAB 2: INTELLIGENCE & EXPOSURE RADAR */}
      {activeTab === "INTELLIGENCE" && (
        <div className="grid">
          <section className="panel wide">
            <h2>
              Market Intelligence &amp; Event Stream
              <span className="badge badge-purple">AI / RSS Ingested</span>
            </h2>
            <div style={{ display: "grid", gap: 12 }}>
              {events.map((ev) => (
                <div className="event-card" key={ev.id}>
                  <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                    <div className="row">
                      <span className="badge badge-blue">{ev.eventType}</span>
                      <span className={`badge ${ev.sentimentScore > 0 ? "badge-positive" : ev.sentimentScore < 0 ? "badge-negative" : "badge-neutral"}`}>
                        {ev.sentimentScore > 0 ? "Bullish" : ev.sentimentScore < 0 ? "Bearish" : "Neutral"} ({ev.sentimentScore > 0 ? "+" : ""}{ev.sentimentScore})
                      </span>
                    </div>
                    <span className="muted" style={{ fontSize: 11 }}>{ev.source.replace("_", " ")}</span>
                  </div>
                  <h3 className="event-title">{ev.title}</h3>
                  <p className="event-summary">{ev.summary}</p>
                  <div className="row" style={{ flexWrap: "wrap" }}>
                    {ev.primarySymbols.map((s) => (
                      <span className="ripple-chip" key={s}>🎯 <strong>{s}</strong> Direct</span>
                    ))}
                    {ev.rippleImpacts?.map((r) => (
                      <span className="ripple-chip" key={`${ev.id}-${r.symbol}`}>
                        ⚡ <strong>{r.symbol}</strong> ({r.impactDirection === "POSITIVE" ? "▲" : "▼"} {r.sector})
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel side">
            <h2>Transmission Channels</h2>
            <div style={{ display: "grid", gap: 10, fontSize: 12 }}>
              <div style={{ background: "#0c1222", padding: "10px", borderRadius: 8, border: "1px solid var(--line)" }}>
                <strong>🛢️ Crude Oil Surge:</strong>
                <p className="muted" style={{ margin: "4px 0 0" }}>+RELIANCE (Upstream), -ASIANPAINT (Raw materials), -INDIGO (Aviation fuel)</p>
              </div>
              <div style={{ background: "#0c1222", padding: "10px", borderRadius: 8, border: "1px solid var(--line)" }}>
                <strong>💻 US Enterprise IT Budgets:</strong>
                <p className="muted" style={{ margin: "4px 0 0" }}>+TCS, +INFY deal pipeline acceleration and cloud enterprise renewals.</p>
              </div>
              <div style={{ background: "#0c1222", padding: "10px", borderRadius: 8, border: "1px solid var(--line)" }}>
                <strong>🏦 RBI Rate Adjustments:</strong>
                <p className="muted" style={{ margin: "4px 0 0" }}>+HDFCBANK, +SBIN credit expansion &amp; bond treasury gains on yield decline.</p>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* TAB 3: MULTI-FACTOR SIGNALS */}
      {activeTab === "SIGNALS" && (
        <div className="grid">
          <section className="panel wide">
            <h2>
              Multi-Factor Proposed Signals
              <button className="secondary" onClick={() => generateSignalForSymbol(selectedChartSymbol)}>⚡ Generate Signal for {selectedChartSymbol}</button>
            </h2>
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Direction</th>
                  <th>Composite</th>
                  <th>Tech (40%)</th>
                  <th>Sent (35%)</th>
                  <th>Macro (25%)</th>
                  <th>Horizon</th>
                  <th>Rationale</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.symbol}</strong></td>
                    <td>
                      <span className={`badge ${s.direction === "BULLISH" ? "badge-positive" : s.direction === "BEARISH" ? "badge-negative" : "badge-neutral"}`}>
                        {s.direction}
                      </span>
                    </td>
                    <td><strong>{s.compositeScore > 0 ? "+" : ""}{s.compositeScore}</strong></td>
                    <td>{s.technicalScore !== null ? (s.technicalScore > 0 ? `+${s.technicalScore}` : s.technicalScore) : "—"}</td>
                    <td>{s.sentimentScore !== null ? (s.sentimentScore > 0 ? `+${s.sentimentScore}` : s.sentimentScore) : "—"}</td>
                    <td>{s.macroScore !== null ? (s.macroScore > 0 ? `+${s.macroScore}` : s.macroScore) : "—"}</td>
                    <td><span className="badge badge-blue">{s.horizon}</span></td>
                    <td className="muted" style={{ maxWidth: 280, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={s.rationale}>
                      {s.rationale}
                    </td>
                  </tr>
                ))}
                {signals.length === 0 && (
                  <tr>
                    <td colSpan={8} className="muted" style={{ textAlign: "center", padding: 24 }}>No signals generated yet. Click &quot;Generate Signal&quot; above.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="panel side">
            <h2>Scoring Methodology</h2>
            <p className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
              Composite score = <strong>0.40 × Technical</strong> (RSI + SMA crossovers) + <strong>0.35 × News Sentiment</strong> + <strong>0.25 × Macro Transmission</strong>.
            </p>
          </section>
        </div>
      )}

      {/* TAB 4: QUANTITATIVE ANALYTICS & JOURNAL */}
      {activeTab === "ANALYTICS" && (
        <div className="grid">
          <section className="panel full">
            <h2>Quantitative Portfolio Performance &amp; Attribution</h2>
            <div className="grid" style={{ gridTemplateColumns: "repeat(6, 1fr)", gap: 12 }}>
              <div className="panel" style={{ background: "#0c1222" }}>
                <span className="muted">Total Trades</span>
                <div className="metric">{analytics?.totalTrades ?? 0}</div>
              </div>
              <div className="panel" style={{ background: "#0c1222" }}>
                <span className="muted">Win Rate</span>
                <div className="metric positive">{analytics?.winRatePct ?? 0}%</div>
              </div>
              <div className="panel" style={{ background: "#0c1222" }}>
                <span className="muted">Profit Factor</span>
                <div className="metric">{analytics?.profitFactor ?? 0}</div>
              </div>
              <div className="panel" style={{ background: "#0c1222" }}>
                <span className="muted">Sharpe Ratio</span>
                <div className="metric">{analytics?.sharpeRatio ?? 0}</div>
              </div>
              <div className="panel" style={{ background: "#0c1222" }}>
                <span className="muted">Max Drawdown</span>
                <div className="metric negative">{analytics?.maxDrawdownPct ?? 0}%</div>
              </div>
              <div className="panel" style={{ background: "#0c1222" }}>
                <span className="muted">Net Realized P&amp;L</span>
                <div className={`metric ${(analytics?.netRealizedPnl ?? 0) >= 0 ? "positive" : "negative"}`}>
                  ₹{(analytics?.netRealizedPnl ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>

            <h3 style={{ marginTop: 24, fontSize: 15 }}>Sector Attribution</h3>
            <table>
              <thead>
                <tr>
                  <th>Sector</th>
                  <th>Trade Count</th>
                  <th>Realized P&amp;L</th>
                </tr>
              </thead>
              <tbody>
                {analytics?.sectorBreakdown.map((sec) => (
                  <tr key={sec.sector}>
                    <td><strong>{sec.sector}</strong></td>
                    <td>{sec.tradeCount}</td>
                    <td className={sec.pnl >= 0 ? "positive" : "negative"}>₹{sec.pnl.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}

      {/* TAB 5: RISK CONTROLS */}
      {activeTab === "RISK" && (
        <div className="grid">
          <section className="panel half">
            <h2>Pre-Trade Capital Limits</h2>
            <div className="stack" style={{ gap: 14 }}>
              <div>
                <span className="muted">Max Daily Loss Threshold (Auto-Kill Switch Trigger)</span>
                <div className="metric negative">₹{Number(riskSettings?.maxDailyLoss ?? 50000).toLocaleString("en-IN")}</div>
              </div>
              <div>
                <span className="muted">Max Single Position / Trade Value</span>
                <div className="metric">₹{Number(riskSettings?.maxPositionSize ?? 200000).toLocaleString("en-IN")}</div>
              </div>
              <div>
                <span className="muted">Max Single Sector Concentration</span>
                <div className="metric">{riskSettings?.maxSectorExposurePct ?? 35}%</div>
              </div>
            </div>
          </section>

          <section className="panel half">
            <h2>Emergency Controls</h2>
            <div style={{ background: "#0c1222", padding: 16, borderRadius: 8, border: "1px solid var(--line)" }}>
              <h3>Trading Kill Switch Status</h3>
              <p className="muted">
                When active, all order placement is blocked instantly at the risk engine layer.
              </p>
              <button
                className={riskSettings?.killSwitchActive ? "primary" : "danger"}
                style={{ marginTop: 12, padding: "12px 20px" }}
                onClick={() => toggleKillSwitch(!riskSettings?.killSwitchActive)}
              >
                {riskSettings?.killSwitchActive ? "🛡️ Kill Switch is ACTIVE (Click to Unlock)" : "🛑 Activate Emergency Kill Switch"}
              </button>
            </div>
          </section>
        </div>
      )}

      {/* TAB 6: ZERODHA BROKER & MARGINS */}
      {activeTab === "BROKER" && (
        <div className="grid">
          <section className="panel wide">
            <h2>
              Zerodha Kite Connection &amp; Live Margins
              <button className="primary" onClick={connectZerodha}>🔗 Connect Zerodha (OAuth)</button>
            </h2>

            {brokerMargins?.equity && (
              <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 18 }}>
                <div className="panel" style={{ background: "#0c1222" }}>
                  <span className="muted">Available Cash</span>
                  <div className="metric">₹{brokerMargins.equity.available.cash.toLocaleString("en-IN")}</div>
                </div>
                <div className="panel" style={{ background: "#0c1222" }}>
                  <span className="muted">Collateral Margin</span>
                  <div className="metric">₹{brokerMargins.equity.available.collateral.toLocaleString("en-IN")}</div>
                </div>
                <div className="panel" style={{ background: "#0c1222" }}>
                  <span className="muted">Utilized SPAN &amp; Exposure</span>
                  <div className="metric">₹{brokerMargins.equity.utilised.exposure.toLocaleString("en-IN")}</div>
                </div>
              </div>
            )}

            <h3>Live Orders</h3>
            <table>
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th>Type</th>
                  <th>Qty</th>
                  <th>Price</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {brokerOrders.map((o) => (
                  <tr key={o.order_id}>
                    <td><code>{o.order_id}</code></td>
                    <td><strong>{o.tradingsymbol}</strong></td>
                    <td className={o.transaction_type === "BUY" ? "positive" : "negative"}>{o.transaction_type}</td>
                    <td>{o.order_type}</td>
                    <td>{o.quantity}</td>
                    <td>₹{o.price}</td>
                    <td><span className="badge badge-blue">{o.status}</span></td>
                  </tr>
                ))}
                {brokerOrders.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted" style={{ textAlign: "center", padding: 24 }}>No active broker orders placed today.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <section className="panel side">
            <h2>Broker Settings</h2>
            <p className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
              Zerodha Kite session tokens expire at 06:00 AM IST daily per SEBI mandate. Re-authenticate each morning before market open.
            </p>
          </section>
        </div>
      )}
    </main>
  );
}
