"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { CheckpointVisit } from "../types/watchlistContract";

export interface ChartEvent {
  id?: string;
  title: string;
  occurredAt?: string | number;
  sentimentScore?: number;
  priceImpactExplanation?: string;
  primarySymbols?: string[];
  rippleImpacts?: Array<{ symbol: string; [key: string]: any }>;
}

export interface CandleData {
  time: number; // Unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface InteractivePriceChartProps {
  symbol: string;
  currentPrice: number;
  checkpointPrice?: number;
  checkpointTime?: string | number | null;
  visits?: CheckpointVisit[];
  events?: ChartEvent[];
  liveTicks?: Array<{ time: number; price: number }>;
  height?: number;
  className?: string;
  showControls?: boolean;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface EventCluster {
  id: string;
  x: number;
  y: number;
  events: ChartEvent[];
  timeSec: number;
}

export default function InteractivePriceChart({
  symbol,
  currentPrice,
  checkpointPrice,
  checkpointTime,
  visits = [],
  events = [],
  liveTicks = [],
  height = 250,
  className = "",
  showControls = true,
}: InteractivePriceChartProps) {
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [hasContinuousData, setHasContinuousData] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [chartMode, setChartMode] = useState<"area" | "candle">("area");
  const [streamViewMode, setStreamViewMode] = useState<"points" | "stream">("points");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoveredPointKey, setHoveredPointKey] = useState<string | null>(null);
  const [hoveredEvent, setHoveredEvent] = useState<ChartEvent | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<EventCluster | null>(null);
  const [clusterEventIndex, setClusterEventIndex] = useState<number>(0);
  const [selectedInterval, setSelectedInterval] = useState<string>("5minute");

  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch candle series for the selected symbol and interval
  useEffect(() => {
    let isCancelled = false;
    if (!symbol) return;

    async function loadCandleData() {
      setLoading(true);
      try {
        const token = typeof window !== "undefined" ? localStorage.getItem("accessToken") : null;
        const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
        const count = 60;
        const res = await fetch(
          `${API_URL}/market/candles?symbol=${encodeURIComponent(symbol)}&count=${count}&interval=${selectedInterval}`,
          { headers }
        );
        if (!res.ok) {
          if (!isCancelled) {
            setHasContinuousData(false);
            setCandles([]);
            setLoading(false);
          }
          return;
        }
        const data = await res.json();
        if (!isCancelled) {
          const isContinuous = Boolean(data.hasContinuousData && Array.isArray(data.candles) && data.candles.length > 0);
          setHasContinuousData(isContinuous);

          if (isContinuous) {
            const cList = [...data.candles];
            if (currentPrice > 0) {
              const last = cList[cList.length - 1];
              cList[cList.length - 1] = {
                ...last,
                close: currentPrice,
                high: Math.max(last.high, currentPrice),
                low: Math.min(last.low, currentPrice),
              };
            }
            setCandles(cList);
          } else {
            setCandles([]);
          }
        }
      } catch (err) {
        console.error("Failed to load candles for chart:", err);
        if (!isCancelled) {
          setHasContinuousData(false);
          setCandles([]);
        }
      } finally {
        if (!isCancelled) setLoading(false);
      }
    }

    loadCandleData();
    return () => {
      isCancelled = true;
    };
  }, [symbol, selectedInterval, currentPrice]);

  // Baseline reference price: user's checkpoint if provided, else day's open
  const baselinePrice = useMemo(() => {
    if (checkpointPrice && checkpointPrice > 0) return checkpointPrice;
    if (candles.length > 0) return candles[0].open;
    return currentPrice || 100;
  }, [checkpointPrice, candles, currentPrice]);

  // Determine active displayed point
  const activePrice = useMemo(() => {
    if (hoverIndex !== null && candles[hoverIndex]) return candles[hoverIndex].close;
    return currentPrice;
  }, [hoverIndex, candles, currentPrice]);

  const priceDelta = activePrice - baselinePrice;
  const priceDeltaPct = baselinePrice > 0 ? (priceDelta / baselinePrice) * 100 : 0;
  const isPositive = priceDelta >= 0;

  // Timestamps
  const nowSec = useMemo(() => Math.floor(Date.now() / 1000), []);

  const checkpointSec = useMemo(() => {
    if (!checkpointTime) return nowSec - 3600;
    if (typeof checkpointTime === "number") {
      return checkpointTime > 1e11 ? Math.floor(checkpointTime / 1000) : checkpointTime;
    }
    const parsed = new Date(checkpointTime).getTime();
    return isNaN(parsed) ? nowSec - 3600 : Math.floor(parsed / 1000);
  }, [checkpointTime, nowSec]);

