"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";

type AppState = "live" | "drawer" | "caughtup" | "newuser" | "stale";

type SelectedStock = {
  symbol: string;
  name: string;
  score: number;
  sector: string;
  badge: string;
  badgeColor: "primary" | "secondary" | "tertiary";
  currentPrice: number;
  checkpointPrice: number;
  deltaPct: number;
  deltaAmount: number;
  checkpointTime: string;
  alpha: number;
  volumeRatio: number;
  timeElapsed: string;
  catalystsCount: number;
  analystSynthesis: string;
  timeline: Array<{
    time: string;
    text: string;
    isHighlight?: boolean;
  }>;
};

const SAMPLE_STOCKS: Record<string, SelectedStock> = {
  reliance: {
    symbol: "RELIANCE",
    name: "Reliance Industries Ltd.",
    score: 86,
    sector: "Refined Petroleum & Telecommunications",
    badge: "Unusual Move & Vol Spike",
    badgeColor: "primary",
    currentPrice: 1468.20,
    checkpointPrice: 1404.95,
    deltaPct: 4.50,
    deltaAmount: 63.25,
    checkpointTime: "11:42 AM",
    alpha: 3.10,
    volumeRatio: 2.7,
    timeElapsed: "2h 17m",
    catalystsCount: 2,
    analystSynthesis:
      "RELIANCE moved substantially higher than its previous checkpoint at 11:42 AM, registering a +4.50% price divergence accompanied by 2.7× standard volume velocity. The move represents +3.10% relative alpha over NIFTY 50 during the identical time window.",
    timeline: [
      { time: "11:42 AM", text: "Checkpoint established at ₹1,404.95 baseline." },
      { time: "12:15 PM", text: "Abnormal order flow detected: 4 blocks totaling 850k shares.", isHighlight: true },
      { time: "12:58 PM", text: "Regulatory Disclosure: Jio Telecom revised enterprise tariff brackets.", isHighlight: true },
      { time: "01:30 PM", text: "+4.0% price threshold breached, Attention Score calculated at 86.", isHighlight: true },
    ],
  },
  tatamotors: {
    symbol: "TATAMOTORS",
    name: "Tata Motors Passenger Vehicles",
    score: 81,
    sector: "Automotive & Commercial Vehicles",
    badge: "Abrupt Gap Down",
    badgeColor: "secondary",
    currentPrice: 982.50,
    checkpointPrice: 1021.30,
    deltaPct: -3.80,
    deltaAmount: -38.80,
    checkpointTime: "11:42 AM",
    alpha: -4.20,
    volumeRatio: 3.1,
    timeElapsed: "2h 17m",
    catalystsCount: 1,
    analystSynthesis:
      "TATAMOTORS gapped down sharply relative to its previous checkpoint at 11:42 AM, registering a -3.80% price drawdown under heavy volume velocity (3.1× baseline). It lagged the NIFTY Auto index by -4.20% amidst UK supply chain disclosures.",
    timeline: [
      { time: "11:42 AM", text: "Checkpoint established at ₹1,021.30 baseline." },
      { time: "12:10 PM", text: "Heavy institutional sell block recorded (1.2M shares).", isHighlight: true },
      { time: "12:45 PM", text: "Catalyst: Jaguar Land Rover reported temporary EU delivery bottlenecks.", isHighlight: true },
      { time: "01:15 PM", text: "-3.5% breach reached; Attention Score flagged at 81.", isHighlight: true },
    ],
  },
  zomato: {
    symbol: "ZOMATO",
    name: "Zomato Ltd.",
    score: 78,
    sector: "Consumer Internet & Quick Commerce",
    badge: "Blinkit Expansion Momentum",
    badgeColor: "primary",
    currentPrice: 248.80,
    checkpointPrice: 234.30,
    deltaPct: 6.20,
    deltaAmount: 14.50,
    checkpointTime: "11:42 AM",
    alpha: 5.80,
    volumeRatio: 2.4,
    timeElapsed: "2h 17m",
    catalystsCount: 1,
    analystSynthesis:
      "ZOMATO experienced sustained buy-side block accumulation breaking its all-time high resistance, accompanied by 2.4× baseline trading turnover and broker upgrades on Dark Store expansions.",
    timeline: [
      { time: "11:42 AM", text: "Checkpoint established at ₹234.30 baseline." },
      { time: "12:05 PM", text: "Buy-side accumulation sweeps resistance at ₹240.", isHighlight: true },
      { time: "12:40 PM", text: "Institutional broker revised Dark Store target count to 1,200.", isHighlight: true },
      { time: "01:25 PM", text: "All-time high established at ₹248.80; Attention Score 78.", isHighlight: true },
    ],
  },
};

