"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { io, Socket } from "socket.io-client";

type Holding = { symbol: string; quantity: number; averagePrice: number; lastPrice: number; investedValue: number; currentValue: number; unrealizedPnl: number };
type Portfolio = { cashBalance: number; totalCurrentValue: number; totalUnrealizedPnl: number; holdings: Holding[] };
type Tick = { symbol?: string; last_price: number };
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? API_URL;

export default function DashboardPage() {
  const [token, setToken] = useState<string | null>(null); const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null); const [prices, setPrices] = useState<Record<string, number>>({});
  const [symbol, setSymbol] = useState("INFY"); const [qty, setQty] = useState("1"); const [price, setPrice] = useState("1500"); const [side, setSide] = useState<"BUY" | "SELL">("BUY"); const [message, setMessage] = useState("");

  useEffect(() => setToken(localStorage.getItem("accessToken")), []);
  useEffect(() => {
    if (!token) return;
    const socket: Socket = io(SOCKET_URL, { auth: { token }, withCredentials: true });
    const onTicks = (ticks: Tick[]) => setPrices((previous) => { const next = { ...previous }; ticks.forEach((tick) => { if (tick.symbol) next[tick.symbol] = tick.last_price; }); return next; });
    socket.on("tick", onTicks); socket.on("kite:tick", onTicks); socket.on("portfolio:update", setPortfolio);
    socket.on("connect_error", () => setMessage("Live prices are unavailable; check that the backend is running."));
    return () => { socket.off("tick", onTicks); socket.off("kite:tick", onTicks); socket.off("portfolio:update", setPortfolio); socket.disconnect(); };
  }, [token]);
  useEffect(() => { if (token) void loadPortfolio(token); }, [token]);
  const watchlist = useMemo(() => ["INFY", "RELIANCE", "TCS"], []);

  async function authenticate(path: "login" | "register") {
    try {
      const response = await fetch(`${API_URL}/auth/${path}`, { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify({ email, password }) });
      const body = await response.json(); if (!response.ok) return setMessage(body.error ?? "Authentication failed");
      if (!body.accessToken) return setMessage("Registration succeeded. Log in to continue.");
      localStorage.setItem("accessToken", body.accessToken); setToken(body.accessToken);
    } catch {
      setMessage(`Cannot connect to the backend at ${API_URL}. Start the backend and try again.`);
    }
  }
  async function loadPortfolio(accessToken: string) {
    try {
      const response = await fetch(`${API_URL}/portfolio`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (response.ok) setPortfolio((await response.json()).portfolio);
      else if (response.status === 401) { localStorage.removeItem("accessToken"); setToken(null); }
    } catch { setMessage(`Cannot connect to the backend at ${API_URL}.`); }
  }
  async function submitPaperTrade(event: FormEvent) {
    event.preventDefault();
    try {
      const response = await fetch(`${API_URL}/trades/add`, { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ symbol, qty, price, side }) }); const body = await response.json();
      setMessage(response.ok ? `${side} paper trade recorded` : body.error ?? "Trade rejected"); if (response.ok && token) await loadPortfolio(token);
    } catch { setMessage(`Cannot connect to the backend at ${API_URL}.`); }
  }

  if (!token) return <main className="shell"><section className="panel" style={{ maxWidth: 420, margin: "15vh auto" }}><h1>Ultimate Trader</h1><p className="muted">Paper-trading dashboard</p><form className="stack" suppressHydrationWarning onSubmit={(event) => { event.preventDefault(); void authenticate("login"); }}><input suppressHydrationWarning autoComplete="email" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} /><input suppressHydrationWarning autoComplete="current-password" placeholder="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /><div className="row"><button className="primary" type="submit">Log in</button><button className="secondary" type="button" onClick={() => void authenticate("register")}>Register</button></div></form><p className="muted">{message}</p></section></main>;

  return <main className="shell"><header className="header"><div><h1>Market cockpit</h1><span className="muted">Paper trading mode</span></div><button className="secondary" onClick={() => { localStorage.removeItem("accessToken"); setToken(null); }}>Log out</button></header>
    <section className="ticker">{watchlist.map((item) => <div className="panel ticker-card" key={item}><span className="muted">NSE · {item}</span><div className="metric">₹{(prices[item] ?? portfolio?.holdings.find((holding) => holding.symbol === item)?.lastPrice ?? 0).toFixed(2)}</div></div>)}</section>
    <div className="grid"><section className="panel wide"><h2>Holdings &amp; P&amp;L</h2><div className="row"><div><span className="muted">Cash</span><div className="metric">₹{(portfolio?.cashBalance ?? 0).toFixed(2)}</div></div><div><span className="muted">Unrealized P&amp;L</span><div className={`metric ${(portfolio?.totalUnrealizedPnl ?? 0) >= 0 ? "positive" : "negative"}`}>₹{(portfolio?.totalUnrealizedPnl ?? 0).toFixed(2)}</div></div></div><table><thead><tr><th>Symbol</th><th>Qty</th><th>Avg</th><th>LTP</th><th>P&amp;L</th></tr></thead><tbody>{portfolio?.holdings.map((holding) => <tr key={holding.symbol}><td>{holding.symbol}</td><td>{holding.quantity}</td><td>₹{holding.averagePrice.toFixed(2)}</td><td>₹{holding.lastPrice.toFixed(2)}</td><td className={holding.unrealizedPnl >= 0 ? "positive" : "negative"}>₹{holding.unrealizedPnl.toFixed(2)}</td></tr>)}</tbody></table></section>
      <section className="panel side"><h2>Paper order</h2><form className="stack" onSubmit={submitPaperTrade}><div className="row"><input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} placeholder="Symbol" /><select value={side} onChange={(event) => setSide(event.target.value as "BUY" | "SELL")}><option>BUY</option><option>SELL</option></select></div><input type="number" min="1" value={qty} onChange={(event) => setQty(event.target.value)} placeholder="Quantity" /><input type="number" min="0.01" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="Limit price" /><button className="primary" type="submit">Place paper order</button></form><p className="muted">{message}</p></section>
      <section className="panel full"><h2>Live price strip</h2><div className="chart">{Object.values(prices).slice(-24).map((value, index) => <div className="bar" style={{ height: `${Math.max(12, Math.min(100, value % 100))}%` }} key={`${value}-${index}`} />)}</div><p className="muted">Live ticks are connected through Socket.IO. Candlestick history will follow after the paper flow is stable.</p></section></div></main>;
}