  // Normalise all visits into discrete points
  const normalizedVisits = useMemo(() => {
    if (visits && visits.length > 0) {
      // Ensure the latest spot is present if not already in visits
      const list = [...visits];
      const hasCurrent = list.some((v) => Math.abs(v.time - nowSec) < 60);
      if (!hasCurrent && currentPrice > 0) {
        list.push({ time: nowSec, price: currentPrice, label: "Current Spot" });
      }
      return list.sort((a, b) => a.time - b.time);
    }

    // Default 2 points if no visits array passed: Checkpoint & Current Spot
    const list: CheckpointVisit[] = [];
    if (checkpointPrice && checkpointPrice > 0) {
      list.push({ time: checkpointSec, price: checkpointPrice, label: "Last Checkout" });
    }
    if (currentPrice > 0) {
      list.push({ time: nowSec, price: currentPrice, label: "Current Spot" });
    }
    return list.sort((a, b) => a.time - b.time);
  }, [visits, checkpointPrice, checkpointSec, currentPrice, nowSec]);

  // Dynamic Price Bounds
  const { minPrice, maxPrice, priceRange } = useMemo(() => {
    if (hasContinuousData && candles.length > 0) {
      const lows = candles.map((c) => c.low);
      const highs = candles.map((c) => c.high);
      if (checkpointPrice) {
        lows.push(checkpointPrice);
        highs.push(checkpointPrice);
      }
      const min = Math.min(...lows);
      const max = Math.max(...highs);
      return { minPrice: min, maxPrice: max, priceRange: Math.max(max - min, 0.5) };
    }

    // Discrete points mode bounds: include all normalized visits
    const pts = normalizedVisits.map((v) => v.price);
    if (pts.length === 0) pts.push(currentPrice || 100);
    const minRaw = Math.min(...pts);
    const maxRaw = Math.max(...pts);
    const pad = Math.max((maxRaw - minRaw) * 0.3, minRaw * 0.02, 2);
    const min = minRaw - pad;
    const max = maxRaw + pad;
    return { minPrice: min, maxPrice: max, priceRange: Math.max(max - min, 0.5) };
  }, [hasContinuousData, candles, checkpointPrice, currentPrice, normalizedVisits]);

  // Time boundaries for discrete mode
  const minTimeSec = useMemo(() => {
    if (normalizedVisits.length > 0) return Math.min(...normalizedVisits.map((v) => v.time));
    return checkpointSec;
  }, [normalizedVisits, checkpointSec]);

  const maxTimeSec = useMemo(() => {
    if (normalizedVisits.length > 0) return Math.max(...normalizedVisits.map((v) => v.time));
    return nowSec;
  }, [normalizedVisits, nowSec]);

  const timeSpan = Math.max(maxTimeSec - minTimeSec, 1800); // at least 30 mins

  // SVG Geometry Constants
  const svgWidth = 720;
  const svgHeight = height;
  const padTop = 40;
  const padBottom = 46; // Generous space for 2-row staggered bottom time labels
  const padLeft = 24;
  const padRight = 72; // Space for right-hand Y-axis price labels
  const plotWidth = svgWidth - padLeft - padRight;
  const plotHeight = svgHeight - padTop - padBottom;

  // Coordinate mapping functions
  const getY = (price: number) => {
    const norm = (price - minPrice) / priceRange;
    return padTop + plotHeight * (1 - norm);
  };

  const getX = (index: number) => {
    if (candles.length <= 1) return padLeft + plotWidth / 2;
    return padLeft + (index / (candles.length - 1)) * plotWidth;
  };

