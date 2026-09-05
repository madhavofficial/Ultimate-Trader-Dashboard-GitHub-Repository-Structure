"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  WatchlistSummaryResponse,
  WatchlistChangeItem,
  MarketFreshnessState,
} from "../../types/watchlistContract";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type AppMode = "REAL" | "DEMO";

export default function SmartMarketWatchPage() {
  const [mode, setMode] = useState<AppMode>("REAL");
  const [data, setData] = useState<WatchlistSummaryResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStockSymbol, setSelectedStockSymbol] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isDemoModalOpen, setIsDemoModalOpen] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState<string>("baseline");

  // Helper to fetch authorization header if user is logged in
  const getAuthHeaders = (): HeadersInit => {
    if (typeof window === "undefined") return {};
    const token = localStorage.getItem("accessToken");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  // 1. DEMO MODE: Load deterministic evaluator scenario from backend (unauthenticated endpoint)
  const fetchDemoScenario = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/watchlist/demo-scenario`, {
        method: "POST",
      });
      if (!res.ok) {
        throw new Error(`Failed to load demo scenario (${res.status})`);
      }
      const json: WatchlistSummaryResponse = await res.json();
      setData(json);
      setMode("DEMO");
      setIsDemoModalOpen(false);
    } catch (err: any) {
      setError(err.message || "Failed to trigger evaluator demo scenario");
    } finally {
      setLoading(false);
    }
  }, []);

  // 2. REAL MODE: Load live watchlist summary from backend (requires authenticated user)
  const fetchRealSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = getAuthHeaders();
      const res = await fetch(`${API_URL}/watchlist/summary`, {
        headers,
      });
      if (res.status === 401) {
        // Not authenticated: notify and switch to Demo Mode
        setError("Unauthenticated: Please log in to view personal watchlists. Switched to Evaluator Demo Mode.");
        await fetchDemoScenario();
        return;
      }
      if (!res.ok) {
        throw new Error(`Failed to load watchlist summary (${res.status})`);
      }
      const json: WatchlistSummaryResponse = await res.json();
      setData(json);
      setMode("REAL");
    } catch (err: any) {
      setError(err.message || "Failed to connect to backend market service");
    } finally {
      setLoading(false);
    }
  }, [fetchDemoScenario]);

  // 3. SCENARIO CONTROLLER: Trigger live scenario or parameterized fixture
  const handleSelectScenario = useCallback(
    async (scenarioName: string) => {
      setSelectedScenario(scenarioName);
      setLoading(true);
      setError(null);
      try {
        await fetch(`${API_URL}/watchlist/scenario/${scenarioName}`, {
          method: "POST",
        });

        const token = typeof window !== "undefined" ? localStorage.getItem("accessToken") : null;
        if (mode === "REAL" && token) {
          await fetchRealSummary();
        } else {
          const res = await fetch(`${API_URL}/watchlist/demo-scenario?scenario=${scenarioName}`, {
            method: "POST",
          });
          if (res.ok) {
            const json: WatchlistSummaryResponse = await res.json();
            setData(json);
            setMode("DEMO");
          }
        }
      } catch (err: any) {
        setError(err.message || "Failed to apply scenario");
      } finally {
        setLoading(false);
      }
    },
    [mode, fetchRealSummary]
  );

  // 4. CHECKPOINT: Acknowledge current spot prices and reset baseline
  const handleMarkAllAsChecked = useCallback(async () => {
    if (mode === "DEMO") {
      // In DEMO mode, simulate in-memory caught up state without touching production DB
      if (!data) return;
      const all = [
        ...data.groups.needsAttention,
        ...data.groups.worthALook,
        ...data.groups.unchanged,
      ].map((s) => ({
        ...s,
        priceChangePct: 0,
        attentionScore: 0,
        significance: "UNCHANGED" as const,
        reasons: [],
        summaryExplanation: "Baseline checkpoint established.",
      }));

      setData({
        ...data,
        lastCheckedAt: new Date().toISOString(),
        timeAwayHuman: "Just now",
        counts: {
          total: all.length,
          needsAttention: 0,
          worthALook: 0,
          unchanged: all.length,
        },
        groups: {
          needsAttention: [],
          worthALook: [],
          unchanged: all,
        },
      });
      setIsDrawerOpen(false);
      return;
    }

    // In REAL mode, call authenticated POST /watchlist/checkpoint
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
          throw new Error("Please log in to save a personal baseline checkpoint.");
        }
        throw new Error(`Failed to record checkpoint (${res.status})`);
      }
      setIsDrawerOpen(false);
      // Immediately refresh the real summary to observe zero delta "caught up" state
      await fetchRealSummary();
    } catch (err: any) {
      alert(`Error setting checkpoint: ${err.message}`);
    } finally {
      setActionPending(false);
    }
  }, [mode, data, fetchRealSummary]);

  // Initial mount: load real summary if token present, otherwise default to demo mode
  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("accessToken") : null;
    if (token) {
      fetchRealSummary();
    } else {
      fetchDemoScenario();
    }
  }, [fetchRealSummary, fetchDemoScenario]);

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
        setIsDemoModalOpen(false);
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

  return (
    <div className="bg-background text-on-surface antialiased min-h-screen selection:bg-primary-container selection:text-on-primary-container">
      {/* ========================================================================= */}
      {/* MODE INDICATOR / OPERATIONAL CONTROL BAR                                   */}
      {/* ========================================================================= */}
      <div className="w-full bg-surface-container-lowest border-b border-outline-variant px-gutter-desktop py-1.5 flex items-center justify-between text-caption-caps font-caption-caps text-outline">
        <div className="flex items-center space-x-3 flex-wrap gap-y-1">
          <div className="flex items-center space-x-1.5">
            <span className="font-bold text-on-surface">MODE:</span>
            <button
              onClick={fetchRealSummary}
              className={`px-2 py-0.5 rounded-DEFAULT font-label-numeric-sm text-[11px] transition-all ${
                mode === "REAL"
                  ? "bg-surface-variant text-primary border border-outline-variant font-bold"
                  : "bg-surface-container hover:bg-surface-variant text-on-surface-variant border border-transparent hover:border-outline-variant"
              }`}
            >
              ● Real
            </button>
            <button
              onClick={() => handleSelectScenario("big_move")}
              className={`px-2 py-0.5 rounded-DEFAULT font-label-numeric-sm text-[11px] transition-all ${
                mode === "DEMO"
                  ? "bg-surface-variant text-primary border border-outline-variant font-bold"
                  : "bg-surface-container hover:bg-surface-variant text-on-surface-variant border border-transparent hover:border-outline-variant"
              }`}
            >
              ⚡ Demo
            </button>
          </div>

          <div className="flex items-center space-x-1 pl-3 border-l border-outline-variant">
            <span className="font-bold text-on-surface">SCENARIO:</span>
            {[
              { id: "baseline", label: "Baseline" },
              { id: "big_move", label: "Big Move" },
              { id: "volume_spike", label: "Volume Spike" },
              { id: "stale", label: "Stale Feed" },
              { id: "market_closed", label: "Market Closed" },
              { id: "unchanged", label: "Unchanged" },
            ].map((sc) => (
              <button
                key={sc.id}
                onClick={() => handleSelectScenario(sc.id)}
                className={`px-2 py-0.5 rounded text-[10px] font-medium tracking-normal transition-all ${
                  selectedScenario === sc.id
                    ? "bg-primary text-on-primary font-bold shadow-sm"
                    : "bg-surface-container hover:bg-surface-variant text-on-surface-variant border border-outline-variant/30"
                }`}
              >
                {sc.label}
              </button>
            ))}
          </div>
        </div>
        <div className="hidden md:flex items-center space-x-3 text-label-numeric-sm">
          {mode === "DEMO" && (
            <span className="text-tertiary font-bold">
              [EVALUATOR SCENARIO ACTIVE — DETERMINISTIC T0 → T1 DELTAS]
            </span>
          )}
          <span>
            Press <kbd className="px-1 bg-surface-container-high text-on-surface rounded">C</kbd> to checkpoint
          </span>
          <span>•</span>
          <span>
            Press <kbd className="px-1 bg-surface-container-high text-on-surface rounded">ESC</kbd> to close drawer
          </span>
        </div>
      </div>

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
            onClick={fetchRealSummary}
          >
            What Changed
          </a>
          <button
            className="text-on-surface-variant hover:text-on-surface font-medium pb-3 transition-colors duration-150 text-body-md font-body-md"
            onClick={() => alert(`Status Note: ${data?.marketFreshness.note || "All systems nominal."}`)}
          >
            Feed Status
          </button>
        </nav>

        {/* Right Cluster: Live Feed Pill + Actions */}
        <div className="flex items-center space-x-3">
          {/* Live Market Pill */}
          <div
            className="hidden xl:flex items-center space-x-2 bg-surface-container-lowest px-2.5 py-1 rounded-DEFAULT border border-outline-variant font-label-numeric-sm text-label-numeric-sm"
            title={data?.marketFreshness.note || "Direct market stream"}
          >
            <span className={`w-2 h-2 rounded-full ${freshnessInfo.dotClass}`}></span>
            <span className="text-on-surface-variant">{freshnessInfo.text}</span>
            <span className="text-outline">|</span>
            <span className="text-on-surface font-semibold">NIFTY 50:</span>
            <span className="text-primary font-semibold">Benchmark Tracked</span>
          </div>

          {/* Secondary Action: Demo Scenario Trigger */}
          <button
            className="hidden sm:inline-flex items-center space-x-1.5 px-2.5 py-1 text-label-numeric-sm font-label-numeric-sm border border-outline-variant/60 rounded-DEFAULT bg-surface-container/60 hover:bg-surface-container text-outline hover:text-on-surface transition-colors duration-150 active:scale-95"
            onClick={() => setIsDemoModalOpen(true)}
            title="Evaluator demo scenario preview"
          >
            <span className="material-symbols-outlined text-[14px]">science</span>
            <span>Demo Scenario</span>
          </button>

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
            onClick={mode === "REAL" ? fetchRealSummary : fetchDemoScenario}
            title="Refresh Data"
          >
            <span className={`material-symbols-outlined ${loading ? "animate-spin" : ""}`}>
              refresh
            </span>
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
              onClick={fetchRealSummary}
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

                {/* Right: Checkpoint Action Button */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-shrink-0">
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
                  <div className="flex items-center space-x-2 bg-surface-container px-3 py-1.5 rounded-DEFAULT border border-secondary-container/40">
                    <span className="w-2 h-2 rounded-full bg-secondary"></span>
                    <span className="font-label-numeric-md text-label-numeric-md text-secondary font-bold">
                      {data.counts.needsAttention} NEEDS ATTENTION
                    </span>
                    <span className="text-outline text-label-numeric-sm">(Score &gt; 60 or |Δ| &ge; 2.5%)</span>
                  </div>
                  <div className="flex items-center space-x-2 bg-surface-container px-3 py-1.5 rounded-DEFAULT border border-tertiary-container/40">
                    <span className="w-2 h-2 rounded-full bg-tertiary"></span>
                    <span className="font-label-numeric-md text-label-numeric-md text-tertiary font-bold">
                      {data.counts.worthALook} WORTH A LOOK
                    </span>
                    <span className="text-outline text-label-numeric-sm">(Score 30–59 or |Δ| &ge; 1.0%)</span>
                  </div>
                  <div className="flex items-center space-x-2 bg-surface-container px-3 py-1.5 rounded-DEFAULT border border-outline-variant">
                    <span className="w-2 h-2 rounded-full bg-outline"></span>
                    <span className="font-label-numeric-md text-label-numeric-md text-on-surface-variant font-medium">
                      {data.counts.unchanged} UNCHANGED / NO MOVE
                    </span>
                    <span className="text-outline text-label-numeric-sm">(Filtered noise &lt; ±1.0%)</span>
                  </div>
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
                    <button
                      className="px-4 py-2 rounded-DEFAULT bg-surface-variant hover:bg-surface-container-high border border-outline-variant text-on-surface text-label-numeric-sm font-label-numeric-sm"
                      onClick={fetchDemoScenario}
                    >
                      Run Evaluator Demo Scenario →
                    </button>
                  </div>
                </div>
              )}

            {/* ACTIVE RANKED FEED (When deltas exist) */}
            {!data.isFirstVisit &&
              (data.counts.needsAttention > 0 || data.counts.worthALook > 0) && (
                <div className="space-y-8">
                  {/* CATEGORY A: NEEDS ATTENTION */}
                  {data.groups.needsAttention.length > 0 && (
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
                          return (
                            <article
                              key={stock.symbol}
                              className="bg-surface-container border border-outline-variant hover:border-primary/50 hover:bg-surface-container-high rounded-DEFAULT p-4 transition-all duration-150 cursor-pointer relative group"
                              onClick={() => openDrawer(stock.symbol)}
                            >
                              <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                                <div className="space-y-2">
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
                                  <div className="flex items-baseline space-x-3">
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
                                  <button className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-DEFAULT bg-surface-variant group-hover:bg-primary group-hover:text-background text-on-surface text-body-sm font-body-sm transition-all border border-outline-variant font-medium">
                                    <span>Inspect Factors</span>
                                    <span className="material-symbols-outlined text-[16px] group-hover:translate-x-0.5 transition-transform">
                                      arrow_forward
                                    </span>
                                  </button>
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {/* CATEGORY B: WORTH A LOOK */}
                  {data.groups.worthALook.length > 0 && (
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
                          return (
                            <div
                              key={stock.symbol}
                              className="bg-surface-container border border-outline-variant hover:border-outline rounded-DEFAULT p-4 transition-colors cursor-pointer"
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
                              <p className="mt-2 text-body-sm font-body-sm text-on-surface-variant">
                                {stock.summaryExplanation || stock.reasons[0]?.value || "Observed price divergence from baseline."}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {/* CATEGORY C: UNCHANGED & NOISE FILTERED */}
                  {data.groups.unchanged.length > 0 && (
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
                          return (
                            <div
                              key={stock.symbol}
                              className="bg-surface p-2.5 rounded-DEFAULT border border-outline-variant flex flex-col cursor-pointer hover:border-outline"
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
              <button
                className="w-8 h-8 rounded-DEFAULT bg-surface-variant hover:bg-surface-container-highest text-on-surface-variant flex items-center justify-center transition-colors"
                onClick={closeDrawer}
              >
                <span className="material-symbols-outlined">close</span>
              </button>
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
            </div>

            {/* Drawer Footer Actions */}
            <div className="p-4 border-t border-outline-variant bg-surface flex items-center justify-between gap-3">
              <button
                className="px-3 py-2 rounded-DEFAULT bg-surface-variant hover:bg-surface-container-high border border-outline-variant text-on-surface text-body-sm font-body-sm"
                onClick={closeDrawer}
              >
                Close Panel
              </button>
              <button
                disabled={actionPending}
                className="px-4 py-2 rounded-DEFAULT bg-primary-container hover:bg-primary text-on-primary-container text-body-sm font-body-sm font-semibold transition-colors disabled:opacity-50"
                onClick={handleMarkAllAsChecked}
              >
                Mark All Watchlist Checked
              </button>
            </div>
          </>
        )}
      </section>

      {/* ========================================================================= */}
      {/* DEMO SCENARIO EVALUATOR MODAL                                             */}
      {/* ========================================================================= */}
      {isDemoModalOpen && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface-container border border-outline-variant rounded-DEFAULT max-w-xl w-full p-6 space-y-5 shadow-2xl relative">
            <div className="flex items-center justify-between border-b border-outline-variant pb-3">
              <div className="flex items-center space-x-2">
                <span className="material-symbols-outlined text-primary">science</span>
                <h3 className="text-headline-sm font-headline-sm text-on-surface font-bold">
                  Demo Scenario (Evaluator Preview)
                </h3>
              </div>
              <button
                className="text-outline hover:text-on-surface"
                onClick={() => setIsDemoModalOpen(false)}
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <p className="text-body-md font-body-md text-on-surface-variant">
              Test how Smart Market Watch preserves attention: Set a baseline checkpoint at 09:30 AM, step away, and return at 01:45 PM. Only meaningful price moves, volume anomalies, and catalysts are highlighted.
            </p>
            <div className="space-y-3 bg-surface p-4 rounded-DEFAULT border border-outline-variant">
              <div className="flex items-center justify-between text-label-numeric-sm font-label-numeric-sm">
                <span className="text-primary font-bold">Baseline Checkpoint (09:30 AM)</span>
                <span className="text-outline">Baseline Established</span>
              </div>
              <div className="w-full bg-surface-container-high h-1.5 rounded-full overflow-hidden">
                <div className="bg-primary h-full w-full"></div>
              </div>
              <div className="flex items-center justify-between text-body-sm font-body-sm text-outline">
                <span>Normal Market Noise Filtered</span>
                <span className="text-secondary font-semibold">Meaningful Moves Surfaced at T+2h</span>
              </div>
            </div>
            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                className="px-3 py-1.5 rounded-DEFAULT bg-surface-variant text-on-surface text-body-sm font-body-sm"
                onClick={() => setIsDemoModalOpen(false)}
              >
                Close
              </button>
              <button
                className="px-4 py-1.5 rounded-DEFAULT bg-primary text-on-primary text-body-sm font-body-sm font-semibold hover:bg-primary-fixed transition-all"
                onClick={fetchDemoScenario}
              >
                Simulate Scenario →
              </button>
            </div>
          </div>
        </div>
      )}

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
        <span>•</span>
        <span
          className="flex items-center space-x-1 cursor-pointer hover:text-on-surface"
          onClick={() => setIsDemoModalOpen(true)}
        >
          <kbd className="px-1 bg-surface-container-high text-on-surface rounded">Demo</kbd>
          <span>Evaluator Scenario</span>
        </span>
      </div>
    </div>
  );
}
