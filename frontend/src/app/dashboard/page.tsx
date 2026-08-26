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

type AlertItem = {
  id: string;
  symbol: string;
  condition: "GT" | "GTE" | "LT" | "LTE";
  value: number;
  createdAt: string;
};

type TriggeredToast = {
  id: string;
  symbol: string;
  message: string;
};

type Tick = { symbol?: string; last_price: number };

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? API_URL;

export default function DashboardPage() {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [events, setEvents] = useState<MarketEvent[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [toasts, setToasts] = useState<TriggeredToast[]>([]);

  // Paper trade state
  const [symbol, setSymbol] = useState("INFY");
  const [qty, setQty] = useState("5");
  const [price, setPrice] = useState("1520");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [tradeMessage, setTradeMessage] = useState("");

  // Alert form state
  const [alertSymbol, setAlertSymbol] = useState("INFY");
  const [alertCondition, setAlertCondition] = useState<"GT" | "LT">("GT");
  const [alertValue, setAlertValue] = useState("1550");
  const [alertMessage, setAlertMessage] = useState("");

  const watchlist = useMemo(() => ["INFY", "RELIANCE", "TCS", "ASIANPAINT", "INDIGO"], []);

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
    socket.on("alert:triggered", onAlertTriggered);

    return () => {
      socket.off("tick", onTicks);
      socket.off("kite:tick", onTicks);
      socket.off("portfolio:update");
      socket.off("market:event");
      socket.off("alert:triggered");
      socket.disconnect();
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    void loadPortfolio(token);
    void loadIntelligence(token);
    void loadAlerts(token);
  }, [token]);

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
    const res = await fetch(`${API_URL}/portfolio`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      setPortfolio(data.portfolio);
    }
  }

  async function loadIntelligence(accessToken: string) {
    const res = await fetch(`${API_URL}/intelligence/events`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      setEvents(data.events ?? []);
    }
  }

  async function loadAlerts(accessToken: string) {
    const res = await fetch(`${API_URL}/alerts`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      setAlerts(data.alerts ?? []);
    }
  }

  async function submitPaperTrade(e: FormEvent) {
    e.preventDefault();
    setTradeMessage("");
    const res = await fetch(`${API_URL}/trades/add`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ symbol, qty: Number(qty), price: Number(price), side }),
    });
    const body = await res.json();
    if (res.ok) {
      setTradeMessage(`✅ ${side} paper trade executed: ${qty} ${symbol} @ ₹${price}`);
      if (token) void loadPortfolio(token);
    } else {
      setTradeMessage(`❌ ${body.error ?? "Trade rejected"}`);
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
    const res = await fetch(`${API_URL}/alerts/${alertId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok && token) {
      void loadAlerts(token);
    }
  }

  async function triggerNewsSync() {
    if (!token) return;
    await fetch(`${API_URL}/intelligence/sync-news`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    void loadIntelligence(token);
  }

  if (!token) {
    return (
      <main className="shell">
        <section className="panel" style={{ maxWidth: 420, margin: "15vh auto" }}>
          <h1>Ultimate Trader</h1>
          <p className="muted">Market Intelligence &amp; Paper Trading Cockpit</p>
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
      {/* Real-time Alert Toast Container */}
      <div className="toast-container">
        {toasts.map((toast) => (
          <div className="toast" key={toast.id}>
            <strong>🔔 Price Alert Triggered</strong>
            <p style={{ margin: "4px 0 0", color: "#eef3ff" }}>{toast.message}</p>
          </div>
        ))}
      </div>

      <header className="header">
        <div>
          <h1>Market Intelligence Cockpit</h1>
          <span className="muted">Live Tick Streamer · Decision Support &amp; Exposure Radar</span>
        </div>
        <div className="row">
          <button className="secondary" onClick={triggerNewsSync}>🔄 Sync News</button>
          <button className="secondary" onClick={() => { localStorage.removeItem("accessToken"); setToken(null); }}>Log out</button>
        </div>
      </header>

      {/* Top Live Watchlist Bar */}
      <section className="ticker">
        {watchlist.map((item) => {
          const currentPrice = prices[item] ?? portfolio?.holdings.find((h) => h.symbol === item)?.lastPrice ?? 0;
          return (
            <div className="panel ticker-card" key={item}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="muted">NSE · {item}</span>
                <span className="badge badge-blue">LTP</span>
              </div>
              <div className="metric">₹{currentPrice > 0 ? currentPrice.toFixed(2) : "—"}</div>
            </div>
          );
        })}
      </section>

      <div className="grid">
        {/* Holdings & Real-time PnL */}
        <section className="panel wide">
          <h2>
            Holdings &amp; Real-Time Valuation
            <span className="muted" style={{ fontSize: 12 }}>Paper Account</span>
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
                  <td colSpan={7} className="muted" style={{ textAlign: "center", padding: 24 }}>No open holdings. Place a paper trade below.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {/* Paper Trade Placement Drawer */}
        <section className="panel side">
          <h2>Paper Order Execution</h2>
          <form className="stack" onSubmit={submitPaperTrade}>
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
            <button className="primary" type="submit">
              Place {side} Order (₹{(Number(qty || 0) * Number(price || 0)).toLocaleString("en-IN")})
            </button>
          </form>
          {tradeMessage && <p className="muted" style={{ marginTop: 10 }}>{tradeMessage}</p>}

          <hr style={{ borderColor: "var(--line)", margin: "18px 0" }} />

          {/* Quick Price Alert Trigger Setup */}
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

        {/* Market Intelligence & Macro Ripple Radar */}
        <section className="panel half">
          <h2>
            Market Intelligence &amp; Event Feed
            <span className="badge badge-purple">AI Enriched</span>
          </h2>
          <div style={{ maxHeight: 420, overflowY: "auto", paddingRight: 4 }}>
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

                {/* Primary & Ripple Ticker Tags */}
                <div className="row" style={{ flexWrap: "wrap" }}>
                  {ev.primarySymbols.map((s) => (
                    <span className="ripple-chip" key={s}>
                      🎯 <strong>{s}</strong> Direct
                    </span>
                  ))}
                  {ev.rippleImpacts?.map((r) => (
                    <span className="ripple-chip" key={`${ev.id}-${r.symbol}`}>
                      ⚡ <strong>{r.symbol}</strong> ({r.impactDirection === "POSITIVE" ? "▲" : "▼"} {r.sector})
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {events.length === 0 && (
              <p className="muted" style={{ textAlign: "center", padding: 32 }}>No events ingested yet. Click &quot;Sync News&quot; above.</p>
            )}
          </div>
        </section>

        {/* Live Tick Stream & Transmission Channel Overview */}
        <section className="panel half">
          <h2>
            Live Price Action &amp; Exposure Transmission
            <span className="badge badge-blue">Tick Stream</span>
          </h2>
          <div className="chart">
            {Object.values(prices).slice(-32).map((val, idx) => (
              <div
                className="bar"
                style={{ height: `${Math.max(12, Math.min(100, (val % 100) * 1.5))}%` }}
                key={`${val}-${idx}`}
              />
            ))}
          </div>

          <div style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: 13, margin: "0 0 8px", color: "var(--muted)", textTransform: "uppercase" }}>
              Transmission Channels &amp; Exposure Rules
            </h3>
            <div style={{ display: "grid", gap: 8, fontSize: 12 }}>
              <div style={{ background: "#0c1222", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)" }}>
                <strong>🛢️ Crude Oil Benchmark:</strong> Surge $\rightarrow$ <span className="positive">RELIANCE (+)</span> Upstream, <span className="negative">ASIANPAINT (-)</span> Raw materials, <span className="negative">INDIGO (-)</span> Aviation Fuel.
              </div>
              <div style={{ background: "#0c1222", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)" }}>
                <strong>💻 US Enterprise IT Spend:</strong> Growth $\rightarrow$ <span className="positive">TCS (+)</span>, <span className="positive">INFY (+)</span> deal momentum &amp; margin expansion.
              </div>
              <div style={{ background: "#0c1222", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line)" }}>
                <strong>🏦 RBI Monetary Policy:</strong> Rate cuts $\rightarrow$ <span className="positive">HDFCBANK (+)</span>, <span className="positive">SBIN (+)</span> credit expansion &amp; lower cost of funds.
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