  // Mapped Discrete Visit Points with guaranteed minimum horizontal separation
  const mappedVisits = useMemo(() => {
    const count = normalizedVisits.length;
    if (count === 0) return [];

    const minUsableX = padLeft + 65;
    const maxUsableX = padLeft + plotWidth - 75; // Leave buffer before right-hand baseline tag
    const usableWidth = Math.max(maxUsableX - minUsableX, 100);

    let xs: number[] = [];
    if (count === 1) {
      xs = [(minUsableX + maxUsableX) / 2];
    } else {
      const t0 = normalizedVisits[0].time;
      const tEnd = normalizedVisits[count - 1].time;
      const totalTime = Math.max(tEnd - t0, 60);

      const rawXs = normalizedVisits.map((v) => {
        const ratio = Math.max(0, Math.min(1, (v.time - t0) / totalTime));
        return minUsableX + ratio * usableWidth;
      });

      // Enforce minimum horizontal spacing so columns NEVER collide
      const minSpacing = Math.min(130, Math.floor(usableWidth / (count - 1)));
      xs = [...rawXs];

      // Forward relaxation: enforce xs[i] >= xs[i-1] + minSpacing
      for (let i = 1; i < count; i++) {
        if (xs[i] < xs[i - 1] + minSpacing) {
          xs[i] = xs[i - 1] + minSpacing;
        }
      }

      // Backward relaxation: pull back if the last point exceeded maxUsableX
      if (xs[count - 1] > maxUsableX) {
        xs[count - 1] = maxUsableX;
        for (let i = count - 2; i >= 0; i--) {
          if (xs[i] > xs[i + 1] - minSpacing) {
            xs[i] = xs[i + 1] - minSpacing;
          }
        }
      }

      // Safeguard left edge
      if (xs[0] < minUsableX) {
        xs[0] = minUsableX;
        for (let i = 1; i < count; i++) {
          xs[i] = Math.max(xs[i], xs[i - 1] + minSpacing);
        }
      }
    }

    return normalizedVisits.map((v, idx) => {
      const isLatest = idx === count - 1;
      const isCheckpoint =
        v.label.toLowerCase().includes("checkout") || v.label.toLowerCase().includes("checkpoint");
      const x = xs[idx];
      const y = getY(v.price);

      // Smart vertical badge placement: alternate above/below to eliminate any badge collision
      let placeBelow = idx % 2 === 1;
      if (y < padTop + 45) {
        placeBelow = true;
      } else if (y > padTop + plotHeight - 35) {
        placeBelow = false;
      }

      const badgeWidth = 118;
      const badgeX = Math.max(
        padLeft + 6,
        Math.min(x - badgeWidth / 2, padLeft + plotWidth - badgeWidth - 8)
      );
      const badgeY = placeBelow ? y + 14 : y - 32;

      // Stagger bottom time labels on two distinct rows (16px and 30px)
      const timeLabelY = padTop + plotHeight + (idx % 2 === 0 ? 16 : 30);

      return {
        ...v,
        x,
        y,
        badgeX,
        badgeY,
        timeLabelY,
        isLatest,
        isCheckpoint,
        id: `visit_${idx}_${v.time}`,
      };
    });
  }, [normalizedVisits, padLeft, plotWidth, padTop, plotHeight, minPrice, priceRange]);

  // Match timeline news catalyst events & CLUSTER THEM if they are close
  const mappedClusters = useMemo(() => {
    if (!events.length) return [];

    // 1. Map raw event coordinates
    const rawMapped = events
      .map((ev) => {
        let evSec: number | null = null;
        if (typeof ev.occurredAt === "number") {
          evSec = ev.occurredAt > 1e11 ? Math.floor(ev.occurredAt / 1000) : ev.occurredAt;
        } else if (typeof ev.occurredAt === "string") {
          const parsed = new Date(ev.occurredAt).getTime();
          if (!isNaN(parsed)) evSec = Math.floor(parsed / 1000);
        }
        if (!evSec) return null;

        let x = padLeft + plotWidth / 2;
        // Dedicated top event rail (Y = 18) completely above the price plot
        const y = 18;

        if (hasContinuousData && candles.length >= 2) {
          const firstTime = candles[0].time;
          const lastTime = candles[candles.length - 1].time;
          let ratio = (evSec - firstTime) / (lastTime - firstTime);
          if (ratio < 0) ratio = 0.05;
          if (ratio > 1) ratio = 0.98;
          x = padLeft + ratio * plotWidth;
        } else if (mappedVisits.length > 0) {
          // Discrete mode: interpolate along visit columns
          if (mappedVisits.length === 1) {
            x = mappedVisits[0].x;
          } else {
            const firstVisit = mappedVisits[0];
            const lastVisit = mappedVisits[mappedVisits.length - 1];
            if (evSec <= firstVisit.time) {
              x = firstVisit.x;
            } else if (evSec >= lastVisit.time) {
              x = lastVisit.x;
            } else {
              for (let i = 0; i < mappedVisits.length - 1; i++) {
                const v1 = mappedVisits[i];
                const v2 = mappedVisits[i + 1];
                if (evSec >= v1.time && evSec <= v2.time) {
                  const dt = Math.max(v2.time - v1.time, 1);
                  const frac = (evSec - v1.time) / dt;
                  x = v1.x + frac * (v2.x - v1.x);
                  break;
                }
              }
            }
          }
        }

        return { event: ev, x, y, timeSec: evSec };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => a.x - b.x);

    // 2. Group events into clusters if their X coordinates are closer than 26px
    const clusters: EventCluster[] = [];
    const CLUSTER_THRESHOLD_PX = 26;

    for (const item of rawMapped) {
      const prev = clusters[clusters.length - 1];
      if (prev && Math.abs(prev.x - item.x) < CLUSTER_THRESHOLD_PX) {
        prev.events.push(item.event);
        // Midpoint coordinates for the cluster
        prev.x = (prev.x + item.x) / 2;
        prev.y = item.y;
      } else {
        clusters.push({
          id: `cluster_${item.event.id || clusters.length}_${item.timeSec}`,
          x: item.x,
          y: item.y,
          events: [item.event],
          timeSec: item.timeSec,
        });
      }
    }

    return clusters;
  }, [events, hasContinuousData, candles, mappedVisits, padLeft, plotWidth]);

  // Active event currently displayed in the catalyst popover
  const activeCatalyst = useMemo(() => {
    if (selectedCluster && selectedCluster.events.length > 0) {
      return selectedCluster.events[clusterEventIndex] || selectedCluster.events[0];
    }
    return hoveredEvent;
  }, [selectedCluster, clusterEventIndex, hoveredEvent]);

  // Handle pointer scrub along X axis (continuous mode only)
  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!hasContinuousData || candles.length < 2) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const scaleX = svgWidth / rect.width;
    const svgX = clientX * scaleX;