export default function SmartMarketWatchPage() {
  const [appState, setAppState] = useState<AppState>("live");
  const [selectedStockKey, setSelectedStockKey] = useState<string>("reliance");
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isTimeTravelOpen, setIsTimeTravelOpen] = useState(false);
  const [lastCheckedText, setLastCheckedText] = useState("2 hours, 17 mins ago");
  const [lastCheckedSubtext, setLastCheckedSubtext] = useState("(11:42 AM IST)");

  const selectedStock = SAMPLE_STOCKS[selectedStockKey] || SAMPLE_STOCKS.reliance;

  const handleMarkAllAsChecked = useCallback(() => {
    const now = new Date();
    const timeString = now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    setLastCheckedText("Just now");
    setLastCheckedSubtext(`(Today, ${timeString} IST)`);
    setIsDrawerOpen(false);
    setAppState("caughtup");
  }, []);

  const openDrawer = (stockKey: string) => {
    setSelectedStockKey(stockKey);
    setIsDrawerOpen(true);
  };

  const closeDrawer = () => {
    setIsDrawerOpen(false);
  };

  // Global keybindings (matching Stitch design prototype)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;

      if (e.key === "Escape") {
        setIsDrawerOpen(false);
        setIsTimeTravelOpen(false);
      } else if (e.key === "c" || e.key === "C") {
        handleMarkAllAsChecked();
      } else if (["1", "2", "3", "4", "5"].includes(e.key)) {
        const stateMap: Record<string, AppState> = {
          "1": "live",
          "2": "drawer",
          "3": "caughtup",
          "4": "newuser",
          "5": "stale",
        };
        const nextState = stateMap[e.key];
        if (nextState === "drawer") {
          setAppState("live");
          setIsDrawerOpen(true);
        } else {
          setIsDrawerOpen(false);
          setAppState(nextState);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleMarkAllAsChecked]);

  return (
    <div className="bg-background text-on-surface antialiased min-h-screen selection:bg-primary-container selection:text-on-primary-container">
      {/* ========================================================================= */}
      {/* TOP STATE CONTROLLER / DEMO SWITCHER BAR (Interactive State Navigation)    */}
      {/* ========================================================================= */}
      <div className="w-full bg-surface-container-lowest border-b border-outline-variant px-gutter-desktop py-1.5 flex items-center justify-between text-caption-caps font-caption-caps text-outline">
        <div className="flex items-center space-x-2">
          <span className="font-bold text-on-surface">PROTOTYPE STATE:</span>
          <button
            id="btn-state-live"
            onClick={() => {
              setAppState("live");
              setIsDrawerOpen(false);
            }}
            className={`px-2 py-1 rounded-DEFAULT font-label-numeric-sm text-label-numeric-sm transition-all ${
              appState === "live" && !isDrawerOpen
                ? "bg-surface-variant text-primary border border-outline-variant"
                : "bg-surface-container hover:bg-surface-variant text-on-surface-variant border border-transparent hover:border-outline-variant"
            }`}
          >
            [1] Live Deltas
          </button>
          <button
            id="btn-state-drawer"
            onClick={() => {
              setAppState("live");
              openDrawer("reliance");
            }}
            className={`px-2 py-1 rounded-DEFAULT font-label-numeric-sm text-label-numeric-sm transition-all ${
              isDrawerOpen
                ? "bg-surface-variant text-primary border border-outline-variant"
                : "bg-surface-container hover:bg-surface-variant text-on-surface-variant border border-transparent hover:border-outline-variant"
            }`}
          >
            [2] Detail Drawer
          </button>
          <button
            id="btn-state-caughtup"
            onClick={() => {
              setAppState("caughtup");
              setIsDrawerOpen(false);
            }}
            className={`px-2 py-1 rounded-DEFAULT font-label-numeric-sm text-label-numeric-sm transition-all ${
              appState === "caughtup"
                ? "bg-surface-variant text-primary border border-outline-variant"
                : "bg-surface-container hover:bg-surface-variant text-on-surface-variant border border-transparent hover:border-outline-variant"
            }`}
          >
            [3] All Caught Up
          </button>
          <button
            id="btn-state-newuser"
            onClick={() => {
              setAppState("newuser");
              setIsDrawerOpen(false);
            }}
            className={`px-2 py-1 rounded-DEFAULT font-label-numeric-sm text-label-numeric-sm transition-all ${
              appState === "newuser"
                ? "bg-surface-variant text-primary border border-outline-variant"
                : "bg-surface-container hover:bg-surface-variant text-on-surface-variant border border-transparent hover:border-outline-variant"
            }`}
          >
            [4] First Visit
          </button>
          <button
            id="btn-state-stale"
            onClick={() => {
              setAppState("stale");
              setIsDrawerOpen(false);
            }}
            className={`px-2 py-1 rounded-DEFAULT font-label-numeric-sm text-label-numeric-sm transition-all ${
              appState === "stale"
                ? "bg-surface-variant text-primary border border-outline-variant"
                : "bg-surface-container hover:bg-surface-variant text-on-surface-variant border border-transparent hover:border-outline-variant"
            }`}
          >
            [5] Market Closed
          </button>
        </div>
        <div className="hidden md:flex items-center space-x-3 text-label-numeric-sm">
          <span>
            Press <kbd className="px-1 bg-surface-container-high text-on-surface rounded">1-5</kbd> to jump states
          </span>
          <span>•</span>
          <span>
            Press <kbd className="px-1 bg-surface-container-high text-on-surface rounded">C</kbd> to checkpoint
          </span>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* SHARED COMPONENT: TopNavBar                                               */}
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
          {/* Segment Selector / Watchlist Badge */}
          <div className="hidden lg:flex items-center space-x-2 pl-4 border-l border-outline-variant text-body-sm font-body-sm">
            <span className="px-2 py-0.5 rounded-DEFAULT bg-surface-container-high text-on-surface border border-outline-variant text-label-numeric-sm font-label-numeric-sm">
              NSE: Watchlist 1 (Core Tech &amp; Bluechips)
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
            onClick={() => setAppState("live")}
          >
            What Changed
          </a>
          <a
            className="text-on-surface-variant hover:text-on-surface font-medium pb-3 transition-colors duration-150 text-body-md font-body-md cursor-pointer"
            onClick={() => alert("Alerts Log: 3 high-divergence triggers logged today.")}
          >
            Alerts Log
          </a>
        </nav>

        {/* Right Cluster: Live Ticker Heartbeat + Actions */}
        <div className="flex items-center space-x-3">
          {/* Live Market Pill with tooltip */}
          <div
            className="hidden xl:flex items-center space-x-2 bg-surface-container-lowest px-2.5 py-1 rounded-DEFAULT border border-outline-variant font-label-numeric-sm text-label-numeric-sm"
            title="Real-time Multicast Feeds direct from NSE Colo"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                appState === "stale" ? "bg-tertiary" : "bg-primary animate-pulse"
              }`}
            ></span>
            <span className="text-on-surface-variant">
              {appState === "stale" ? "Market Closed (Settled)" : "Live · 4s ago"}
            </span>
            <span className="text-outline">|</span>
            <span className="text-on-surface font-semibold">NIFTY 50:</span>
            <span className="text-secondary font-semibold">24,842.10 (-0.14%)</span>
          </div>

          {/* Trailing Secondary Action (Demo Mode) */}
          <button
            className="hidden sm:inline-flex items-center space-x-1.5 px-2.5 py-1 text-label-numeric-sm font-label-numeric-sm border border-outline-variant rounded-DEFAULT bg-surface-container hover:bg-surface-container-high text-on-surface-variant transition-colors duration-150 active:scale-95"
            onClick={() => setIsTimeTravelOpen(true)}
            title="Simulate different portfolio states"
          >
            <span className="material-symbols-outlined text-[15px]">tune</span>
            <span>Simulate</span>
          </button>

          {/* Trailing Primary Action (Mark Checkpoint) */}
          <button
            className="inline-flex items-center space-x-1.5 px-3 py-1 bg-surface-variant border border-outline-variant hover:border-primary text-on-surface hover:text-primary rounded-DEFAULT text-label-numeric-sm font-label-numeric-sm font-medium transition-all duration-150 active:scale-95 shadow-sm"
            onClick={handleMarkAllAsChecked}
          >
            <span className="material-symbols-outlined text-primary text-[15px]">done_all</span>
            <span>Mark Checkpoint</span>
          </button>

          {/* Trailing Icon Actions */}
          <div className="flex items-center space-x-1 border-l border-outline-variant pl-2">
            <button
              className="w-8 h-8 rounded-DEFAULT flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors duration-150"
              onClick={() => setIsTimeTravelOpen(true)}
              title="Time History"
            >
              <span className="material-symbols-outlined">history</span>
            </button>
            <button
              className="w-8 h-8 rounded-DEFAULT flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors duration-150 relative"
              title="Notifications"
            >
              <span className="material-symbols-outlined">notifications</span>
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-secondary-container"></span>
            </button>
            <button
              className="w-8 h-8 rounded-DEFAULT flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors duration-150"
              title="Terminal Settings"
            >
              <span className="material-symbols-outlined">tune</span>
            </button>
          </div>

          {/* Analyst Profile */}
          <div
            className="w-7 h-7 rounded-DEFAULT bg-surface-container-high border border-outline-variant flex items-center justify-center ml-1 text-on-surface font-label-numeric-sm text-label-numeric-sm font-bold"
            title="Analyst profile avatar"
          >
            RK
          </div>
        </div>
      </header>

      {/* ========================================================================= */}
      {/* STALE DATA / MARKET CLOSED BANNER (Conditional for State 5)              */}
      {/* ========================================================================= */}
      {appState === "stale" && (
        <div className="w-full bg-surface-container-low border-b border-outline-variant px-gutter-desktop py-2.5 transition-all">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
            <div className="flex items-center space-x-2.5">
              <span className="material-symbols-outlined text-tertiary">warning</span>
              <div>
                <span className="font-headline-sm text-headline-sm text-on-surface">
                  Market Closed: Friday Closing Settlement Active
                </span>
                <span className="text-body-sm font-body-sm text-on-surface-variant ml-2">
                  Displaying closing snapshot from 15:30 IST. Live exchange multicast sockets are paused until Monday 09:00 IST.
                </span>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <span className="px-2 py-0.5 rounded-DEFAULT bg-tertiary/10 text-tertiary border border-tertiary/30 font-label-numeric-sm text-label-numeric-sm">
                SETTLED T+1
              </span>
              <button
                className="text-primary hover:underline font-label-numeric-sm text-label-numeric-sm"
                onClick={() => setAppState("live")}
              >
                Return to Live Sim →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MAIN WORKSPACE CONTAINER                                                  */}
      {/* ========================================================================= */}
      <main className="max-w-7xl mx-auto px-gutter-desktop py-6 space-y-6">
        {/* 1. TEMPORAL HEADER & ATTENTION TRIAGE BAR */}
        <section className="bg-surface-container-low border border-outline-variant rounded-DEFAULT p-5 relative overflow-hidden">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            {/* Left: Warm & Calm Briefing Headline */}
            <div className="space-y-2">
              <div className="flex items-center space-x-3">
                <span className="px-2 py-0.5 rounded-DEFAULT bg-primary/10 text-primary text-label-numeric-sm font-label-numeric-sm font-semibold border border-primary/20">
                  Portfolio Briefing
                </span>
                <span className="text-body-sm text-outline-variant font-label-numeric-sm">
                  NSE Cash Universe · 12 Equities
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
                    {lastCheckedText}
                  </strong>
                  <span className="text-outline font-label-numeric-sm">{lastCheckedSubtext}</span>
                </span>
                <span className="text-outline-variant hidden sm:inline">•</span>
                <span className="text-on-surface-variant font-body-sm">
                  Baseline comparison vs NIFTY 50 (-0.14%)
                </span>
              </div>
            </div>

            {/* Right: Prominent Checkpoint Action Button */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-shrink-0">
              <button
                className="flex items-center justify-center space-x-2 px-5 py-2.5 bg-primary text-on-primary font-semibold rounded-DEFAULT hover:bg-primary-fixed shadow-md active:scale-95 transition-all text-body-md group"
                onClick={handleMarkAllAsChecked}
                title="Establish a fresh baseline at current spot prices"
              >
                <span className="material-symbols-outlined text-[19px]">done_all</span>
                <span>Mark all as checked</span>
                <kbd className="ml-1 px-1.5 py-0.5 rounded-DEFAULT bg-on-primary/20 text-on-primary text-[10px] font-label-numeric-sm tracking-wider uppercase">
                  C
                </kbd>
              </button>
            </div>
          </div>

          {/* Triage Breakdown & Filters */}
          <div className="mt-5 pt-4 border-t border-outline-variant flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center space-x-2 bg-surface-container px-3 py-1.5 rounded-DEFAULT border border-secondary-container/40">
                <span className="w-2 h-2 rounded-full bg-secondary"></span>
                <span className="font-label-numeric-md text-label-numeric-md text-secondary font-bold">
                  3 NEEDS ATTENTION
                </span>
                <span className="text-outline text-label-numeric-sm">(Score &gt; 75)</span>
              </div>
              <div className="flex items-center space-x-2 bg-surface-container px-3 py-1.5 rounded-DEFAULT border border-tertiary-container/40">
                <span className="w-2 h-2 rounded-full bg-tertiary"></span>
                <span className="font-label-numeric-md text-label-numeric-md text-tertiary font-bold">
                  2 WORTH A LOOK
                </span>
                <span className="text-outline text-label-numeric-sm">(Score 40–74)</span>
              </div>
              <div className="flex items-center space-x-2 bg-surface-container px-3 py-1.5 rounded-DEFAULT border border-outline-variant">
                <span className="w-2 h-2 rounded-full bg-outline"></span>
                <span className="font-label-numeric-md text-label-numeric-md text-on-surface-variant font-medium">
                  7 UNCHANGED / NO MOVE
                </span>
                <span className="text-outline text-label-numeric-sm">(Filtered noise &lt; ±0.4%)</span>
              </div>
            </div>

            {/* Calm Guiding Principles */}
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

        {/* ========================================================================= */}
        {/* VIEW CONTAINER A: NORMAL ACTIVE RANKED FEED (Default State)               */}
        {/* ========================================================================= */}
        {(appState === "live" || appState === "stale") && (
          <div className="space-y-8">
            {/* CATEGORY A: NEEDS ATTENTION */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-secondary animate-pulse"></span>
                  <h2 className="text-headline-sm font-headline-sm text-on-surface uppercase tracking-wider font-semibold">
                    Category A: Needs Attention (3)
                  </h2>
                  <span className="text-body-sm font-body-sm text-on-surface-variant">
                    — Material price divergence, abnormal volume velocity, or verified regulatory catalyst
                  </span>
                </div>
                <span className="text-label-numeric-sm font-label-numeric-sm text-outline">
                  Sorted by Attention Delta (Desc)
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {/* ITEM 1: RELIANCE */}
                <article
                  className="bg-surface-container border border-outline-variant hover:border-primary/50 hover:bg-surface-container-high rounded-DEFAULT p-4 transition-all duration-150 cursor-pointer relative group"
                  onClick={() => openDrawer("reliance")}
                >
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-headline-md font-headline-md font-bold text-on-surface">
                          RELIANCE
                        </span>
                        <span className="text-body-sm font-body-sm text-outline">
                          Reliance Industries Ltd. · NSE
                        </span>
                        <span className="px-2 py-0.5 rounded-DEFAULT bg-primary-container/15 text-primary border border-primary/30 font-label-numeric-sm text-label-numeric-sm font-semibold">
                          Unusual Move &amp; Vol Spike
                        </span>
                        <span className="px-1.5 py-0.5 rounded-DEFAULT bg-surface-variant text-on-surface font-label-numeric-sm text-label-numeric-sm">
                          Score: 86/100
                        </span>
                      </div>
                      <div className="flex items-baseline space-x-3">
                        <span className="text-headline-lg font-headline-lg font-bold text-on-surface font-label-numeric-lg text-label-numeric-lg">
                          ₹1,468.20
                        </span>
                        <span className="text-primary font-label-numeric-md text-label-numeric-md font-bold flex items-center">
                          <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
                          +4.50% (+₹63.25) since last check
                        </span>
                        <span className="text-outline text-label-numeric-sm font-label-numeric-sm">
                          (Checkpoint: ₹1,404.95 at 11:42 AM)
                        </span>
                      </div>
                      <ul className="mt-2 space-y-1 text-body-md font-body-md text-on-surface">
                        <li className="flex items-start space-x-2">
                          <span className="text-primary font-bold">•</span>
                          <span>
                            Price surged <strong>+4.5%</strong> breaking morning checkpoint resistance range (₹1,420).
                          </span>
                        </li>
                        <li className="flex items-start space-x-2">
                          <span className="text-primary font-bold">•</span>
                          <span>
                            Trading velocity is <strong>2.7× checkpoint baseline</strong> (4.2M shares vs 1.55M 30-day baseline).
                          </span>
                        </li>
                        <li className="flex items-start space-x-2">
                          <span className="text-primary font-bold">•</span>
                          <span>
                            Outperformed benchmark NIFTY 50 by <strong>+4.64% relative delta</strong> alpha.
                          </span>
                        </li>
                        <li className="flex items-start space-x-2">
                          <span className="text-primary font-bold">•</span>
                          <span className="text-on-surface-variant">
                            Catalyst: Jio Tariff revision &amp; petrochemical margin guidance filed with BSE 45m ago.
                          </span>
                        </li>
                      </ul>
                    </div>
                    <div className="flex flex-row md:flex-col items-end justify-between md:justify-start gap-3 flex-shrink-0">
                      <div className="text-right">
                        <span className="text-caption-caps font-caption-caps text-outline block">ALPHA VS NIFTY</span>
                        <span className="font-label-numeric-md text-label-numeric-md text-primary font-bold">+3.10% net</span>
                      </div>
                      <button className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-DEFAULT bg-surface-variant group-hover:bg-primary group-hover:text-background text-on-surface text-body-sm font-body-sm transition-all border border-outline-variant font-medium">
                        <span>View Attention Breakdown</span>
                        <span className="material-symbols-outlined text-[16px] group-hover:translate-x-0.5 transition-transform">
                          arrow_forward
                        </span>
                      </button>
                    </div>
                  </div>
                </article>

                {/* ITEM 2: TATAMOTORS */}
                <article
                  className="bg-surface-container border border-outline-variant hover:border-secondary/50 hover:bg-surface-container-high rounded-DEFAULT p-4 transition-all duration-150 cursor-pointer relative"
                  onClick={() => openDrawer("tatamotors")}
                >
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-headline-md font-headline-md font-bold text-on-surface">
                          TATAMOTORS
                        </span>
                        <span className="text-body-sm font-body-sm text-outline">
                          Tata Motors Passenger Vehicles · NSE
                        </span>
                        <span className="px-2 py-0.5 rounded-DEFAULT bg-secondary-container/30 text-secondary border border-secondary-container font-label-numeric-sm text-label-numeric-sm font-semibold">
                          Abrupt Gap Down
                        </span>
                        <span className="px-1.5 py-0.5 rounded-DEFAULT bg-surface-variant text-on-surface font-label-numeric-sm text-label-numeric-sm">
                          Score: 81/100
                        </span>
                      </div>
                      <div className="flex items-baseline space-x-3">
                        <span className="text-headline-lg font-headline-lg font-bold text-on-surface font-label-numeric-lg text-label-numeric-lg">
                          ₹982.50
                        </span>
                        <span className="text-secondary font-label-numeric-md text-label-numeric-md font-bold flex items-center">
                          <span className="material-symbols-outlined text-[16px]">arrow_downward</span>
                          -3.80% (-₹38.80) since last check
                        </span>
                        <span className="text-outline text-label-numeric-sm font-label-numeric-sm">
                          (Checkpoint: ₹1,021.30 at 11:42 AM)
                        </span>
                      </div>
                      <ul className="mt-2 space-y-1 text-body-md font-body-md text-on-surface">
                        <li className="flex items-start space-x-2">
                          <span className="text-secondary font-bold">•</span>
                          <span>
                            Underperformed NIFTY Auto index by <strong>-4.20%</strong> during this 2h interval.
                          </span>
                        </li>
                        <li className="flex items-start space-x-2">
                          <span className="text-secondary font-bold">•</span>
                          <span>
                            Volume reached <strong>3.1× checkpoint velocity</strong> with heavy institutional block sales recorded.
                          </span>
                        </li>
                        <li className="flex items-start space-x-2">
                          <span className="text-secondary font-bold">•</span>
                          <span className="text-on-surface-variant">
                            Catalyst: Jaguar Land Rover (UK) reported temporary supply chain bottleneck for EU delivery lines.
                          </span>
                        </li>
                      </ul>
                    </div>
                    <div className="flex flex-row md:flex-col items-end justify-between md:justify-start gap-3 flex-shrink-0">
                      <div className="text-right">
                        <span className="text-caption-caps font-caption-caps text-outline block">RELATIVE AUTO LAG</span>
                        <span className="font-label-numeric-md text-label-numeric-md text-secondary font-bold">-4.20%</span>
                      </div>
                      <button className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-DEFAULT bg-surface-variant hover:bg-surface-container-highest text-on-surface text-body-sm font-body-sm transition-all border border-outline-variant">
                        <span>Inspect Factors</span>
                        <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                      </button>
                    </div>
                  </div>
                </article>

                {/* ITEM 3: ZOMATO */}
                <article
                  className="bg-surface-container border border-outline-variant hover:border-primary/50 hover:bg-surface-container-high rounded-DEFAULT p-4 transition-all duration-150 cursor-pointer relative"
                  onClick={() => openDrawer("zomato")}
                >
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-headline-md font-headline-md font-bold text-on-surface">
                          ZOMATO
                        </span>
                        <span className="text-body-sm font-body-sm text-outline">
                          Zomato Ltd. · NSE
                        </span>
                        <span className="px-2 py-0.5 rounded-DEFAULT bg-primary-container/15 text-primary border border-primary/30 font-label-numeric-sm text-label-numeric-sm font-semibold">
                          Blinkit Expansion Momentum
                        </span>
                        <span className="px-1.5 py-0.5 rounded-DEFAULT bg-surface-variant text-on-surface font-label-numeric-sm text-label-numeric-sm">
                          Score: 78/100
                        </span>
                      </div>
                      <div className="flex items-baseline space-x-3">
                        <span className="text-headline-lg font-headline-lg font-bold text-on-surface font-label-numeric-lg text-label-numeric-lg">
                          ₹248.80
                        </span>
                        <span className="text-primary font-label-numeric-md text-label-numeric-md font-bold flex items-center">
                          <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
                          +6.20% (+₹14.50) since last check
                        </span>
                        <span className="text-outline text-label-numeric-sm font-label-numeric-sm">
                          (Checkpoint: ₹234.30 at 11:42 AM)
                        </span>
                      </div>
                      <ul className="mt-2 space-y-1 text-body-md font-body-md text-on-surface">
                        <li className="flex items-start space-x-2">
                          <span className="text-primary font-bold">•</span>
                          <span>
                            Sustained buy-side block accumulation; break of historical all-time high resistance.
                          </span>
                        </li>
                        <li className="flex items-start space-x-2">
                          <span className="text-primary font-bold">•</span>
                          <span>
                            Volume 2.4× normal checkpoint baseline with consistent positive delta order flow.
                          </span>
                        </li>
                        <li className="flex items-start space-x-2">
                          <span className="text-primary font-bold">•</span>
                          <span className="text-on-surface-variant">
                            Catalyst: Global institutional broker revised Dark Store target count upwards to 1,200 by FY26.
                          </span>
                        </li>
                      </ul>
                    </div>
                    <div className="flex flex-row md:flex-col items-end justify-between md:justify-start gap-3 flex-shrink-0">
                      <div className="text-right">
                        <span className="text-caption-caps font-caption-caps text-outline block">MOMENTUM INTENSITY</span>
                        <span className="font-label-numeric-md text-label-numeric-md text-primary font-bold">Extreme</span>
                      </div>
                      <button className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-DEFAULT bg-surface-variant hover:bg-surface-container-highest text-on-surface text-body-sm font-body-sm transition-all border border-outline-variant">
                        <span>Inspect Factors</span>
                        <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                      </button>
                    </div>
                  </div>
                </article>
              </div>
            </section>

            {/* CATEGORY B: WORTH A LOOK */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-tertiary"></span>
                  <h2 className="text-headline-sm font-headline-sm text-on-surface uppercase tracking-wider font-semibold">
                    Category B: Worth A Look (2)
                  </h2>
                  <span className="text-body-sm font-body-sm text-on-surface-variant">
                    — Moderate divergence or sector drift without acute volume anomaly
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* TCS */}
                <div className="bg-surface-container border border-outline-variant hover:border-outline rounded-DEFAULT p-4 transition-colors">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-headline-sm text-headline-sm text-on-surface font-bold">TCS</span>
                        <span className="px-1.5 py-0.5 rounded-DEFAULT bg-surface-variant text-on-surface font-label-numeric-sm text-label-numeric-sm">
                          Score: 52/100
                        </span>
                        <span className="px-1.5 py-0.5 rounded-DEFAULT bg-tertiary/10 text-tertiary border border-tertiary/20 text-label-numeric-sm font-label-numeric-sm">
                          Moderate Drift
                        </span>
                      </div>
                      <div className="mt-1 flex items-baseline space-x-2">
                        <span className="font-label-numeric-md text-label-numeric-md font-bold text-on-surface">
                          ₹3,412.00
                        </span>
                        <span className="font-label-numeric-sm text-label-numeric-sm text-secondary font-medium">
                          -1.70% since checkpoint
                        </span>
                      </div>
                    </div>
                    <span className="text-label-numeric-sm font-label-numeric-sm text-outline">Vol: 1.1x</span>
                  </div>
                  <p className="mt-2 text-body-sm font-body-sm text-on-surface-variant">
                    Underperformed NIFTY IT sector index by -0.9%. Steady orderly selling with absence of distinct news triggers.
                  </p>
                </div>

                {/* BHARTI AIRTEL */}
                <div className="bg-surface-container border border-outline-variant hover:border-outline rounded-DEFAULT p-4 transition-colors">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-headline-sm text-headline-sm text-on-surface font-bold">BHARTIARTL</span>
                        <span className="px-1.5 py-0.5 rounded-DEFAULT bg-surface-variant text-on-surface font-label-numeric-sm text-label-numeric-sm">
                          Score: 46/100
                        </span>
                        <span className="px-1.5 py-0.5 rounded-DEFAULT bg-primary/10 text-primary border border-primary/20 text-label-numeric-sm font-label-numeric-sm">
                          Inflow Accumulation
                        </span>
                      </div>
                      <div className="mt-1 flex items-baseline space-x-2">
                        <span className="font-label-numeric-md text-label-numeric-md font-bold text-on-surface">
                          ₹1,560.40
                        </span>
                        <span className="font-label-numeric-sm text-label-numeric-sm text-primary font-medium">
                          +1.40% since checkpoint
                        </span>
                      </div>
                    </div>
                    <span className="text-label-numeric-sm font-label-numeric-sm text-outline">Vol: 1.0x</span>
                  </div>
                  <p className="mt-2 text-body-sm font-body-sm text-on-surface-variant">
                    Steady incremental bidding in telecom sector basket post Reliance Jio announcement. Normal baseline turnover.
                  </p>
                </div>
              </div>
            </section>

            {/* CATEGORY C: UNCHANGED & NOISE FILTERED */}
            <section className="bg-surface-container-low border border-outline-variant rounded-DEFAULT p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center space-x-2">
                  <span className="w-2 h-2 rounded-full bg-outline"></span>
                  <h3 className="text-headline-sm font-headline-sm text-on-surface uppercase tracking-wider font-semibold">
                    Category C: Unchanged &amp; Noise Filtered (7)
                  </h3>
                </div>
                <span className="text-body-sm font-body-sm text-outline font-label-numeric-sm">
                  All 7 equities trading within standard ±0.35% noise band. No action required.
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2 pt-2 border-t border-outline-variant">
                <div className="bg-surface p-2.5 rounded-DEFAULT border border-outline-variant flex flex-col">
                  <span className="text-on-surface font-label-numeric-sm text-label-numeric-sm font-bold">INFY</span>
                  <span className="text-outline font-label-numeric-sm text-label-numeric-sm">₹1,542.10</span>
                  <span className="text-primary font-label-numeric-sm text-label-numeric-sm mt-1">+0.20%</span>
                </div>
                <div className="bg-surface p-2.5 rounded-DEFAULT border border-outline-variant flex flex-col">
                  <span className="text-on-surface font-label-numeric-sm text-label-numeric-sm font-bold">HDFCBANK</span>
                  <span className="text-outline font-label-numeric-sm text-label-numeric-sm">₹1,812.00</span>
                  <span className="text-primary font-label-numeric-sm text-label-numeric-sm mt-1">+0.05%</span>
                </div>
                <div className="bg-surface p-2.5 rounded-DEFAULT border border-outline-variant flex flex-col">
                  <span className="text-on-surface font-label-numeric-sm text-label-numeric-sm font-bold">ICICIBANK</span>
                  <span className="text-outline font-label-numeric-sm text-label-numeric-sm">₹1,240.50</span>
                  <span className="text-secondary font-label-numeric-sm text-label-numeric-sm mt-1">-0.10%</span>
                </div>
                <div className="bg-surface p-2.5 rounded-DEFAULT border border-outline-variant flex flex-col">
                  <span className="text-on-surface font-label-numeric-sm text-label-numeric-sm font-bold">ITC</span>
                  <span className="text-outline font-label-numeric-sm text-label-numeric-sm">₹482.00</span>
                  <span className="text-outline font-label-numeric-sm text-label-numeric-sm mt-1">0.00%</span>
                </div>
                <div className="bg-surface p-2.5 rounded-DEFAULT border border-outline-variant flex flex-col">
                  <span className="text-on-surface font-label-numeric-sm text-label-numeric-sm font-bold">LT</span>
                  <span className="text-outline font-label-numeric-sm text-label-numeric-sm">₹3,560.00</span>
                  <span className="text-primary font-label-numeric-sm text-label-numeric-sm mt-1">+0.15%</span>
                </div>
                <div className="bg-surface p-2.5 rounded-DEFAULT border border-outline-variant flex flex-col">
                  <span className="text-on-surface font-label-numeric-sm text-label-numeric-sm font-bold">SUNPHARMA</span>
                  <span className="text-outline font-label-numeric-sm text-label-numeric-sm">₹1,680.00</span>
                  <span className="text-secondary font-label-numeric-sm text-label-numeric-sm mt-1">-0.20%</span>
                </div>
                <div className="bg-surface p-2.5 rounded-DEFAULT border border-outline-variant flex flex-col">
                  <span className="text-on-surface font-label-numeric-sm text-label-numeric-sm font-bold">KOTAKBANK</span>
                  <span className="text-outline font-label-numeric-sm text-label-numeric-sm">₹1,745.20</span>
                  <span className="text-outline font-label-numeric-sm text-label-numeric-sm mt-1">+0.08%</span>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* ========================================================================= */}
        {/* VIEW CONTAINER B: "YOU'RE ALL CAUGHT UP" STATE (Conditional State 3)      */}
        {/* ========================================================================= */}
        {appState === "caughtup" && (
          <div className="bg-surface-container border border-outline-variant rounded-DEFAULT p-12 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-primary-container/20 text-primary border border-primary/40 flex items-center justify-center mx-auto">
              <span className="material-symbols-outlined text-[28px]">verified</span>
            </div>
            <div className="space-y-1">
              <h2 className="text-headline-md font-headline-md text-on-surface font-bold">
                You&apos;re completely caught up
              </h2>
              <p className="text-body-md font-body-md text-on-surface-variant max-w-lg mx-auto">
                No tracked equities have deviated outside their noise thresholds (&gt;0.40%) since your latest checkpoint established at <strong>{lastCheckedSubtext}</strong>.
              </p>
            </div>
            <div className="pt-2 flex items-center justify-center space-x-3">
              <button
                className="px-4 py-2 rounded-DEFAULT bg-surface-variant hover:bg-surface-container-high border border-outline-variant text-on-surface text-label-numeric-sm font-label-numeric-sm"
                onClick={() => setAppState("live")}
              >
                Simulate Market Shift →
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* VIEW CONTAINER C: "FIRST VISIT / NEW USER" STATE (Conditional State 4)    */}
        {/* ========================================================================= */}
        {appState === "newuser" && (
          <div className="bg-surface-container border border-outline-variant rounded-DEFAULT p-12 text-center space-y-6">
            <div className="w-14 h-14 rounded-DEFAULT bg-surface-container-high border border-outline-variant text-primary flex items-center justify-center mx-auto">
              <span className="material-symbols-outlined text-[32px]">flag</span>
            </div>
            <div className="space-y-2 max-w-xl mx-auto">
              <h2 className="text-headline-lg font-headline-lg text-on-surface font-bold">
                Establish Your Baseline Checkpoint
              </h2>
              <p className="text-body-md font-body-md text-on-surface-variant">
                Smart Market Watch does not overwhelm you with continuous flickering green/red digits. We take a snapshot right now at <strong className="text-on-surface">T0</strong>, and only surface changes when prices meaningfully diverge, break volumes, or trigger verified catalysts.
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
                  Standard institutional drift (±0.35%) is cleanly suppressed.
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
              className="px-5 py-2.5 bg-on-surface text-background font-semibold rounded-DEFAULT hover:bg-white active:scale-95 transition-all text-body-md font-body-md"
              onClick={() => setAppState("live")}
            >
              Take First Checkpoint Baseline Now (12 Equities)
            </button>
          </div>
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
        aria-label="Equities Factor Inspection Panel"
        className={`fixed inset-y-0 right-0 max-w-xl w-full bg-surface-container border-l border-outline-variant z-50 transform transition-transform duration-200 ease-in-out flex flex-col shadow-2xl ${
          isDrawerOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Drawer Header */}
        <div className="p-5 border-b border-outline-variant flex items-start justify-between bg-surface">
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-headline-md font-headline-md font-bold text-on-surface">
                {selectedStock.symbol}
              </span>
              <span className="px-2 py-0.5 rounded-DEFAULT bg-secondary-container/40 text-secondary border border-secondary-container font-label-numeric-sm text-label-numeric-sm font-bold">
                Score: {selectedStock.score} / 100
              </span>
            </div>
            <span className="text-body-sm font-body-sm text-outline font-label-numeric-sm">
              NSE: {selectedStock.symbol} · {selectedStock.sector}
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
              <span>BASELINE CHECKPOINT ({selectedStock.checkpointTime})</span>
              <span className="material-symbols-outlined text-[14px]">arrow_right_alt</span>
              <span>CURRENT READING (01:59 PM)</span>
            </div>
            <div className="flex items-center justify-between font-label-numeric-md text-label-numeric-md">
              <div className="text-on-surface">
                <span className="text-outline block text-caption-caps">Snapshot:</span>
                <span>₹{selectedStock.checkpointPrice.toFixed(2)}</span>
              </div>
              <div className={`text-right font-bold ${selectedStock.deltaPct >= 0 ? "text-primary" : "text-secondary"}`}>
                <span className="text-outline block text-caption-caps">Net Delta:</span>
                <span>
                  {selectedStock.deltaPct >= 0 ? "+" : ""}
                  ₹{selectedStock.deltaAmount.toFixed(2)} ({selectedStock.deltaPct >= 0 ? "+" : ""}
                  {selectedStock.deltaPct.toFixed(2)}%)
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
                    selectedStock.alpha >= 0 ? "text-primary" : "text-secondary"
                  }`}
                >
                  {selectedStock.alpha >= 0 ? "+" : ""}
                  {selectedStock.alpha.toFixed(2)}%
                </span>
                <span className="text-[11px] text-on-surface-variant block mt-0.5">vs NIFTY 50 (-0.14%)</span>
              </div>
              <div className="p-3 bg-surface rounded-DEFAULT border border-outline-variant">
                <span className="text-outline text-caption-caps font-caption-caps block">VOLUME ANOMALY</span>
                <span className="text-primary font-label-numeric-lg text-label-numeric-lg font-bold">
                  {selectedStock.volumeRatio}×
                </span>
                <span className="text-[11px] text-on-surface-variant block mt-0.5">
                  Above normal baseline
                </span>
              </div>
              <div className="p-3 bg-surface rounded-DEFAULT border border-outline-variant">
                <span className="text-outline text-caption-caps font-caption-caps block">TIME ELAPSED</span>
                <span className="text-on-surface font-label-numeric-lg text-label-numeric-lg font-bold">
                  {selectedStock.timeElapsed}
                </span>
                <span className="text-[11px] text-on-surface-variant block mt-0.5">Since last checkpoint</span>
              </div>
              <div className="p-3 bg-surface rounded-DEFAULT border border-outline-variant">
                <span className="text-outline text-caption-caps font-caption-caps block">VERIFIED CATALYSTS</span>
                <span className="text-primary font-label-numeric-lg text-label-numeric-lg font-bold">
                  {selectedStock.catalystsCount} Filings
                </span>
                <span className="text-[11px] text-on-surface-variant block mt-0.5">BSE/NSE regulatory desk</span>
              </div>
            </div>
          </div>

          {/* Analyst Deterministic Rationale Synthesis */}
          <div className="bg-surface p-4 rounded-DEFAULT border border-outline-variant space-y-2">
            <div className="flex items-center space-x-1.5 text-label-numeric-sm font-label-numeric-sm text-primary">
              <span className="material-symbols-outlined text-[16px]">analytics</span>
              <span className="font-bold uppercase tracking-wider">Analyst Synthesis</span>
            </div>
            <p className="text-body-md font-body-md text-on-surface leading-relaxed">
              &ldquo;{selectedStock.analystSynthesis}&rdquo;
            </p>
          </div>

          {/* Observable Evidence Timeline */}
          <div className="space-y-3">
            <span className="text-caption-caps font-caption-caps text-outline uppercase tracking-wider block font-bold">
              Observable Sequence Timeline
            </span>
            <div className="border-l-2 border-outline-variant pl-4 space-y-4 ml-1">
              {selectedStock.timeline.map((item, idx) => (
                <div key={idx} className="relative">
                  <span
                    className={`absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full ${
                      item.isHighlight ? "bg-primary" : "bg-outline"
                    }`}
                  ></span>
                  <span
                    className={`text-label-numeric-sm font-label-numeric-sm block ${
                      item.isHighlight ? "text-primary" : "text-outline"
                    }`}
                  >
                    {item.time}
                  </span>
                  <span className="text-body-sm font-body-sm text-on-surface font-medium">
                    {item.text}
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
            onClick={() => {
              closeDrawer();
              alert(`Updated baseline specifically for ${selectedStock.symbol}.`);
            }}
          >
            Mark {selectedStock.symbol} as Checked Only
          </button>
          <button
            className="px-4 py-2 rounded-DEFAULT bg-primary-container hover:bg-primary text-on-primary-container text-body-sm font-body-sm font-semibold transition-colors"
            onClick={handleMarkAllAsChecked}
          >
            Mark All Watchlist Checked
          </button>
        </div>
      </section>

      {/* ========================================================================= */}
      {/* TIME-TRAVEL SIMULATION DEMO MODAL                                         */}
      {/* ========================================================================= */}
      {isTimeTravelOpen && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface-container border border-outline-variant rounded-DEFAULT max-w-xl w-full p-6 space-y-5 shadow-2xl relative">
            <div className="flex items-center justify-between border-b border-outline-variant pb-3">
              <div className="flex items-center space-x-2">
                <span className="material-symbols-outlined text-tertiary">history_toggle_off</span>
                <h3 className="text-headline-sm font-headline-sm text-on-surface font-bold">
                  Interactive Time-Travel Simulation
                </h3>
              </div>
              <button
                className="text-outline hover:text-on-surface"
                onClick={() => setIsTimeTravelOpen(false)}
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <p className="text-body-md font-body-md text-on-surface-variant">
              See how Smart Market Watch preserves calm: You establish a checkpoint at 09:30 AM, step away for meetings, and return at 01:45 PM. Only high-signal deltas are calculated.
            </p>
            <div className="space-y-3 bg-surface p-4 rounded-DEFAULT border border-outline-variant">
              <div className="flex items-center justify-between text-label-numeric-sm font-label-numeric-sm">
                <span className="text-primary font-bold">T0: Morning Checkpoint (09:30 AM)</span>
                <span className="text-outline">Baseline Established</span>
              </div>
              <div className="w-full bg-surface-container-high h-1.5 rounded-full overflow-hidden">
                <div className="bg-primary h-full w-full"></div>
              </div>
              <div className="flex items-center justify-between text-body-sm font-body-sm text-outline">
                <span>+2 Hours Market Noise Filtered</span>
                <span className="text-secondary font-semibold">Divergence Detected at T+2.3h</span>
              </div>
            </div>
            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                className="px-3 py-1.5 rounded-DEFAULT bg-surface-variant text-on-surface text-body-sm font-body-sm"
                onClick={() => setIsTimeTravelOpen(false)}
              >
                Close Demo
              </button>
              <button
                className="px-4 py-1.5 rounded-DEFAULT bg-primary-container text-on-primary-container text-body-sm font-body-sm font-semibold hover:bg-primary transition-all"
                onClick={() => {
                  setIsTimeTravelOpen(false);
                  setAppState("live");
                  setLastCheckedText("2 hours, 17 mins ago");
                  setLastCheckedSubtext("(11:42 AM IST)");
                }}
              >
                Trigger Instant 2h Jump →
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
          onClick={() => setIsTimeTravelOpen(true)}
        >
          <kbd className="px-1 bg-surface-container-high text-on-surface rounded">1-5</kbd>
          <span>Simulate States</span>
        </span>
      </div>
    </div>
  );
}
