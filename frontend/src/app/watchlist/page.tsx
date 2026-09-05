"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import {
  WatchlistSummaryResponse,
  WatchlistChangeItem,
  MarketFreshnessState,
  ReplayCheckpointOption,
} from "../../types/watchlistContract";
import InteractivePriceChart from "../../components/InteractivePriceChart";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || API_URL;

export default function SmartMarketWatchPage() {
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [data, setData] = useState<WatchlistSummaryResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStockSymbol, setSelectedStockSymbol] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [events, setEvents] = useState<any[]>([]);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [selectedCategory, setSelectedCategory] = useState<"ALL" | "CATEGORY_A" | "CATEGORY_B" | "CATEGORY_C">("ALL");

  // Feature 2: Historical Checkpoint Replay State
  const [selectedBaselineId, setSelectedBaselineId] = useState<string>("active_checkpoint");
  const [isBaselineDropdownOpen, setIsBaselineDropdownOpen] = useState(false);

  // Feature 3: Live Kite / WebSocket Ticker State
  const [socketConnected, setSocketConnected] = useState(false);
  const [brokerStatus, setBrokerStatus] = useState<{ connected: boolean; broker?: string } | null>(null);
  const [liveTicksBySymbol, setLiveTicksBySymbol] = useState<Record<string, Array<{ time: number; price: number }>>>({});
  const [tickFlashes, setTickFlashes] = useState<Record<string, "up" | "down">>({});

  // Feature 4: Audio & Desktop Alert State
  const [soundAlertsEnabled, setSoundAlertsEnabled] = useState(true);
  const [desktopAlertsEnabled, setDesktopAlertsEnabled] = useState(false);
  const [alertToasts, setAlertToasts] = useState<Array<{ id: string; symbol: string; title: string; message: string; timestamp: number }>>([]);
  const prevCategoriesRef = useRef<Record<string, string>>({});

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Helper to fetch authorization header if user is logged in
  const getAuthHeaders = (): HeadersInit => {
    if (typeof window === "undefined") return {};
    const token = localStorage.getItem("accessToken");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  // Play subtle dual chord Web Audio chime (D5: 587.33 Hz, A5: 880.00 Hz)
  const playCategoryAChime = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      const gain2 = ctx.createGain();

      osc1.type = "sine";
      osc1.frequency.setValueAtTime(587.33, now); // D5
      gain1.gain.setValueAtTime(0.001, now);
      gain1.gain.exponentialRampToValueAtTime(0.08, now + 0.04);
      gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);

      osc2.type = "sine";
      osc2.frequency.setValueAtTime(880.00, now + 0.05); // A5
      gain2.gain.setValueAtTime(0.001, now);
      gain2.gain.exponentialRampToValueAtTime(0.06, now + 0.08);
      gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);

      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);

      osc1.start(now);
      osc1.stop(now + 0.36);
      osc2.start(now + 0.05);
      osc2.stop(now + 0.39);
    } catch (err) {
      console.warn("Audio chime playback prevented or unsupported:", err);
    }
  }, []);

  // Send native desktop notification
  const sendDesktopAlert = useCallback((title: string, body: string) => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "granted") {
      try {
        new Notification(title, {
          body,
          icon: "/favicon.ico",
          tag: "watchlist-category-a",
        });
      } catch (err) {
        console.warn("Desktop notification failed:", err);
      }
    }
  }, []);

  const toggleDesktopNotifications = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      alert("Desktop notifications are not supported in this browser.");
      return;
    }
    if (Notification.permission === "granted") {
      setDesktopAlertsEnabled((prev) => !prev);
    } else if (Notification.permission !== "denied") {
      const perm = await Notification.requestPermission();
      if (perm === "granted") {
        setDesktopAlertsEnabled(true);
        sendDesktopAlert("Watchlist Alerts Active", "You will be alerted when a stock escalates to Category A: Needs Attention.");
      }
    } else {
      alert("Notification permissions were previously denied. Please enable them in your browser settings.");
    }
  };

  const triggerCategoryAAlert = useCallback((stock: WatchlistChangeItem, reason: string) => {
    if (soundAlertsEnabled) {
      playCategoryAChime();
    }
    if (desktopAlertsEnabled) {
      sendDesktopAlert(
        `⚠️ Watchlist Alert: ${stock.symbol}`,
        `${stock.symbol} escalated to Category A (${stock.priceChangePct >= 0 ? "+" : ""}${stock.priceChangePct.toFixed(2)}%). ${reason}`
      );
    }
    const toastId = `${stock.symbol}-${Date.now()}`;
    setAlertToasts((prev) => [
      {
        id: toastId,
        symbol: stock.symbol,
        title: `${stock.symbol} Escalated to Category A`,
        message: `${stock.priceChangePct >= 0 ? "+" : ""}${stock.priceChangePct.toFixed(2)}% vs baseline · ${reason}`,
        timestamp: Date.now(),
      },
      ...prev.slice(0, 4),
    ]);
    setTimeout(() => {
      setAlertToasts((prev) => prev.filter((t) => t.id !== toastId));
    }, 7000);
  }, [soundAlertsEnabled, desktopAlertsEnabled, playCategoryAChime, sendDesktopAlert]);

  // Load live watchlist summary from backend with optional baseline override
  const fetchRealSummary = useCallback(async (baselineOverride?: string) => {
    setLoading(true);
    setError(null);
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("accessToken") : null;
      if (!token) {
        setIsAuthenticated(false);
        router.replace("/dashboard");
        return;
      }
      const baseline = baselineOverride !== undefined ? baselineOverride : selectedBaselineId;
      const summaryUrl = baseline && baseline !== "active_checkpoint"
        ? `${API_URL}/watchlist/summary?baseline=${encodeURIComponent(baseline)}`
        : `${API_URL}/watchlist/summary`;

      const [res, intelRes] = await Promise.all([
        fetch(summaryUrl, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_URL}/intelligence/events`, {
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => null),
      ]);
      if (res.status === 401) {
        localStorage.removeItem("accessToken");
        setIsAuthenticated(false);
        router.replace("/dashboard");
        return;
      }
      if (!res.ok) {
        throw new Error(`Failed to load watchlist summary (${res.status})`);
      }
      const json: WatchlistSummaryResponse = await res.json();
      setData(json);
      if (json.activeBaseline?.id) {
        setSelectedBaselineId(json.activeBaseline.id);
      }
      if (intelRes && intelRes.ok) {
        try {
          const intelJson = await intelRes.json();
          if (Array.isArray(intelJson.events)) {
            setEvents(intelJson.events);
          }
        } catch {
          // ignore parsing error
        }
      }
      setIsAuthenticated(true);
    } catch (err: any) {
      setError(err.message || "Failed to connect to backend market service");
    } finally {
      setLoading(false);
    }
  }, [router, selectedBaselineId]);

  // Check Kite broker connection status
  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("accessToken") : null;
    if (!token) return;
    fetch(`${API_URL}/broker/kite/status`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (res) setBrokerStatus(res);
      })
      .catch(() => {});
  }, []);

  // Live Kite / Socket.io Ticker Connection
  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("accessToken") : null;
    if (!token) return;

    const socket: Socket = io(SOCKET_URL, {
      auth: { token },
      transports: ["websocket", "polling"],
    });

    socket.on("connect", () => {
      setSocketConnected(true);
    });

    socket.on("disconnect", () => {
      setSocketConnected(false);
    });

    const handleTicks = (ticks: any[]) => {
      if (!Array.isArray(ticks) || ticks.length === 0) return;
      const now = Date.now();

      ticks.forEach((tick) => {
        const sym = tick.symbol;
        const price = Number(tick.last_price);
        if (!sym || !price || isNaN(price)) return;

        // Maintain continuous streaming tick buffer (last 120 ticks)
        setLiveTicksBySymbol((prev) => {
          const existing = prev[sym] || [];
          const updated = [...existing, { time: now, price }].slice(-120);
          return { ...prev, [sym]: updated };
        });

        // Trigger visual flash and live price update
        setData((prevData) => {
          if (!prevData) return prevData;

          let hasUpdated = false;
          const updateItem = (item: WatchlistChangeItem): WatchlistChangeItem => {
            if (item.symbol !== sym) return item;
            hasUpdated = true;
            const prevPrice = item.currentPrice;
            const flash = price >= prevPrice ? "up" : "down";
            setTickFlashes((f) => ({ ...f, [sym]: flash }));
            setTimeout(() => {
              setTickFlashes((f) => {
                const copy = { ...f };
                delete copy[sym];
                return copy;
              });
            }, 700);

            const priceChangePct = item.checkpointPrice > 0 ? ((price - item.checkpointPrice) / item.checkpointPrice) * 100 : 0;
            return {
              ...item,
              currentPrice: price,
              priceChangePct,
              benchmarkAlphaPct: item.benchmarkAlphaPct !== null ? item.benchmarkAlphaPct + (priceChangePct - item.priceChangePct) : null,
            };
          };

          return {
            ...prevData,
            groups: {
              needsAttention: prevData.groups.needsAttention.map(updateItem),
              worthALook: prevData.groups.worthALook.map(updateItem),
              unchanged: prevData.groups.unchanged.map(updateItem),
            },
          };
        });
      });
    };

    socket.on("tick", handleTicks);
    socket.on("kite:tick", handleTicks);

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("tick", handleTicks);
      socket.off("kite:tick", handleTicks);
      socket.disconnect();
    };
  }, []);

  // Category A escalation detector
  useEffect(() => {
    if (!data) return;
    const currentMap: Record<string, string> = {};
    data.groups.needsAttention.forEach((s) => (currentMap[s.symbol] = "CATEGORY_A"));
    data.groups.worthALook.forEach((s) => (currentMap[s.symbol] = "CATEGORY_B"));
    data.groups.unchanged.forEach((s) => (currentMap[s.symbol] = "CATEGORY_C"));

    data.groups.needsAttention.forEach((stock) => {
      const prevCat = prevCategoriesRef.current[stock.symbol];
      if (prevCat && prevCat !== "CATEGORY_A") {
        const reason = stock.reasons[0]?.value || stock.summaryExplanation || "Material price or volume velocity";
        triggerCategoryAAlert(stock, reason);
      }
    });

    prevCategoriesRef.current = currentMap;
  }, [data, triggerCategoryAAlert]);

  // CHECKPOINT: Acknowledge current spot prices and reset baseline
  const handleMarkAllAsChecked = useCallback(async () => {
    setActionPending(true);
    try {
      const res = await fetch(`${API_URL}/watchlist/checkpoint`, {
        method: "POST",
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) {
        if (res.status === 401) {
          localStorage.removeItem("accessToken");
          setIsAuthenticated(false);
          router.replace("/dashboard");
          return;
        }
        throw new Error(`Failed to record checkpoint (${res.status})`);
      }
      setIsDrawerOpen(false);
      setSelectedBaselineId("active_checkpoint");
      // Immediately refresh the real summary to observe zero delta "caught up" state
      await fetchRealSummary("active_checkpoint");
    } catch (err: any) {
      alert(`Error setting checkpoint: ${err.message}`);
    } finally {
      setActionPending(false);
    }
  }, [router, fetchRealSummary]);

  // SINGLE STOCK CHECKPOINT: Acknowledge current spot price and zero out deltas for a single symbol
  const handleMarkSingleStockChecked = useCallback(async (symbol: string) => {
    setActionPending(true);
    try {
      const res = await fetch(`${API_URL}/watchlist/checkpoint/${encodeURIComponent(symbol)}`, {
        method: "POST",
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) {
        if (res.status === 401) {
          localStorage.removeItem("accessToken");
          setIsAuthenticated(false);
          router.replace("/dashboard");
          return;
        }
        throw new Error(`Failed to record checkpoint for ${symbol} (${res.status})`);
      }
      // Immediately refresh the real summary to observe that this stock moved to Unchanged
      await fetchRealSummary();
    } catch (err: any) {
      alert(`Error setting checkpoint for ${symbol}: ${err.message}`);
    } finally {
      setActionPending(false);
    }
  }, [router, fetchRealSummary]);

  // Initial mount: verify auth token; if missing, immediately redirect to login page
  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("accessToken") : null;
    if (!token) {
      setIsAuthenticated(false);
      router.replace("/dashboard");
      return;
    }
    setIsAuthenticated(true);
    fetchRealSummary();
  }, [router, fetchRealSummary]);

  // Periodic 60-second polling for live watchlist checkpoint deltas & news catalysts
  useEffect(() => {
    if (!isAuthenticated) return;
    const pollTimer = setInterval(() => {
      void fetchRealSummary();
    }, 60000);
    return () => clearInterval(pollTimer);
  }, [isAuthenticated, fetchRealSummary]);

  // Flatten all items across groups for quick lookup in detail drawer
  const allStocks = useMemo(() => {
    if (!data) return [];
    return [
      ...data.groups.needsAttention,
      ...data.groups.worthALook,
      ...data.groups.unchanged,
    ];
  }, [data]);

  const selectedStock: WatchlistChangeItem | null = useMemo(() => {
    if (!selectedStockSymbol || !allStocks.length) return null;
    return allStocks.find((s) => s.symbol === selectedStockSymbol) || null;
  }, [selectedStockSymbol, allStocks]);

  const matchedNews = useMemo(() => {
    if (!selectedStockSymbol || !events.length) return [];
    const upper = selectedStockSymbol.toUpperCase();

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
    const directMatches = events.filter((e: any) =>
      Array.isArray(e.primarySymbols) && e.primarySymbols.includes(upper)
    );

    // Priority 2: Ripple impact match (cross-market second-order transmission)
    const rippleMatches = events.filter(
      (e: any) =>
        !directMatches.includes(e) &&
        Array.isArray(e.rippleImpacts) &&
        e.rippleImpacts.some((r: any) => r.symbol === upper)
    );

    // Priority 3: Dynamic ticker & company name match with exact word boundaries
    const textMatches = events.filter((e: any) => {
      if (directMatches.includes(e) || rippleMatches.includes(e)) return false;
      const textToSearch = `${e.title || ""} ${e.summary || ""}`;
      return searchTerms.some((term) => {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`\\b${escaped}\\b`, "i").test(textToSearch);
      });
    });

    const combined = [...directMatches, ...rippleMatches, ...textMatches];
    if (combined.length > 0) return combined;

    // Macro fallback: Only return broad economy-wide macroeconomic events (e.g. GDP, Rates)
    const macroEvents = events.filter(
      (e: any) => e.eventType === "MACRO" || (Array.isArray(e.primarySymbols) && e.primarySymbols.includes("NIFTY") && e.transmissionPath === "MACRO_FX")
    );
    return macroEvents.slice(0, 2).map((ev: any) => ({ ...ev, isFallback: true }));
  }, [selectedStockSymbol, events]);

  const openDrawer = (symbol: string) => {
    setSelectedStockSymbol(symbol);
    setIsDrawerOpen(true);
  };

  const closeDrawer = () => {
    setIsDrawerOpen(false);
  };

  // Keyboard shortcut listener: 'C' to checkpoint, 'ESC' to close drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;

      if (e.key === "Escape") {
        setIsDrawerOpen(false);
      } else if (e.key === "c" || e.key === "C") {
        handleMarkAllAsChecked();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleMarkAllAsChecked]);

  // Helper for freshness status display
  const renderFreshnessBadge = (state: MarketFreshnessState) => {
    switch (state) {
      case "LIVE":
        return {
          dotClass: "bg-primary animate-pulse",
          text: "Live Feed",
        };
      case "DELAYED":
        return {
          dotClass: "bg-tertiary",
          text: "Delayed Feed",
        };
      case "STALE":
        return {
          dotClass: "bg-secondary",
          text: "Feed Stale",
        };
      case "MARKET_CLOSED":
        return {
          dotClass: "bg-outline",
          text: "Market Closed (Settled)",
        };
      case "DATA_UNAVAILABLE":
      default:
        return {
          dotClass: "bg-outline-variant",
          text: "Feed Unavailable",
        };
    }
  };

  const freshnessInfo = renderFreshnessBadge(data?.marketFreshness.state || "LIVE");

  if (isAuthenticated === null || !isAuthenticated) {
    return (
      <div className="bg-background text-on-surface antialiased min-h-screen flex items-center justify-center">
        <div className="p-8 text-center text-outline font-label-numeric-md">
          Verifying session authentication...
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background text-on-surface antialiased min-h-screen selection:bg-primary-container selection:text-on-primary-container">
      {/* ========================================================================= */}
      {/* SHARED HEADER                                                             */}
      {/* ========================================================================= */}
      <header className="flex justify-between items-center w-full px-gutter-desktop h-14 bg-surface border-b border-outline-variant sticky top-0 z-30">
        {/* Left Cluster: Product Wordmark + Watchlist Indicator */}
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-2.5">
            <div className="w-7 h-7 rounded-DEFAULT bg-surface-container-high border border-outline-variant flex items-center justify-center text-primary">
              <span className="material-symbols-outlined text-primary">change_history</span>
            </div>
            <div className="flex flex-col">
              <span className="text-headline-md font-headline-md font-bold tracking-tight text-on-surface">
                Smart Market Watch
              </span>
              <span className="text-[10px] font-label-numeric-sm text-outline-variant uppercase tracking-widest leading-none">
                Checkpoint Intelligence
              </span>
            </div>
          </div>
          {/* Segment Selector */}
          <div className="hidden lg:flex items-center space-x-2 pl-4 border-l border-outline-variant text-body-sm font-body-sm">
            <span className="px-2 py-0.5 rounded-DEFAULT bg-surface-container-high text-on-surface border border-outline-variant text-label-numeric-sm font-label-numeric-sm">
              NSE: Primary Watchlist ({data?.counts.total ?? 0} Equities)
            </span>
            <span className="text-outline-variant">▾</span>
          </div>
        </div>

        {/* Center Navigation Links */}
        <nav aria-label="Primary Navigation" className="hidden md:flex items-center space-x-8 h-full pt-3">
          <Link
            href="/dashboard"
            className="text-on-surface-variant hover:text-on-surface font-medium pb-3 transition-colors duration-150 text-body-md font-body-md"
          >
            Terminal Dashboard
          </Link>
          <a
            aria-current="page"
            className="text-primary border-b-2 border-primary font-medium pb-3 text-body-md font-body-md cursor-pointer"
            onClick={() => { fetchRealSummary(); }}
          >
            What Changed
          </a>
        </nav>

        {/* Right Cluster: Live Feed Status + Alerts + Actions */}
        <div className="flex items-center space-x-2.5">
          {/* Audio Chime Alert Toggle */}
          <button
            type="button"
            onClick={() => setSoundAlertsEnabled((prev) => !prev)}
            className={`w-8 h-8 rounded-DEFAULT flex items-center justify-center border transition-all ${
              soundAlertsEnabled
                ? "bg-primary/15 border-primary/40 text-primary hover:bg-primary/25"
                : "bg-surface-container border-outline-variant text-outline hover:text-on-surface"
            }`}
            title={soundAlertsEnabled ? "Audio Chime Alerts: ACTIVE (Plays on Category A escalation)" : "Audio Chime Alerts: MUTED"}
          >
            <span className="material-symbols-outlined text-[18px]">
              {soundAlertsEnabled ? "volume_up" : "volume_off"}
            </span>
          </button>

          {/* Desktop Notifications Toggle */}
          <button
            type="button"
            onClick={toggleDesktopNotifications}
            className={`w-8 h-8 rounded-DEFAULT flex items-center justify-center border transition-all ${
              desktopAlertsEnabled
                ? "bg-primary/15 border-primary/40 text-primary hover:bg-primary/25"
                : "bg-surface-container border-outline-variant text-outline hover:text-on-surface"
            }`}
            title={desktopAlertsEnabled ? "Desktop Notifications: ACTIVE" : "Desktop Notifications: INACTIVE (Click to enable)"}
          >
            <span className="material-symbols-outlined text-[18px]">
              {desktopAlertsEnabled ? "notifications_active" : "notifications_off"}
            </span>
          </button>

          {/* Live Market & Feed Status Pill (Side Updating) */}
          <div
            className="hidden sm:flex items-center space-x-2 bg-surface-container-lowest px-2.5 py-1 rounded-DEFAULT border border-outline-variant font-label-numeric-sm text-label-numeric-sm"
            title={`Feed: ${socketConnected ? "Kite WebSocket Live (<1s)" : freshnessInfo.text} · ${data?.marketFreshness.note || "Direct stream nominal"}`}
          >
            <span className={`w-2 h-2 rounded-full ${socketConnected ? "bg-primary animate-pulse" : freshnessInfo.dotClass}`}></span>
            <span className="text-on-surface font-medium">
              {socketConnected ? (brokerStatus?.connected ? "Kite Live Feed" : "Live Stream (<1s)") : freshnessInfo.text}
            </span>
            <span className="text-outline">|</span>
            <span className="text-on-surface-variant font-mono text-[11px]">
              {currentTime ? new Date(currentTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Active"}
            </span>
            <span className="text-outline">|</span>
            <span className="text-on-surface font-semibold">NIFTY 50:</span>
            <span className="text-primary font-semibold">Tracked</span>
          </div>

          {/* Primary Action: Mark Checkpoint */}
          <button
            disabled={actionPending}
            className="inline-flex items-center space-x-1.5 px-3 py-1 bg-surface-variant border border-outline-variant hover:border-primary text-on-surface hover:text-primary rounded-DEFAULT text-label-numeric-sm font-label-numeric-sm font-medium transition-all duration-150 active:scale-95 shadow-sm disabled:opacity-50"
            onClick={handleMarkAllAsChecked}
            title="Acknowledge current market state as new baseline"
          >
            <span className="material-symbols-outlined text-primary text-[15px]">done_all</span>
            <span>{actionPending ? "Updating..." : "Mark Checkpoint"}</span>
          </button>

          {/* Quick Refresh */}
          <button
            className="w-8 h-8 rounded-DEFAULT flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors duration-150"
            onClick={() => { fetchRealSummary(); }}
            title="Refresh Data"
          >
            <span className={`material-symbols-outlined ${loading ? "animate-spin" : ""}`}>
              refresh
            </span>
          </button>

          {/* Log out Action */}
          <button
            className="hidden sm:inline-flex items-center space-x-1 px-2.5 py-1 text-label-numeric-sm font-label-numeric-sm border border-outline-variant/60 rounded-DEFAULT bg-surface-container/60 hover:bg-surface-container text-outline hover:text-on-surface transition-colors duration-150 active:scale-95"
            onClick={() => {
              localStorage.removeItem("accessToken");
              router.replace("/dashboard");
            }}
            title="Log out"
          >
            <span>Log out</span>
          </button>

          {/* User Profile */}
          <div
            className="w-7 h-7 rounded-DEFAULT bg-surface-container-high border border-outline-variant flex items-center justify-center ml-1 text-on-surface font-label-numeric-sm text-label-numeric-sm font-bold"
            title="Active user session"
          >
            {data?.userId ? data.userId.slice(0, 2).toUpperCase() : "AG"}
          </div>
        </div>
      </header>

      {/* ========================================================================= */}
      {/* MARKET CLOSED / FEED LATENCY BANNER                                       */}
      {/* ========================================================================= */}
      {data?.marketFreshness.state === "MARKET_CLOSED" && (
        <div className="w-full bg-surface-container-low border-b border-outline-variant px-gutter-desktop py-2.5 transition-all">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
            <div className="flex items-center space-x-2.5">
              <span className="material-symbols-outlined text-tertiary">info</span>
              <div>
                <span className="font-headline-sm text-headline-sm text-on-surface">
                  Market Closed
                </span>
                <span className="text-body-sm font-body-sm text-on-surface-variant ml-2">
                  {data.marketFreshness.note}
                </span>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded-DEFAULT bg-surface-variant text-outline border border-outline-variant font-label-numeric-sm text-label-numeric-sm">
              SETTLED
            </span>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MAIN CONTAINER                                                            */}
      {/* ========================================================================= */}
      <main className="max-w-7xl mx-auto px-gutter-desktop py-6 space-y-6">
        {/* Loading / Error States */}
        {loading && !data && (
          <div className="p-12 text-center text-outline font-label-numeric-md">
            Connecting to Smart Market Watch engine...
          </div>
        )}

        {error && (
          <div className="p-4 bg-error-container/20 border border-error-container rounded-DEFAULT text-on-surface flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <span className="material-symbols-outlined text-error">error</span>
              <span>{error}</span>
            </div>
            <button
              onClick={() => { fetchRealSummary(); }}
              className="text-primary hover:underline font-label-numeric-sm text-label-numeric-sm"
            >
              Retry Connection →
            </button>
          </div>
        )}

        {data && (
          <>
            {/* 1. TEMPORAL HEADER & ATTENTION TRIAGE BAR */}
            <section className="bg-surface-container-low border border-outline-variant rounded-DEFAULT p-5 relative overflow-hidden">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                {/* Left: Warm & Calm Briefing Headline */}
                <div className="space-y-2">
                  <div className="flex items-center space-x-3">
                    <span className="px-2 py-0.5 rounded-DEFAULT bg-primary/10 text-primary text-label-numeric-sm font-label-numeric-sm font-semibold border border-primary/20">
                      WATCHLIST BRIEFING
                    </span>
                    <span className="text-body-sm text-outline-variant font-label-numeric-sm">
                      {data.counts.total} Tracked Equities
                    </span>
                    <span className="text-outline-variant">•</span>
                    <span className="inline-flex items-center space-x-1.5 px-2 py-0.5 rounded-DEFAULT bg-surface-container-high border border-outline-variant text-[11px] font-label-numeric-sm text-on-surface">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
                      <span>AI Engine: Active ({events.length} News Catalysts)</span>
                    </span>
                  </div>
                  <h1 className="text-headline-xl font-headline-xl text-on-surface font-semibold tracking-tight leading-snug">
                    What meaningfully changed while you were away?
                  </h1>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body-md font-body-md text-on-surface-variant pt-0.5">
                    <span className="flex items-center space-x-1.5">
                      <span className="material-symbols-outlined text-primary text-[18px]">schedule</span>
                      <span className="text-on-surface font-medium">Last checked:</span>
                      <strong className="text-primary font-label-numeric-md font-semibold">
                        {data.timeAwayHuman}
                      </strong>
                      {data.lastCheckedAt && (
                        <span className="text-outline font-label-numeric-sm">
                          ({new Date(data.lastCheckedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })})
                        </span>
                      )}
                    </span>
                    <span className="text-outline-variant hidden sm:inline">•</span>
                    <span className="text-on-surface-variant font-body-sm">
                      Baseline comparison vs NIFTY 50
                    </span>
                  </div>
                </div>

                {/* Right: Baseline Replay Selector & Checkpoint Action */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-shrink-0">
                  {/* Baseline Replay Selector Dropdown */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setIsBaselineDropdownOpen((prev) => !prev)}
                      className={`flex items-center space-x-2 px-3.5 py-2.5 rounded-DEFAULT border text-label-numeric-sm font-medium transition-all ${
                        data.replayMode
                          ? "bg-amber-500/15 border-amber-500/40 text-amber-300 hover:bg-amber-500/25"
                          : "bg-surface-container border-outline-variant hover:border-primary/50 text-on-surface hover:bg-surface-container-high"
                      }`}
                      title="Select baseline snapshot to calculate deltas against"
                    >
                      <span className="material-symbols-outlined text-[17px] text-primary">history_toggle_off</span>
                      <span className="text-on-surface-variant text-xs">Baseline:</span>
                      <strong className="text-on-surface font-semibold max-w-[140px] sm:max-w-[180px] truncate">
                        {data.activeBaseline?.label || "Active Checkpoint"}
                      </strong>
                      <span className="material-symbols-outlined text-[16px] text-outline">
                        {isBaselineDropdownOpen ? "expand_less" : "expand_more"}
                      </span>
                    </button>
                    {isBaselineDropdownOpen && (
                      <div className="absolute right-0 mt-1.5 w-72 bg-surface-container-high border border-outline-variant rounded-DEFAULT shadow-2xl z-50 py-1 overflow-hidden">
                        <div className="px-3 py-1.5 text-[11px] font-caption-caps text-outline uppercase tracking-wider border-b border-outline-variant flex items-center justify-between">
                          <span>Checkpoint Replay</span>
                          <span className="text-[10px] text-primary font-bold">TIME MACHINE</span>
                        </div>
                        <div className="max-h-60 overflow-y-auto divide-y divide-outline-variant/40">
                          {data.availableCheckpoints && data.availableCheckpoints.length > 0 ? (
                            data.availableCheckpoints.map((chk) => {
                              const isSelected = data.activeBaseline?.id === chk.id || (!data.activeBaseline && chk.isLive);
                              return (
                                <button
                                  key={chk.id}
                                  type="button"
                                  onClick={() => {
                                    setIsBaselineDropdownOpen(false);
                                    setSelectedBaselineId(chk.id);
                                    fetchRealSummary(chk.id);
                                  }}
                                  className={`w-full text-left px-3 py-2 text-label-numeric-sm flex flex-col transition-colors ${
                                    isSelected
                                      ? "bg-primary/20 text-primary font-bold border-l-2 border-primary"
                                      : "text-on-surface hover:bg-surface-variant"
                                  }`}
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="font-semibold text-body-sm">{chk.label}</span>
                                    {chk.isLive && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary uppercase font-bold">
                                        Active
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[11px] text-outline-variant font-mono mt-0.5">
                                    {chk.time ? new Date(chk.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : chk.label}
                                  </span>
                                </button>
                              );
                            })
                          ) : (
                            <div className="px-3 py-2 text-outline text-xs">No historical checkpoints found</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <button
                    disabled={actionPending}
                    className="flex items-center justify-center space-x-2 px-5 py-2.5 bg-primary text-on-primary font-semibold rounded-DEFAULT hover:bg-primary-fixed shadow-md active:scale-95 transition-all text-body-md group disabled:opacity-50"
                    onClick={handleMarkAllAsChecked}
                    title="Establish a fresh baseline at current spot prices"
                  >
                    <span className="material-symbols-outlined text-[19px]">done_all</span>
                    <span>{actionPending ? "Updating baseline..." : "Mark all as checked"}</span>
                    <kbd className="ml-1 px-1.5 py-0.5 rounded-DEFAULT bg-on-primary/20 text-on-primary text-[10px] font-label-numeric-sm tracking-wider uppercase">
                      C
                    </kbd>
                  </button>
                </div>
              </div>

              {/* Triage Summary Badges */}
              <div className="mt-5 pt-4 border-t border-outline-variant flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedCategory("ALL")}
                    className={`flex items-center space-x-2 px-3 py-1.5 rounded-DEFAULT border transition-all text-label-numeric-sm font-semibold cursor-pointer ${
                      selectedCategory === "ALL"
                        ? "bg-primary text-background border-primary shadow-sm"
                        : "bg-surface-container text-on-surface-variant hover:text-on-surface border-outline-variant hover:border-outline"
                    }`}
                    title="Show all categories"
                  >
                    <span>All ({data.counts.total})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedCategory(selectedCategory === "CATEGORY_A" ? "ALL" : "CATEGORY_A")}
                    className={`flex items-center space-x-2 px-3 py-1.5 rounded-DEFAULT border transition-all cursor-pointer ${
                      selectedCategory === "CATEGORY_A"
                        ? "bg-secondary-container/30 text-secondary border-secondary shadow-md ring-1 ring-secondary"
                        : "bg-surface-container text-secondary border-secondary-container/40 hover:border-secondary/70 hover:bg-surface-container-high"
                    }`}
                    title="Filter to Category A: Needs Attention"
                  >
                    <span className="w-2 h-2 rounded-full bg-secondary"></span>
                    <span className="font-label-numeric-md text-label-numeric-md font-bold">
                      {data.counts.needsAttention} NEEDS ATTENTION
                    </span>
                    <span className="text-outline text-label-numeric-sm hidden sm:inline">(Score &gt; 60 or |Δ| &ge; 2.5%)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedCategory(selectedCategory === "CATEGORY_B" ? "ALL" : "CATEGORY_B")}
                    className={`flex items-center space-x-2 px-3 py-1.5 rounded-DEFAULT border transition-all cursor-pointer ${
                      selectedCategory === "CATEGORY_B"
                        ? "bg-tertiary-container/30 text-tertiary border-tertiary shadow-md ring-1 ring-tertiary"
                        : "bg-surface-container text-tertiary border-tertiary-container/40 hover:border-tertiary/70 hover:bg-surface-container-high"
                    }`}
                    title="Filter to Category B: Worth A Look"
                  >
                    <span className="w-2 h-2 rounded-full bg-tertiary"></span>
                    <span className="font-label-numeric-md text-label-numeric-md font-bold">
                      {data.counts.worthALook} WORTH A LOOK
                    </span>
                    <span className="text-outline text-label-numeric-sm hidden sm:inline">(Score 30–59 or |Δ| &ge; 1.0%)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedCategory(selectedCategory === "CATEGORY_C" ? "ALL" : "CATEGORY_C")}
                    className={`flex items-center space-x-2 px-3 py-1.5 rounded-DEFAULT border transition-all cursor-pointer ${
                      selectedCategory === "CATEGORY_C"
                        ? "bg-surface-container-high text-on-surface border-outline shadow-md ring-1 ring-outline"
                        : "bg-surface-container text-on-surface-variant border-outline-variant hover:border-outline hover:bg-surface-container-high"
                    }`}
                    title="Filter to Category C: Unchanged & Noise Filtered"
                  >
                    <span className="w-2 h-2 rounded-full bg-outline"></span>
                    <span className="font-label-numeric-md text-label-numeric-md font-medium">
                      {data.counts.unchanged} UNCHANGED
                    </span>
                    <span className="text-outline text-label-numeric-sm hidden sm:inline">(Noise &lt; ±1.0%)</span>
                  </button>
                </div>

                {/* Guiding Principles */}
                <div className="hidden xl:flex items-center space-x-4 text-label-numeric-sm text-outline">
                  <span className="flex items-center space-x-1">
                    <span className="text-primary">✓</span>
                    <span>Deterministic triage</span>
                  </span>
                  <span className="flex items-center space-x-1">
                    <span className="text-primary">✓</span>
                    <span>Zero noise flicker</span>
                  </span>
                  <span className="flex items-center space-x-1">
                    <span className="text-primary">✓</span>
                    <span>Verified catalysts</span>
                  </span>
                </div>
              </div>
            </section>

            {/* TIME MACHINE REPLAY MODE BANNER */}
            {data.replayMode && data.activeBaseline && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-DEFAULT p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-md">
                <div className="flex items-center space-x-3">
                  <div className="w-9 h-9 rounded-DEFAULT bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold flex-shrink-0">
                    <span className="material-symbols-outlined text-[22px]">history</span>
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-amber-400 text-label-numeric-sm uppercase tracking-wider">
                        Time Machine Replay Mode Active
                      </span>
                      <span className="text-outline text-xs">•</span>
                      <span className="text-on-surface font-semibold text-body-sm">
                        Baseline: {data.activeBaseline.label}
                      </span>
                    </div>
                    <p className="text-on-surface-variant text-body-sm mt-0.5">
                      Recalculating price deltas, volume pace, and alpha against historical snapshot ({data.activeBaseline.time ? new Date(data.activeBaseline.time).toLocaleString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", month: "short", day: "numeric" }) : "historical anchor"}). Real-time prices are compared to this moment.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedBaselineId("active_checkpoint");
                    fetchRealSummary("active_checkpoint");
                  }}
                  className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-DEFAULT text-label-numeric-sm font-semibold transition-all whitespace-nowrap active:scale-95"
                >
                  <span className="material-symbols-outlined text-[16px]">restart_alt</span>
                  <span>Reset to Active Checkpoint</span>
                </button>
              </div>
            )}

            {/* FIRST VISIT STATE (If user has never established a checkpoint) */}
            {data.isFirstVisit && (
              <div className="bg-surface-container border border-outline-variant rounded-DEFAULT p-12 text-center space-y-6">
                <div className="w-14 h-14 rounded-DEFAULT bg-surface-container-high border border-outline-variant text-primary flex items-center justify-center mx-auto">
                  <span className="material-symbols-outlined text-[32px]">flag</span>
                </div>
                <div className="space-y-2 max-w-xl mx-auto">
                  <h2 className="text-headline-lg font-headline-lg text-on-surface font-bold">
                    Establish Your Baseline Checkpoint
                  </h2>
                  <p className="text-body-md font-body-md text-on-surface-variant">
                    Smart Market Watch does not overwhelm you with continuous flickering green/red digits. We establish a snapshot right now at <strong className="text-on-surface">T0</strong>, and will only surface stocks when prices meaningfully diverge, break volumes, or trigger verified catalysts.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto text-left">
                  <div className="p-3 bg-surface rounded-DEFAULT border border-outline-variant">
                    <span className="text-primary font-label-numeric-sm text-label-numeric-sm font-bold block mb-1">
                      01. Snapshot
                    </span>
                    <span className="text-body-sm font-body-sm text-on-surface-variant">
                      Current spot prices become your baseline reference anchor.
                    </span>
                  </div>
                  <div className="p-3 bg-surface rounded-DEFAULT border border-outline-variant">
                    <span className="text-primary font-label-numeric-sm text-label-numeric-sm font-bold block mb-1">
                      02. Noise Filter
                    </span>
                    <span className="text-body-sm font-body-sm text-on-surface-variant">
                      Standard market noise (±0.35%) is cleanly filtered out.
                    </span>
                  </div>
                  <div className="p-3 bg-surface rounded-DEFAULT border border-outline-variant">
                    <span className="text-primary font-label-numeric-sm text-label-numeric-sm font-bold block mb-1">
                      03. Deterministic
                    </span>
                    <span className="text-body-sm font-body-sm text-on-surface-variant">
                      Every alert surfaces verifiable math, volume multipliers, &amp; catalysts.
                    </span>
                  </div>
                </div>
                <button
                  disabled={actionPending}
                  className="px-5 py-2.5 bg-on-surface text-background font-semibold rounded-DEFAULT hover:bg-white active:scale-95 transition-all text-body-md font-body-md disabled:opacity-50"
                  onClick={handleMarkAllAsChecked}
                >
                  {actionPending ? "Establishing baseline..." : "Take First Checkpoint Baseline Now"}
                </button>
              </div>
            )}

            {/* CAUGHT UP STATE (When 0 stocks require attention) */}
            {!data.isFirstVisit &&
              data.counts.needsAttention === 0 &&
              data.counts.worthALook === 0 && (
                <div className="bg-surface-container border border-outline-variant rounded-DEFAULT p-12 text-center space-y-4">
                  <div className="w-12 h-12 rounded-full bg-primary-container/20 text-primary border border-primary/40 flex items-center justify-center mx-auto">
                    <span className="material-symbols-outlined text-[28px]">verified</span>
                  </div>
                  <div className="space-y-1">
                    <h2 className="text-headline-md font-headline-md text-on-surface font-bold">
                      You&apos;re completely caught up
                    </h2>
                    <p className="text-body-md font-body-md text-on-surface-variant max-w-lg mx-auto">
                      None of your {data.counts.total} tracked equities have deviated outside their noise thresholds since your checkpoint ({data.timeAwayHuman}).
                    </p>
                  </div>
                  <div className="pt-2 flex items-center justify-center space-x-3">
                    <Link
                      href="/dashboard"
                      className="px-4 py-2 rounded-DEFAULT bg-surface-variant hover:bg-surface-container-high border border-outline-variant text-on-surface text-label-numeric-sm font-label-numeric-sm"
                    >
                      Open Terminal Dashboard →
                    </Link>
                  </div>
                </div>
              )}

            {/* ACTIVE RANKED FEED (When deltas exist) */}
            {!data.isFirstVisit &&
              (data.counts.needsAttention > 0 || data.counts.worthALook > 0 || data.counts.unchanged > 0) && (
                <div className="space-y-8">
                  {/* Category Filter Notice Bar when filtering */}
                  {selectedCategory !== "ALL" && (
                    <div className="flex items-center justify-between p-3 rounded-DEFAULT bg-surface-container border border-outline-variant text-body-sm shadow-sm">
                      <div className="flex items-center space-x-2">
                        <span className="material-symbols-outlined text-primary text-[18px]">filter_list</span>
                        <span>
                          Filtered view: <strong className="text-on-surface font-semibold">
                            {selectedCategory === "CATEGORY_A"
                              ? `Category A: Needs Attention (${data.groups.needsAttention.length} equities)`
                              : selectedCategory === "CATEGORY_B"
                              ? `Category B: Worth A Look (${data.groups.worthALook.length} equities)`
                              : `Category C: Unchanged & Noise Filtered (${data.groups.unchanged.length} equities)`}
                          </strong>
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedCategory("ALL")}
                        className="text-primary hover:underline font-medium text-label-numeric-sm flex items-center space-x-1"
                      >
                        <span>Show All Categories</span>
                        <span>✕</span>
                      </button>
                    </div>
                  )}

                  {/* Empty state if selected category has 0 items */}
                  {selectedCategory === "CATEGORY_A" && data.groups.needsAttention.length === 0 && (
                    <div className="p-8 text-center bg-surface-container border border-outline-variant rounded-DEFAULT space-y-2">
                      <p className="text-body-md text-on-surface font-semibold">No equities currently in Category A: Needs Attention</p>
                      <button onClick={() => setSelectedCategory("ALL")} className="text-primary text-body-sm hover:underline">Show All Categories →</button>
                    </div>
                  )}
                  {selectedCategory === "CATEGORY_B" && data.groups.worthALook.length === 0 && (
                    <div className="p-8 text-center bg-surface-container border border-outline-variant rounded-DEFAULT space-y-2">
                      <p className="text-body-md text-on-surface font-semibold">No equities currently in Category B: Worth A Look</p>
                      <button onClick={() => setSelectedCategory("ALL")} className="text-primary text-body-sm hover:underline">Show All Categories →</button>
                    </div>
                  )}
                  {selectedCategory === "CATEGORY_C" && data.groups.unchanged.length === 0 && (
                    <div className="p-8 text-center bg-surface-container border border-outline-variant rounded-DEFAULT space-y-2">
                      <p className="text-body-md text-on-surface font-semibold">No equities currently in Category C: Unchanged</p>
                      <button onClick={() => setSelectedCategory("ALL")} className="text-primary text-body-sm hover:underline">Show All Categories →</button>
                    </div>
                  )}

                  {/* CATEGORY A: NEEDS ATTENTION */}
                  {(selectedCategory === "ALL" || selectedCategory === "CATEGORY_A") && data.groups.needsAttention.length > 0 && (
                    <section className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-secondary animate-pulse"></span>
                          <h2 className="text-headline-sm font-headline-sm text-on-surface uppercase tracking-wider font-semibold">
                            Category A: Needs Attention ({data.groups.needsAttention.length})
                          </h2>
                          <span className="text-body-sm font-body-sm text-on-surface-variant">
                            — Material price divergence, abnormal volume velocity, or verified catalyst
                          </span>
                        </div>
                        <span className="text-label-numeric-sm font-label-numeric-sm text-outline">
                          Sorted by Attention Score (Desc)
                        </span>
                      </div>

                      <div className="grid grid-cols-1 gap-3">
                        {data.groups.needsAttention.map((stock) => {
                          const isPositive = stock.priceChangePct >= 0;
                          const deltaAmount = stock.currentPrice - stock.checkpointPrice;
                          const flash = tickFlashes[stock.symbol];
                          const flashClass = flash === "up" ? "ring-2 ring-primary/80 bg-primary/5 transition-all duration-300" : flash === "down" ? "ring-2 ring-secondary/80 bg-secondary/5 transition-all duration-300" : "";
                          return (
                            <article
                              key={stock.symbol}
                              className={`bg-surface-container border border-outline-variant hover:border-primary/50 hover:bg-surface-container-high rounded-DEFAULT p-4 transition-all duration-150 cursor-pointer relative group overflow-hidden ${flashClass}`}
                              onClick={() => openDrawer(stock.symbol)}
                            >
                              <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                                <div className="space-y-2 min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-headline-md font-headline-md font-bold text-on-surface">
                                      {stock.symbol}
                                    </span>
                                    <span className="px-2 py-0.5 rounded-DEFAULT bg-primary-container/15 text-primary border border-primary/30 font-label-numeric-sm text-label-numeric-sm font-semibold">
                                      Attention Required
                                    </span>
                                    <span className="px-1.5 py-0.5 rounded-DEFAULT bg-surface-variant text-on-surface font-label-numeric-sm text-label-numeric-sm">
                                      Score: {stock.attentionScore}/100
                                    </span>
                                  </div>
                                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                    <span className="text-headline-lg font-headline-lg font-bold text-on-surface font-label-numeric-lg text-label-numeric-lg">
                                      ₹{stock.currentPrice.toFixed(2)}
                                    </span>
                                    <span
                                      className={`font-label-numeric-md text-label-numeric-md font-bold flex items-center ${
                                        isPositive ? "text-primary" : "text-secondary"
                                      }`}
                                    >
                                      <span className="material-symbols-outlined text-[16px]">
                                        {isPositive ? "arrow_upward" : "arrow_downward"}
                                      </span>
                                      {isPositive ? "+" : ""}
                                      {stock.priceChangePct.toFixed(2)}% ({isPositive ? "+₹" : "-₹"}
                                      {Math.abs(deltaAmount).toFixed(2)}) since checkpoint
                                    </span>
                                    <span className="text-outline text-label-numeric-sm font-label-numeric-sm">
                                      (Checkpoint: ₹{stock.checkpointPrice.toFixed(2)})
                                    </span>
                                  </div>
                                  {/* Reasons List */}
                                  <ul className="mt-2 space-y-1 text-body-md font-body-md text-on-surface">
                                    {stock.reasons.map((r, idx) => (
                                      <li key={idx} className="flex items-start space-x-2">
                                        <span className={`${isPositive ? "text-primary" : "text-secondary"} font-bold`}>
                                          •
                                        </span>
                                        <span>
                                          <strong>{r.label}:</strong> {r.value}
                                        </span>
                                      </li>
                                    ))}
                                    {stock.summaryExplanation && (
                                      <li className="flex items-start space-x-2 text-on-surface-variant">
                                        <span className="text-outline font-bold">•</span>
                                        <span>{stock.summaryExplanation}</span>
                                      </li>
                                    )}
                                  </ul>
                                </div>
                                <div className="flex flex-row md:flex-col items-end justify-between md:justify-start gap-3 flex-shrink-0">
                                  <div className="text-right">
                                    <span className="text-caption-caps font-caption-caps text-outline block">
                                      ALPHA VS NIFTY
                                    </span>
                                    <span
                                      className={`font-label-numeric-md text-label-numeric-md font-bold ${
                                        stock.benchmarkAlphaPct !== null && stock.benchmarkAlphaPct >= 0
                                          ? "text-primary"
                                          : "text-secondary"
                                      }`}
                                    >
                                      {stock.benchmarkAlphaPct !== null
                                        ? `${stock.benchmarkAlphaPct >= 0 ? "+" : ""}${stock.benchmarkAlphaPct.toFixed(2)}% net`
                                        : "N/A"}
                                    </span>
                                  </div>
                                  <div className="flex items-center space-x-2">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleMarkSingleStockChecked(stock.symbol);
                                      }}
                                      disabled={actionPending}
                                      className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-DEFAULT bg-surface-variant hover:bg-primary/20 hover:text-primary text-outline border border-outline-variant text-label-numeric-sm font-label-numeric-sm transition-colors font-medium whitespace-nowrap disabled:opacity-50"
                                      title={`Acknowledge and mark ${stock.symbol} as checked`}
                                    >
                                      <span className="material-symbols-outlined text-[15px]">done</span>
                                      <span>Check</span>
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openDrawer(stock.symbol);
                                      }}
                                      className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-DEFAULT bg-surface-variant group-hover:bg-primary group-hover:text-background text-on-surface text-body-sm font-body-sm transition-all border border-outline-variant font-medium whitespace-nowrap"
                                    >
                                      <span>Inspect</span>
                                      <span className="material-symbols-outlined text-[16px] group-hover:translate-x-0.5 transition-transform">
                                        arrow_forward
                                      </span>
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {/* CATEGORY B: WORTH A LOOK */}
                  {(selectedCategory === "ALL" || selectedCategory === "CATEGORY_B") && data.groups.worthALook.length > 0 && (
                    <section className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-tertiary"></span>
                          <h2 className="text-headline-sm font-headline-sm text-on-surface uppercase tracking-wider font-semibold">
                            Category B: Worth A Look ({data.groups.worthALook.length})
                          </h2>
                          <span className="text-body-sm font-body-sm text-on-surface-variant">
                            — Moderate divergence or benchmark drift
                          </span>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {data.groups.worthALook.map((stock) => {
                          const isPositive = stock.priceChangePct >= 0;
                          const flash = tickFlashes[stock.symbol];
                          const flashClass = flash === "up" ? "ring-2 ring-primary/80 bg-primary/5 transition-all duration-300" : flash === "down" ? "ring-2 ring-secondary/80 bg-secondary/5 transition-all duration-300" : "";
                          return (
                            <div
                              key={stock.symbol}
                              className={`bg-surface-container border border-outline-variant hover:border-outline rounded-DEFAULT p-4 transition-colors cursor-pointer ${flashClass}`}
                              onClick={() => openDrawer(stock.symbol)}
                            >
                              <div className="flex items-start justify-between">
                                <div>
                                  <div className="flex items-center space-x-2">
                                    <span className="font-headline-sm text-headline-sm text-on-surface font-bold">
                                      {stock.symbol}
                                    </span>
                                    <span className="px-1.5 py-0.5 rounded-DEFAULT bg-surface-variant text-on-surface font-label-numeric-sm text-label-numeric-sm">
                                      Score: {stock.attentionScore}/100
                                    </span>
                                    <span className="px-1.5 py-0.5 rounded-DEFAULT bg-tertiary/10 text-tertiary border border-tertiary/20 text-label-numeric-sm font-label-numeric-sm">
                                      Moderate Drift
                                    </span>
                                  </div>
                                  <div className="mt-1 flex items-baseline space-x-2">
                                    <span className="font-label-numeric-md text-label-numeric-md font-bold text-on-surface">
                                      ₹{stock.currentPrice.toFixed(2)}
                                    </span>
                                    <span
                                      className={`font-label-numeric-sm text-label-numeric-sm font-medium ${
                                        isPositive ? "text-primary" : "text-secondary"
                                      }`}
                                    >
                                      {isPositive ? "+" : ""}
                                      {stock.priceChangePct.toFixed(2)}% since checkpoint
                                    </span>
                                  </div>
                                </div>
                                <span className="text-label-numeric-sm font-label-numeric-sm text-outline">
                                  {stock.volumeRatio !== null ? `Vol: ${stock.volumeRatio.toFixed(1)}x` : "Vol: N/A"}
                                </span>
                              </div>
                              <div className="mt-3 pt-2.5 border-t border-outline-variant/60 flex items-center justify-between gap-2">
                                <p className="text-body-sm font-body-sm text-on-surface-variant line-clamp-1 flex-1">
                                  {stock.summaryExplanation || stock.reasons[0]?.value || "Observed price divergence from baseline."}
                                </p>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMarkSingleStockChecked(stock.symbol);
                                  }}
                                  disabled={actionPending}
                                  className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-DEFAULT bg-surface-variant hover:bg-primary/20 hover:text-primary text-outline border border-outline-variant text-label-numeric-sm font-label-numeric-sm transition-colors font-medium whitespace-nowrap disabled:opacity-50"
                                  title={`Acknowledge and mark ${stock.symbol} as checked`}
                                >
                                  <span className="material-symbols-outlined text-[15px]">done</span>
                                  <span>Check</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {/* CATEGORY C: UNCHANGED & NOISE FILTERED */}
                  {(selectedCategory === "ALL" || selectedCategory === "CATEGORY_C") && data.groups.unchanged.length > 0 && (
                    <section className="bg-surface-container-low border border-outline-variant rounded-DEFAULT p-4 space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center space-x-2">
                          <span className="w-2 h-2 rounded-full bg-outline"></span>
                          <h3 className="text-headline-sm font-headline-sm text-on-surface uppercase tracking-wider font-semibold">
                            Category C: Unchanged &amp; Noise Filtered ({data.groups.unchanged.length})
                          </h3>
                        </div>
                        <span className="text-body-sm font-body-sm text-outline font-label-numeric-sm">
                          All {data.groups.unchanged.length} equities trading within noise band. No action required.
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2 pt-2 border-t border-outline-variant">
                        {data.groups.unchanged.map((stock) => {
                          const isPositive = stock.priceChangePct > 0;
                          const isNegative = stock.priceChangePct < 0;
                          const flash = tickFlashes[stock.symbol];
                          const flashClass = flash === "up" ? "ring-1 ring-primary/80 bg-primary/10 transition-all duration-300" : flash === "down" ? "ring-1 ring-secondary/80 bg-secondary/10 transition-all duration-300" : "";
                          return (
                            <div
                              key={stock.symbol}
                              className={`bg-surface p-2.5 rounded-DEFAULT border border-outline-variant flex flex-col cursor-pointer hover:border-outline ${flashClass}`}
                              onClick={() => openDrawer(stock.symbol)}
                            >
                              <span className="text-on-surface font-label-numeric-sm text-label-numeric-sm font-bold">
                                {stock.symbol}
                              </span>
                              <span className="text-outline font-label-numeric-sm text-label-numeric-sm">
                                ₹{stock.currentPrice.toFixed(2)}
                              </span>
                              <span
                                className={`font-label-numeric-sm text-label-numeric-sm mt-1 ${
                                  isPositive ? "text-primary" : isNegative ? "text-secondary" : "text-outline"
                                }`}
                              >
                                {isPositive ? "+" : ""}
                                {stock.priceChangePct.toFixed(2)}%
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  )}
                </div>
              )}
          </>
        )}
      </main>

      {/* ========================================================================= */}
      {/* SLIDE-OVER DETAIL DRAWER (Inspectable Fact Matrix)                         */}
      {/* ========================================================================= */}
      {isDrawerOpen && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 transition-opacity"
          onClick={closeDrawer}
        ></div>
      )}
      <section
        aria-label="Stock Change Factor Inspection Panel"
        className={`fixed inset-y-0 right-0 max-w-xl w-full bg-surface-container border-l border-outline-variant z-50 transform transition-transform duration-200 ease-in-out flex flex-col shadow-2xl ${
          isDrawerOpen && selectedStock ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {selectedStock && (
          <>
            {/* Drawer Header */}
            <div className="p-5 border-b border-outline-variant flex items-start justify-between bg-surface">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="text-headline-md font-headline-md font-bold text-on-surface">
                    {selectedStock.symbol}
                  </span>
                  <span className="px-2 py-0.5 rounded-DEFAULT bg-surface-variant text-on-surface border border-outline-variant font-label-numeric-sm text-label-numeric-sm font-bold">
                    Attention Score: {selectedStock.attentionScore} / 100
                  </span>
                </div>
                <span className="text-body-sm font-body-sm text-outline font-label-numeric-sm">
                  NSE: {selectedStock.symbol} · Significance: {selectedStock.significance}
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => handleMarkSingleStockChecked(selectedStock.symbol)}
                  disabled={actionPending}
                  className="px-3 py-1.5 rounded-DEFAULT bg-primary text-background font-bold text-label-numeric-sm hover:bg-primary/90 flex items-center space-x-1.5 transition-transform active:scale-95 shadow-sm disabled:opacity-50"
                  title={`Acknowledge baseline and mark ${selectedStock.symbol} as checked`}
                >
                  <span className="material-symbols-outlined text-[16px]">check_circle</span>
                  <span>Mark {selectedStock.symbol} Checked</span>
                </button>
                <button
                  className="w-8 h-8 rounded-DEFAULT bg-surface-variant hover:bg-surface-container-highest text-on-surface-variant flex items-center justify-center transition-colors"
                  onClick={closeDrawer}
                  title="Close (ESC)"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
            </div>

            {/* Drawer Body */}
            <div className="p-6 space-y-6 overflow-y-auto flex-1">
              {/* Timestamp Baseline Summary Bar */}
              <div className="bg-surface p-4 rounded-DEFAULT border border-outline-variant">
                <div className="flex items-center justify-between text-caption-caps font-caption-caps text-outline mb-2">
                  <span>BASELINE CHECKPOINT</span>
                  <span className="material-symbols-outlined text-[14px]">arrow_right_alt</span>
                  <span>CURRENT SPOT PRICE</span>
                </div>
                <div className="flex items-center justify-between font-label-numeric-md text-label-numeric-md">
                  <div className="text-on-surface">
                    <span className="text-outline block text-caption-caps">Checkpoint Baseline:</span>
                    <span>₹{selectedStock.checkpointPrice.toFixed(2)}</span>
                  </div>
                  <div
                    className={`text-right font-bold ${
                      selectedStock.priceChangePct >= 0 ? "text-primary" : "text-secondary"
                    }`}
                  >
                    <span className="text-outline block text-caption-caps">Delta:</span>
                    <span>
                      {selectedStock.priceChangePct >= 0 ? "+" : ""}
                      ₹{(selectedStock.currentPrice - selectedStock.checkpointPrice).toFixed(2)} (
                      {selectedStock.priceChangePct >= 0 ? "+" : ""}
                      {selectedStock.priceChangePct.toFixed(2)}%)
                    </span>
                  </div>
                </div>
              </div>

              {/* Google/Yahoo Finance Style Interactive Chart */}
              <div>
                <span className="text-caption-caps font-caption-caps text-outline uppercase tracking-wider block mb-2 font-bold">
                  Price Trajectory &amp; Catalyst Timeline
                </span>
                <InteractivePriceChart
                  symbol={selectedStock.symbol}
                  currentPrice={selectedStock.currentPrice}
                  checkpointPrice={selectedStock.checkpointPrice}
                  checkpointTime={selectedStock.observedAt || data?.lastCheckedAt}
                  visits={selectedStock.visits}
                  events={matchedNews}
                  liveTicks={liveTicksBySymbol[selectedStock.symbol] || []}
                  height={230}
                />
              </div>

              {/* 4-Card Deterministic Fact Matrix */}
              <div>
                <span className="text-caption-caps font-caption-caps text-outline uppercase tracking-wider block mb-2 font-bold">
                  Deterministic Fact Matrix
                </span>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="p-3 bg-surface rounded-DEFAULT border border-outline-variant">
                    <span className="text-outline text-caption-caps font-caption-caps block">RELATIVE ALPHA</span>
                    <span
                      className={`font-label-numeric-lg text-label-numeric-lg font-bold ${
                        selectedStock.benchmarkAlphaPct !== null && selectedStock.benchmarkAlphaPct >= 0
                          ? "text-primary"
                          : "text-secondary"
                      }`}
                    >
                      {selectedStock.benchmarkAlphaPct !== null
                        ? `${selectedStock.benchmarkAlphaPct >= 0 ? "+" : ""}${selectedStock.benchmarkAlphaPct.toFixed(2)}%`
                        : "N/A"}
                    </span>
                    <span className="text-[11px] text-on-surface-variant block mt-0.5">vs NIFTY 50</span>
                  </div>
                  <div className="p-3 bg-surface rounded-DEFAULT border border-outline-variant">
                    <span className="text-outline text-caption-caps font-caption-caps block">VOLUME PACE</span>
                    <span className="text-primary font-label-numeric-lg text-label-numeric-lg font-bold">
                      {selectedStock.volumeRatio !== null ? `${selectedStock.volumeRatio.toFixed(1)}×` : "Baseline"}
                    </span>
                    <span className="text-[11px] text-on-surface-variant block mt-0.5">vs checkpoint volume</span>
                  </div>
                  <div className="p-3 bg-surface rounded-DEFAULT border border-outline-variant">
                    <span className="text-outline text-caption-caps font-caption-caps block">TIME AWAY</span>
                    <span className="text-on-surface font-label-numeric-lg text-label-numeric-lg font-bold">
                      {data?.timeAwayHuman ?? "N/A"}
                    </span>
                    <span className="text-[11px] text-on-surface-variant block mt-0.5">Since last checkpoint</span>
                  </div>
                  <div className="p-3 bg-surface rounded-DEFAULT border border-outline-variant">
                    <span className="text-outline text-caption-caps font-caption-caps block">NEW EVENTS</span>
                    <span className="text-primary font-label-numeric-lg text-label-numeric-lg font-bold">
                      {selectedStock.newEventCount} Events
                    </span>
                    <span className="text-[11px] text-on-surface-variant block mt-0.5">Detected catalysts</span>
                  </div>
                </div>
              </div>

              {/* Summary & Deterministic Rationale */}
              <div className="bg-surface p-4 rounded-DEFAULT border border-outline-variant space-y-2">
                <div className="flex items-center space-x-1.5 text-label-numeric-sm font-label-numeric-sm text-primary">
                  <span className="material-symbols-outlined text-[16px]">analytics</span>
                  <span className="font-bold uppercase tracking-wider">Summary &amp; Analysis</span>
                </div>
                <p className="text-body-md font-body-md text-on-surface leading-relaxed">
                  {selectedStock.summaryExplanation ||
                    `${selectedStock.symbol} has traded at ₹${selectedStock.currentPrice.toFixed(2)} with an Attention Score of ${selectedStock.attentionScore}/100.`}
                </p>
              </div>

              {/* Observable Reasons Sequence */}
              <div className="space-y-3">
                <span className="text-caption-caps font-caption-caps text-outline uppercase tracking-wider block font-bold">
                  Deterministic Factors &amp; Reasons
                </span>
                <div className="space-y-2">
                  {selectedStock.reasons.map((r, idx) => (
                    <div
                      key={idx}
                      className="p-3 bg-surface rounded-DEFAULT border border-outline-variant flex items-center justify-between"
                    >
                      <div>
                        <span className="text-caption-caps font-caption-caps text-outline block">
                          {r.category}
                        </span>
                        <span className="text-body-sm font-body-sm text-on-surface font-medium">
                          {r.label}
                        </span>
                      </div>
                      <span
                        className={`font-label-numeric-md font-bold ${
                          r.significance === "HIGH"
                            ? "text-secondary"
                            : r.significance === "MEDIUM"
                            ? "text-tertiary"
                            : "text-outline"
                        }`}
                      >
                        {r.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* AI-Enriched News Catalysts Section */}
              <div className="space-y-2.5">
                <div className="flex items-center space-x-1.5">
                  <span className="material-symbols-outlined text-primary text-[16px]">psychology</span>
                  <span className="text-caption-caps font-caption-caps text-outline uppercase tracking-wider font-bold">
                    AI-Enriched News Catalysts
                  </span>
                  {matchedNews.length > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full bg-primary/20 text-primary text-[10px] font-bold">
                      {matchedNews.length}
                    </span>
                  )}
                </div>

                {matchedNews.length === 0 ? (
                  <div className="p-3 bg-surface rounded-DEFAULT border border-outline-variant text-center">
                    <span className="text-outline text-body-sm">
                      No news catalysts detected for {selectedStockSymbol} since your last checkpoint. Market intelligence pipeline is active.
                    </span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {matchedNews[0]?.isFallback && (
                      <div className="px-2.5 py-1.5 rounded-DEFAULT bg-surface-container-high border border-outline-variant/60 text-[11px] text-outline flex items-center space-x-1.5">
                        <span className="material-symbols-outlined text-[14px] text-primary">info</span>
                        <span>Showing broader sector &amp; benchmark catalysts impacting {selectedStockSymbol}:</span>
                      </div>
                    )}
                    {matchedNews.map((ev: any) => {
                      const upper = (selectedStockSymbol || "").toUpperCase();
                      const isDirect = Array.isArray(ev.primarySymbols) && ev.primarySymbols.includes(upper);
                      const isRipple = Array.isArray(ev.rippleImpacts) && ev.rippleImpacts.some((r: any) => r.symbol === upper);

                      return (
                        <div
                          key={ev.id}
                          className="p-3 bg-surface rounded-DEFAULT border border-outline-variant space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center space-x-1.5 flex-wrap">
                              <span
                                className={`px-1.5 py-0.2 rounded-DEFAULT text-[10px] font-bold font-label-numeric-sm ${
                                  ev.sentimentScore > 0
                                    ? "bg-primary/20 text-primary"
                                    : ev.sentimentScore < 0
                                    ? "bg-secondary/20 text-secondary"
                                    : "bg-surface-variant text-outline"
                                }`}
                              >
                                {ev.sentimentScore > 0 ? "Bullish" : ev.sentimentScore < 0 ? "Bearish" : "Neutral"}
                              </span>
                              {isDirect && (
                                <span className="px-1.5 py-0.2 rounded-DEFAULT bg-primary/15 text-primary border border-primary/30 text-[9px] font-bold font-label-numeric-sm">
                                  🎯 Direct Catalyst
                                </span>
                              )}
                              {isRipple && !isDirect && (
                                <span className="px-1.5 py-0.2 rounded-DEFAULT bg-surface-variant text-on-surface text-[9px] font-bold font-label-numeric-sm">
                                  ⚡ Sector Ripple
                                </span>
                              )}
                              <span className="text-[10px] font-label-numeric-sm text-outline uppercase tracking-wider">
                                {ev.source?.replace("_", " ")}
                              </span>
                            </div>
                            <span className="text-[10px] font-label-numeric-sm text-outline">
                              {new Date(ev.occurredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          <a
                            href={ev.url ?? "#"}
                            target="_blank"
                            rel="noreferrer"
                            className="text-body-sm font-semibold text-on-surface hover:text-primary transition-colors block line-clamp-2"
                          >
                            {ev.title}
                          </a>

                          {/* AI Share Price Impact Mechanism */}
                          {ev.priceImpactExplanation && (
                            <div className="p-2.5 rounded-DEFAULT bg-surface-container/70 border border-outline-variant/70 space-y-1">
                              <div className="flex items-center space-x-1.5 text-primary">
                                <span className="material-symbols-outlined text-[15px]">psychology</span>
                                <span className="text-[10px] font-bold uppercase tracking-wider font-label-numeric-sm">
                                  How this affects share price
                                </span>
                              </div>
                              <p className="text-[12px] font-body-sm text-on-surface leading-relaxed">
                                {ev.priceImpactExplanation}
                              </p>
                            </div>
                          )}

                          {ev.rippleImpacts?.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pt-1 border-t border-outline-variant/40">
                              <span className="text-[10px] text-outline font-label-numeric-sm">Second-order:</span>
                              {ev.rippleImpacts.slice(0, 3).map((r: any) => (
                                <span
                                  key={r.symbol}
                                  className="px-1.5 py-0.2 rounded-DEFAULT bg-surface-variant text-on-surface text-[10px] font-label-numeric-sm"
                                >
                                  ⚡ {r.symbol} ({r.impactDirection === "POSITIVE" ? "▲" : "▼"})
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Drawer Footer Actions */}
            <div className="p-4 border-t border-outline-variant bg-surface flex items-center justify-between gap-3">
              <button
                className="px-3 py-2 rounded-DEFAULT bg-surface-variant hover:bg-surface-container-high border border-outline-variant text-on-surface text-body-sm font-body-sm"
                onClick={closeDrawer}
              >
                Close Panel
              </button>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  disabled={actionPending}
                  className="px-3.5 py-2 rounded-DEFAULT bg-primary text-background text-body-sm font-body-sm font-semibold transition-transform active:scale-95 disabled:opacity-50 flex items-center space-x-1.5 shadow-sm"
                  onClick={() => handleMarkSingleStockChecked(selectedStock.symbol)}
                >
                  <span className="material-symbols-outlined text-[16px]">check_circle</span>
                  <span>Mark {selectedStock.symbol} Checked</span>
                </button>
                <button
                  disabled={actionPending}
                  className="px-3.5 py-2 rounded-DEFAULT bg-surface-variant hover:bg-surface-container-high border border-outline-variant text-on-surface text-body-sm font-body-sm font-semibold transition-colors disabled:opacity-50"
                  onClick={handleMarkAllAsChecked}
                >
                  Mark All Watchlist Checked
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {/* Floating Keyboard Shortcuts Helper */}
      <div className="fixed bottom-4 right-4 hidden lg:flex items-center space-x-3 px-3 py-1.5 rounded-DEFAULT bg-surface border border-outline-variant text-outline font-label-numeric-sm text-label-numeric-sm shadow-lg z-20">
        <span
          className="flex items-center space-x-1 cursor-pointer hover:text-on-surface"
          onClick={handleMarkAllAsChecked}
        >
          <kbd className="px-1 bg-surface-container-high text-on-surface rounded">C</kbd>
          <span>Mark Checkpoint</span>
        </span>
        <span>•</span>
        <span
          className="flex items-center space-x-1 cursor-pointer hover:text-on-surface"
          onClick={closeDrawer}
        >
          <kbd className="px-1 bg-surface-container-high text-on-surface rounded">ESC</kbd>
          <span>Close Drawer</span>
        </span>
      </div>

      {/* Floating Attention Escalation Alerts */}
      <aside
        aria-label="Category A Escalation Alerts"
        className="fixed bottom-16 right-4 z-50 flex flex-col space-y-2 max-w-sm pointer-events-none"
      >
        {alertToasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto bg-surface-container border-2 border-secondary/80 rounded-DEFAULT p-3.5 shadow-2xl flex items-start space-x-3 text-on-surface"
          >
            <div className="w-7 h-7 rounded-DEFAULT bg-secondary/20 text-secondary flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="material-symbols-outlined text-[18px]">warning</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-secondary text-label-numeric-sm">
                  {toast.title}
                </h4>
                <button
                  type="button"
                  onClick={() => setAlertToasts((prev) => prev.filter((t) => t.id !== toast.id))}
                  className="text-outline hover:text-on-surface ml-2"
                >
                  ✕
                </button>
              </div>
              <p className="text-body-sm text-on-surface-variant mt-0.5 line-clamp-2">
                {toast.message}
              </p>
              <div className="mt-2 flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => {
                    openDrawer(toast.symbol);
                    setAlertToasts((prev) => prev.filter((t) => t.id !== toast.id));
                  }}
                  className="px-2 py-0.5 rounded-DEFAULT bg-primary/20 hover:bg-primary/30 text-primary text-[11px] font-semibold transition-colors"
                >
                  Inspect {toast.symbol} →
                </button>
              </div>
            </div>
          </div>
        ))}
      </aside>
    </div>
  );
}