    const ratio = Math.max(0, Math.min(1, (svgX - padLeft) / plotWidth));
    const idx = Math.round(ratio * (candles.length - 1));
    setHoverIndex(idx);
  };

  const handlePointerLeave = () => {
    setHoverIndex(null);
    setHoveredPointKey(null);
    setHoveredEvent(null);
  };

  // Helper to open a specific event from anywhere (chart pin or tray pill)
  const openEventCard = (ev: ChartEvent) => {
    const parentCluster = mappedClusters.find((c) => c.events.some((e) => e.id === ev.id || e.title === ev.title));
    if (parentCluster) {
      setSelectedCluster(parentCluster);
      const idx = parentCluster.events.findIndex((e) => e.id === ev.id || e.title === ev.title);
      setClusterEventIndex(Math.max(0, idx));
    } else {
      setSelectedCluster({
        id: `single_${ev.id}`,
        x: 0,
        y: 0,
        events: [ev],
        timeSec: 0,
      });
      setClusterEventIndex(0);
    }
  };

  // Theme colors
  const strokeColor = isPositive ? "#4edea3" : "#ffb4ab";
  const gradientId = `areaGradient_${symbol}_${isPositive ? "up" : "down"}`;

  return (
    <div
      ref={containerRef}
      className={`bg-surface-container border border-outline-variant rounded-DEFAULT p-4 flex flex-col space-y-3 relative overflow-hidden select-none ${className}`}
    >
      {/* Chart Top Header Strip */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-outline-variant/60 pb-3">
        <div>
          <div className="flex items-center space-x-2">
            <span className="font-headline-md font-headline-md font-bold text-on-surface tracking-tight">
              ₹{activePrice.toFixed(2)}
            </span>
            <div
              className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-DEFAULT font-label-numeric-sm text-label-numeric-sm font-bold ${
                isPositive
                  ? "bg-primary/15 text-primary border border-primary/30"
                  : "bg-secondary/15 text-secondary border border-secondary/30"
              }`}
            >
              <span className="material-symbols-outlined text-[15px]">
                {isPositive ? "trending_up" : "trending_down"}
              </span>
              <span>
                {isPositive ? "+" : ""}
                ₹{priceDelta.toFixed(2)} ({isPositive ? "+" : ""}
                {priceDeltaPct.toFixed(2)}%)
              </span>
            </div>
            {checkpointPrice && checkpointPrice > 0 && (
              <span className="hidden sm:inline-flex items-center space-x-1 text-[11px] text-outline font-label-numeric-sm">
                <span>vs Checkpoint ₹{checkpointPrice.toFixed(2)}</span>
              </span>
            )}
          </div>
          <div className="flex items-center space-x-3 text-caption-caps text-outline mt-1 font-label-numeric-sm">
            {hasContinuousData ? (
              <span>
                {hoverIndex !== null && candles[hoverIndex]
                  ? `Scrubbing: ${new Date(candles[hoverIndex].time * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
                  : "Live Continuous Feed"}
              </span>
            ) : (
              <span className="text-primary/90 font-semibold flex items-center space-x-1">
                <span>● {mappedVisits.length} Observed Visit Checkpoints</span>
              </span>
            )}
            <span>·</span>
            <span>H: ₹{maxPrice.toFixed(2)}</span>
            <span>·</span>
            <span>L: ₹{minPrice.toFixed(2)}</span>
          </div>
        </div>

        {/* Controls: Mode Toggle vs Discrete Mode Badge */}
        {showControls && (
          <div className="flex items-center space-x-1.5 self-end sm:self-auto">
            {hasContinuousData ? (
              <>
                <div className="inline-flex rounded-DEFAULT bg-surface-variant p-0.5 border border-outline-variant">
                  <button
                    type="button"
                    onClick={() => setChartMode("area")}
                    className={`px-2 py-1 text-[11px] font-bold rounded-sm transition-colors ${
                      chartMode === "area"
                        ? "bg-surface text-on-surface shadow-xs"
                        : "text-outline hover:text-on-surface"
                    }`}
                  >
                    Line
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartMode("candle")}
                    className={`px-2 py-1 text-[11px] font-bold rounded-sm transition-colors ${
                      chartMode === "candle"
                        ? "bg-surface text-on-surface shadow-xs"
                        : "text-outline hover:text-on-surface"
                    }`}
                  >
                    Candles
                  </button>
                </div>

                <div className="inline-flex rounded-DEFAULT bg-surface-variant p-0.5 border border-outline-variant">
                  {(["1minute", "5minute", "15minute"] as const).map((int) => (
                    <button
                      key={int}
                      type="button"
                      onClick={() => setSelectedInterval(int)}
                      className={`px-1.5 py-1 text-[10px] font-bold rounded-sm transition-colors uppercase ${
                        selectedInterval === int
                          ? "bg-primary text-background font-bold shadow-xs"
                          : "text-outline hover:text-on-surface"
                      }`}
                    >
                      {int === "1minute" ? "1m" : int === "5minute" ? "5m" : "15m"}
                    </button>
                  ))}
                </div>
              </>
            ) : liveTicks && liveTicks.length >= 3 ? (
              <div className="inline-flex rounded-DEFAULT bg-surface-variant p-0.5 border border-outline-variant">
                <button
                  type="button"
                  onClick={() => setStreamViewMode("points")}
                  className={`px-2 py-1 text-[11px] font-bold rounded-sm transition-colors ${
                    streamViewMode === "points"
                      ? "bg-surface text-on-surface shadow-xs"
                      : "text-outline hover:text-on-surface"
                  }`}
                >
                  Points
                </button>
                <button
                  type="button"
                  onClick={() => setStreamViewMode("stream")}
                  className={`px-2 py-1 text-[11px] font-bold rounded-sm transition-colors flex items-center space-x-1 ${
                    streamViewMode === "stream"
                      ? "bg-primary text-background shadow-xs font-bold"
                      : "text-outline hover:text-on-surface"
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  <span>Live Stream ({liveTicks.length})</span>
                </button>
              </div>
            ) : (
              <div className="px-2.5 py-1 rounded-DEFAULT bg-surface-variant text-outline border border-outline-variant text-[11px] font-medium flex items-center space-x-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                <span>Points Mode (No synthetic curve)</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main Chart Canvas */}
      <div className="relative w-full" style={{ height: svgHeight }}>
        {loading ? (
          <div className="w-full h-full flex flex-col items-center justify-center space-y-2 text-outline">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-body-sm">Loading checkpoint telemetry for {symbol}...</span>
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full h-full overflow-visible"
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={strokeColor} stopOpacity={0.32} />
                <stop offset="45%" stopColor={strokeColor} stopOpacity={0.12} />
                <stop offset="100%" stopColor={strokeColor} stopOpacity={0.0} />
              </linearGradient>
            </defs>

            {/* Horizontal Gridlines & Right Y-Axis Price Labels */}
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
              const yVal = padTop + plotHeight * ratio;
              const priceVal = maxPrice - ratio * priceRange;
              return (
                <g key={ratio} className="text-outline/40">
                  <line
                    x1={padLeft}
                    y1={yVal}
                    x2={padLeft + plotWidth}
                    y2={yVal}
                    stroke="currentColor"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                    className="opacity-20"
                  />
                  <text
                    x={padLeft + plotWidth + 8}
                    y={yVal + 3.5}
                    fill="#94a3b8"
                    fontSize="9.5"
                    fontFamily="monospace"
                  >
                    ₹{priceVal.toFixed(1)}
                  </text>
                </g>
              );
            })}

            {/* User Checkpoint Horizontal Reference Baseline */}
            {checkpointPrice && checkpointPrice > 0 && (
              <g className="checkpoint-baseline">
                <line
                  x1={padLeft}
                  y1={getY(checkpointPrice)}
                  x2={padLeft + plotWidth}
                  y2={getY(checkpointPrice)}
                  stroke="#38bdf8"
                  strokeWidth="1.5"
                  strokeDasharray="4 3"
                  className="opacity-70"
                />
                <rect
                  x={padLeft + plotWidth + 4}
                  y={getY(checkpointPrice) - 8}
                  width="60"
                  height="16"
                  rx="3"
                  fill="#0c4a6e"
                  stroke="#0284c7"
                  strokeWidth="1"
                />
                <text
                  x={padLeft + plotWidth + 8}
                  y={getY(checkpointPrice) + 3.5}
                  fill="#7dd3fc"
                  fontSize="9"
                  fontWeight="bold"
                  fontFamily="monospace"
                >
                  📌 ₹{checkpointPrice.toFixed(0)}
                </text>
              </g>
            )}

            {/* Real-time Streaming Ticks Curve (When Live Stream is toggled ON) */}
            {!hasContinuousData && streamViewMode === "stream" && liveTicks && liveTicks.length >= 2 && (
              <g className="live-ticks-stream-group">
                {(() => {
                  const t0 = liveTicks[0].time;
                  const tEnd = liveTicks[liveTicks.length - 1].time;
                  const dt = Math.max(tEnd - t0, 5);
                  const pts = liveTicks.map((t) => {
                    const ratio = (t.time - t0) / dt;
                    const x = padLeft + 40 + ratio * (plotWidth - 80);
                    const y = getY(t.price);
                    return { x, y, price: t.price, time: t.time };
                  });
                  const pathStr = pts
                    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
                    .join(" ");
                  const lastPt = pts[pts.length - 1];

                  return (
                    <g>
                      <path
                        d={`${pathStr} L ${lastPt.x.toFixed(1)} ${padTop + plotHeight} L ${pts[0].x.toFixed(1)} ${padTop + plotHeight} Z`}
                        fill={`url(#${gradientId})`}
                        opacity="0.6"
                      />
                      <path d={pathStr} fill="none" stroke={strokeColor} strokeWidth="2.5" />
                      {/* Pulsing live tip indicator */}
                      <circle
                        cx={lastPt.x}
                        cy={lastPt.y}
                        r="12"
                        fill={strokeColor}
                        className="opacity-25 animate-ping"
                      />
                      <circle
                        cx={lastPt.x}
                        cy={lastPt.y}
                        r="4.5"
                        fill="#0f172a"
                        stroke={strokeColor}
                        strokeWidth="2.5"
                      />
                    </g>
                  );
                })()}
              </g>
            )}

            {/* ================================================================= */}
            {/* DISCRETE CHECKPOINT OBSERVATION POINTS (All Visits Included)      */}
            {/* ================================================================= */}
            {!hasContinuousData && (
              <g className="discrete-visits-group">
                {mappedVisits.map((v, idx) => {
                  const isHovered = hoveredPointKey === v.id;
                  const isCurrentSpot = v.isLatest;
                  const pointColor = isCurrentSpot ? strokeColor : "#38bdf8";

                  return (
                    <g
                      key={v.id}
                      className="cursor-pointer group"
                      onPointerEnter={() => setHoveredPointKey(v.id)}
                      onPointerLeave={() => setHoveredPointKey(null)}
                    >
                      {/* Vertical drop-line down to time axis */}
                      <line
                        x1={v.x}
                        y1={v.y}
                        x2={v.x}
                        y2={padTop + plotHeight}
                        stroke={pointColor}
                        strokeWidth="1.5"
                        strokeDasharray="3 3"
                        className="opacity-60"
                      />

                      {/* Large invisible hit area */}
                      <circle cx={v.x} cy={v.y} r="18" fill="transparent" />

                      {/* Outer animated halo for Current Spot or Hover */}
                      {isCurrentSpot ? (
                        <circle
                          cx={v.x}
                          cy={v.y}
                          r="13"
                          fill={pointColor}
                          className="opacity-25 animate-ping"
                        />
                      ) : (
                        <circle
                          cx={v.x}
                          cy={v.y}
                          r="11"
                          fill={pointColor}
                          className="opacity-20 animate-pulse"
                        />
                      )}

                      {/* Core Point Marker */}
                      <circle
                        cx={v.x}
                        cy={v.y}
                        r={isHovered ? 7.5 : 6}
                        fill="#0f172a"
                        stroke={pointColor}
                        strokeWidth={isHovered ? 3 : 2.5}
                        className="transition-transform group-hover:scale-125"
                      />

                      {/* Point Badge Label (Collision-free precomputed positions) */}
                      <g transform={`translate(${v.badgeX}, ${v.badgeY})`}>
                        <rect
                          width="118"
                          height="22"
                          rx="4"
                          fill="#0f172a"
                          stroke={pointColor}
                          strokeWidth="1.2"
                          className="shadow-xl"
                        />
                        <text
                          x="59"
                          y="14.5"
                          fill={pointColor}
                          fontSize="9.5"
                          fontWeight="bold"
                          textAnchor="middle"
                          fontFamily="monospace"
                        >
                          {v.isCheckpoint
                            ? `📌 Checkpoint ₹${v.price.toFixed(2)}`
                            : v.isLatest
                            ? `🟢 Spot ₹${v.price.toFixed(2)}`
                            : `📌 Visit #${idx + 1} ₹${v.price.toFixed(2)}`}
                        </text>
                      </g>

                      {/* Timestamp label on bottom axis (Staggered rows prevent text overlap) */}
                      <text
                        x={v.x}
                        y={v.timeLabelY}
                        fill={pointColor}
                        fontSize="9"
                        textAnchor="middle"
                        fontFamily="monospace"
                        fontWeight="bold"
                      >
                        {new Date(v.time * 1000).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        ({v.isLatest ? "Spot" : v.isCheckpoint ? "Checkout" : `V${idx + 1}`})
                      </text>
                    </g>
                  );
                })}
              </g>
            )}

            {/* Subtle Top Event Rail Guide */}
            {mappedClusters.length > 0 && (
              <line
                x1={padLeft}
                y1={18}
                x2={padLeft + plotWidth}
                y2={18}
                stroke="#38bdf8"
                strokeWidth="0.5"
                strokeDasharray="3 3"
                className="opacity-20"
              />
            )}

            {/* ================================================================= */}
            {/* CLUSTERED NEWS CATALYST PINS (⚡) — Solves Overlap                */}
            {/* ================================================================= */}
            {mappedClusters.map((cluster) => {
              const count = cluster.events.length;
              const isMulti = count > 1;
              const firstEvent = cluster.events[0];
              const isBull = (firstEvent.sentimentScore ?? 0) > 0;
              const isBear = (firstEvent.sentimentScore ?? 0) < 0;
              const pinColor = isMulti ? "#38bdf8" : isBull ? "#4edea3" : isBear ? "#ffb4ab" : "#facc15";
              const isSelected = selectedCluster?.id === cluster.id;

              return (
                <g
                  key={cluster.id}
                  className="cursor-pointer group"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedCluster(cluster);
                    setClusterEventIndex(0);
                  }}
                  onPointerEnter={() => setHoveredEvent(firstEvent)}
                >
                  {/* Vertical indicator line dropping from top event rail into chart */}
                  <line
                    x1={cluster.x}
                    y1={cluster.y + 10}
                    x2={cluster.x}
                    y2={padTop + plotHeight}
                    stroke={pinColor}
                    strokeWidth={isSelected ? "1.5" : "1"}
                    strokeDasharray="2 2"
                    opacity={isSelected ? 0.85 : 0.4}
                  />

                  {/* Generous invisible hit target for effortless clicks */}
                  <circle cx={cluster.x} cy={cluster.y} r="18" fill="transparent" />

                  {isMulti ? (
                    // Cluster Badge Pill
                    <g transform={`translate(${cluster.x - 16}, ${cluster.y - 10})`}>
                      <rect
                        width="32"
                        height="20"
                        rx="10"
                        fill="#0f172a"
                        stroke={pinColor}
                        strokeWidth="2"
                        className="shadow-md transition-transform group-hover:scale-110"
                      />
                      <text
                        x="16"
                        y="13"
                        textAnchor="middle"
                        fontSize="9.5"
                        fill={pinColor}
                        fontWeight="bold"
                      >
                        ⚡{count}
                      </text>
                    </g>
                  ) : (
                    // Single Pin
                    <>
                      <circle
                        cx={cluster.x}
                        cy={cluster.y}
                        r={isSelected ? "9" : "7.5"}
                        fill="#18181b"
                        stroke={pinColor}
                        strokeWidth={isSelected ? "2.5" : "2"}
                        className="transition-transform group-hover:scale-125 shadow-lg"
                      />
                      <text
                        x={cluster.x}
                        y={cluster.y + 3}
                        textAnchor="middle"
                        fontSize="9"
                        fill={pinColor}
                        fontWeight="bold"
                      >
                        ⚡
                      </text>
                    </>
                  )}
                </g>
              );
            })}
          </svg>
        )}

        {/* Selected / Hovered Catalyst Card Popover */}
        {activeCatalyst && (
          <div className="absolute bottom-2 left-2 right-2 bg-surface border border-primary/50 p-3 rounded-DEFAULT shadow-2xl flex flex-col space-y-2 z-30 animate-in fade-in">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center space-x-2 flex-wrap">
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-sm bg-primary/20 text-primary border border-primary/30">
                  ⚡ Catalyst Plotted on Timeline
                </span>
                {selectedCluster && selectedCluster.events.length > 1 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-sm bg-surface-variant text-on-surface border border-outline-variant">
                    {clusterEventIndex + 1} of {selectedCluster.events.length} Headlines
                  </span>
                )}
                <span className="text-[10px] text-outline font-mono">
                  {activeCatalyst.occurredAt
                    ? new Date(
                        typeof activeCatalyst.occurredAt === "number" && activeCatalyst.occurredAt < 1e11
                          ? activeCatalyst.occurredAt * 1000
                          : activeCatalyst.occurredAt
                      ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                    : "Recent"}
                </span>
              </div>

              <div className="flex items-center space-x-1">
                {/* Carousel controls if multiple events in cluster */}
                {selectedCluster && selectedCluster.events.length > 1 && (
                  <div className="flex items-center space-x-1 mr-2">
                    <button
                      type="button"
                      onClick={() =>
                        setClusterEventIndex((prev) =>
                          prev > 0 ? prev - 1 : selectedCluster.events.length - 1
                        )
                      }
                      className="px-1.5 py-0.5 rounded bg-surface-variant text-on-surface text-[11px] font-bold hover:bg-surface-container-highest"
                      title="Previous headline at this time"
                    >
                      ‹ Prev
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setClusterEventIndex((prev) =>
                          prev < selectedCluster.events.length - 1 ? prev + 1 : 0
                        )
                      }
                      className="px-1.5 py-0.5 rounded bg-surface-variant text-on-surface text-[11px] font-bold hover:bg-surface-container-highest"
                      title="Next headline at this time"
                    >
                      Next ›
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCluster(null);
                    setHoveredEvent(null);
                  }}
                  className="text-outline hover:text-on-surface p-1 rounded hover:bg-surface-variant transition-colors"
                  title="Dismiss catalyst card"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </div>
            </div>

            <p className="text-body-sm text-on-surface font-bold leading-snug">
              {activeCatalyst.title}
            </p>
            {activeCatalyst.priceImpactExplanation && (
              <p className="text-[11px] text-on-surface-variant line-clamp-2">
                {activeCatalyst.priceImpactExplanation}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ===================================================================== */}
      {/* NEWS CATALYST SELECTOR TRAY (Solves close-together news selection)    */}
      {/* ===================================================================== */}
      {events.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-outline-variant/40">
          <div className="flex items-center justify-between text-[11px] text-outline">
            <span className="font-semibold flex items-center space-x-1">
              <span className="text-primary font-bold">⚡</span>
              <span>Catalyst Timeline Tray ({events.length} News Events — Click any to inspect):</span>
            </span>
            <span className="text-[10px] text-outline">Horizontal Scroll</span>
          </div>

          <div className="flex items-center space-x-1.5 overflow-x-auto py-1 scrollbar-thin">
            {events.map((ev, idx) => {
              const isBull = (ev.sentimentScore ?? 0) > 0;
              const isBear = (ev.sentimentScore ?? 0) < 0;
              const isSelected = activeCatalyst?.id === ev.id || activeCatalyst?.title === ev.title;

              return (
                <button
                  key={ev.id || idx}
                  type="button"
                  onClick={() => openEventCard(ev)}
                  className={`px-2.5 py-1 rounded-full text-[11px] flex items-center space-x-1.5 whitespace-nowrap transition-all flex-shrink-0 cursor-pointer ${
                    isSelected
                      ? "bg-primary text-background font-bold shadow-md ring-2 ring-primary/40 scale-105"
                      : "bg-surface-variant text-on-surface hover:bg-surface-container-highest border border-outline-variant"
                  }`}
                  title={ev.title}
                >
                  <span className={isBull ? "text-primary font-bold" : isBear ? "text-secondary font-bold" : "text-tertiary"}>
                    ⚡
                  </span>
                  <span className="font-mono text-[10px] opacity-75">
                    {ev.occurredAt
                      ? new Date(
                          typeof ev.occurredAt === "number" && ev.occurredAt < 1e11
                            ? ev.occurredAt * 1000
                            : ev.occurredAt
                        ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                      : `Event ${idx + 1}`}
                  </span>
                  <span className="max-w-[130px] truncate">{ev.title}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Baseline Legend Footer */}
      <div className="flex items-center justify-between text-[11px] text-outline border-t border-outline-variant/40 pt-2 px-1">
        <div className="flex items-center space-x-4 flex-wrap">
          <div className="flex items-center space-x-1.5">
            <span className="w-2.5 h-0.5 bg-[#38bdf8] inline-block border-dashed" />
            <span>
              {checkpointPrice ? `📌 Checkpoint Baseline (₹${checkpointPrice.toFixed(2)})` : "Opening Baseline"}
            </span>
          </div>
          {mappedVisits.length > 2 && (
            <div className="flex items-center space-x-1 text-primary">
              <span>●</span>
              <span>{mappedVisits.length - 2} Previous Visit(s) Recorded</span>
            </div>
          )}
        </div>
        <div className="flex items-center space-x-1">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="font-label-numeric-sm text-[10px] uppercase font-bold text-primary">
            {hasContinuousData ? "Continuous Stream" : "Observed Points"}
          </span>
        </div>
      </div>
    </div>
  );
}
