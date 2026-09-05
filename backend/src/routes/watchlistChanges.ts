import { Router, Response, NextFunction, Request } from "express";
import { env } from "../config/env";
import { authMiddleware, AuthRequest } from "../middleware/authMiddleware";
import { getWatchlistSummary, getAvailableCheckpoints } from "../services/watchlist/changeDetectionService";
import { recordOrUpdateCheckpoint, recordOrUpdateStockCheckpoint } from "../services/watchlist/snapshotService";
import { getDemoScenarioSummary } from "../services/watchlist/demoScenarioService";

const router = Router();

/**
 * POST & GET /watchlist/demo-scenario
 * Explicitly unauthenticated, demo-scoped evaluator endpoint (disabled in production).
 * - Operates entirely in-memory and isolated.
 * - Does NOT access or query any real user database state.
 * - Does NOT mutate any checkpoints or watchlist items.
 */
router.all("/demo-scenario", (_req: Request, res: Response) => {
  if (env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Endpoint not found" });
  }
  const summary = getDemoScenarioSummary("demo-evaluator");
  return res.json(summary);
});

// All production routes below require strict, verified authentication
router.use(authMiddleware);

/**
 * GET /watchlist/checkpoints
 * Returns list of available checkpoint anchors (Live checkpoint, past checkout sessions, market open, yesterday close)
 */
router.get("/checkpoints", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const checkpoints = await getAvailableCheckpoints(req.user!.id);
    return res.json({ ok: true, checkpoints });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /watchlist/summary (and alias /watchlist/changes)
 * Returns complete "What meaningfully changed while you were away" payload for authenticated user
 * Supports optional ?baseline=<id_or_time> for historical checkpoint replay
 */
router.get(["/summary", "/changes"], async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const isDemo = env.NODE_ENV !== "production" && req.query.demo === "true";
    if (isDemo) {
      return res.json(getDemoScenarioSummary(req.user!.id));
    }

    const baseline = (req.query.baseline as string) || (req.query.checkpointId as string) || null;
    const summary = await getWatchlistSummary(req.user!.id, baseline);
    return res.json(summary);
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /watchlist/checkpoint
 * Meaning: "Mark all as checked" - records an atomic acknowledged checkpoint for authenticated user
 */
router.post("/checkpoint", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const checkpoint = await recordOrUpdateCheckpoint(req.user!.id);
    return res.json({
      ok: true,
      message: "Watchlist state successfully acknowledged and checkpoint updated.",
      lastCheckedAt: checkpoint?.lastCheckedAt ? checkpoint.lastCheckedAt.toISOString() : new Date().toISOString(),
      itemCount: checkpoint?.items.length ?? 0,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /watchlist/checkpoint/:symbol
 * Meaning: "Mark stock as checked" - records an acknowledged checkpoint for a single stock
 */
router.post("/checkpoint/:symbol", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const rawSymbol = Array.isArray(req.params.symbol) ? req.params.symbol[0] : req.params.symbol;
    const symbol = (rawSymbol || "").toUpperCase();
    if (!symbol) {
      return res.status(400).json({ ok: false, message: "Symbol parameter is required" });
    }

    const item = await recordOrUpdateStockCheckpoint(req.user!.id, symbol);
    return res.json({
      ok: true,
      message: `${symbol} baseline successfully acknowledged and checkpoint updated.`,
      symbol,
      observedAt: item.observedAt.toISOString(),
      checkpointPrice: Number(item.price),
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
