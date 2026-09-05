import { Router } from "express";
import { z } from "zod";
import { authMiddleware, AuthRequest } from "../middleware/authMiddleware";
import { completeJob, enqueueJob, failJob } from "../services/jobService";
import { searchInstruments, syncInstruments } from "../services/instrumentService";
import { prisma } from "../db/client";

const router = Router();
router.use(authMiddleware);

router.get("/search", async (req, res, next) => {
  try {
    const query = z.string().trim().min(1).max(64).parse(req.query.q);
    return res.json({ ok: true, instruments: await searchInstruments(query) });
  } catch (error) {
    return next(error);
  }
});

router.post("/instruments/sync", async (req: AuthRequest, res, next) => {
  try {
    const job = await enqueueJob("SYNC_INSTRUMENTS", { userId: req.user!.id });
    let result;
    try {
      result = await syncInstruments(req.user!.id);
      await completeJob(job.id);
    } catch (error) {
      await failJob(job.id, error instanceof Error ? error.message : String(error));
      throw error;
    }
    return res.json({ ok: true, jobId: job.id, ...result });
  } catch (error) {
    return next(error);
  }
});

import { registerMockSymbol } from "../services/kiteMockStream";
import { subscribeSymbolToKite, unsubscribeSymbolFromKite } from "../services/streamHandler";
import { getLatestLtp } from "../services/portfolioService";

router.get("/watchlist", async (req: AuthRequest, res, next) => {
  try {
    const watchlist = await prisma.watchlistItem.findMany({ where: { userId: req.user!.id }, orderBy: { symbol: "asc" } });
    for (const item of watchlist) {
      void registerMockSymbol(item.symbol);
    }
    const enriched = watchlist.map((item) => {
      const ltp = getLatestLtp(item.symbol);
      return {
        ...item,
        lastPrice: ltp?.price ?? null,
        quoteTimestamp: ltp?.timestamp ?? null,
        source: ltp?.source ?? "none",
      };
    });
    return res.json({ ok: true, watchlist: enriched });
  } catch (error) {
    return next(error);
  }
});

router.post("/watchlist", async (req: AuthRequest, res, next) => {
  try {
    const { symbol } = z.object({ symbol: z.string().trim().min(1).max(32).transform((value) => value.toUpperCase()) }).parse(req.body);
    const item = await prisma.watchlistItem.upsert({ where: { userId_symbol: { userId: req.user!.id, symbol } }, update: {}, create: { userId: req.user!.id, symbol } });
    
    // Automatically register symbol for mock tick streaming
    await registerMockSymbol(symbol);
    // Automatically subscribe symbol in active Kite ticker
    await subscribeSymbolToKite(req.user!.id, symbol);

    const ltp = getLatestLtp(symbol);
    return res.status(201).json({
      ok: true,
      item: {
        ...item,
        lastPrice: ltp?.price ?? null,
        quoteTimestamp: ltp?.timestamp ?? null,
        source: ltp?.source ?? "none",
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.delete("/watchlist/:symbol", async (req: AuthRequest, res, next) => {
  try {
    const rawSymbol = Array.isArray(req.params.symbol) ? req.params.symbol[0] : req.params.symbol;
    const symbol = z.string().trim().min(1).max(32).parse(rawSymbol).toUpperCase();
    await prisma.watchlistItem.deleteMany({ where: { userId: req.user!.id, symbol } });

    // Automatically unsubscribe symbol from active Kite ticker if not held in portfolio
    await unsubscribeSymbolFromKite(req.user!.id, symbol);

    return res.json({ ok: true, symbol });
  } catch (error) {
    return next(error);
  }
});

import { getCurrentMarketStatus } from "../services/marketHoursService";
import { fetchKiteHistoricalCandles } from "../services/historicalDataService";

router.get("/status", (_req, res) => {
  return res.json({ ok: true, marketStatus: getCurrentMarketStatus() });
});

router.get("/candles", async (req: AuthRequest, res, next) => {
  try {
    const symbol = z.string().trim().min(1).parse(req.query.symbol).toUpperCase();
    const count = z.coerce.number().min(10).max(300).default(60).parse(req.query.count);
    const intervalParam = z.enum(["minute", "3minute", "5minute", "10minute", "15minute", "30minute", "60minute", "day"]).default("5minute").parse(req.query.interval);
    const candles = await fetchKiteHistoricalCandles(req.user!.id, symbol, intervalParam, count);

    if (candles.length > 0) {
      return res.json({ ok: true, symbol, candles, hasContinuousData: true, source: "kite" });
    }

    // When Kite historical series is unavailable, do NOT fabricate fake continuous candles.
    // Return empty candles so client displays discrete checkout observation points honestly.
    return res.json({
      ok: true,
      symbol,
      candles: [],
      hasContinuousData: false,
      source: "discrete_checkpoints",
    });
  } catch (error) {
    return next(error);
  }
});


export default router;
