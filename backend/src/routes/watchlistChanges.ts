import { Router, Response, NextFunction } from "express";
import { authMiddleware, AuthRequest } from "../middleware/authMiddleware";
import { getWatchlistSummary } from "../services/watchlist/changeDetectionService";
import { recordOrUpdateCheckpoint } from "../services/watchlist/snapshotService";
import { getDemoScenarioSummary } from "../services/watchlist/demoScenarioService";

const router = Router();
router.use(authMiddleware);

/**
 * GET /watchlist/summary (and alias /watchlist/changes)
 * Returns complete "What meaningfully changed while you were away" payload
 */
router.get(["/summary", "/changes"], async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const isDemo = req.query.demo === "true";
    if (isDemo) {
      return res.json(getDemoScenarioSummary(req.user!.id));
    }

    const summary = await getWatchlistSummary(req.user!.id);
    return res.json(summary);
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /watchlist/checkpoint
 * Meaning: "Mark all as checked" - records an atomic acknowledged checkpoint
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
 * POST /watchlist/demo-scenario
 * Evaluator demo endpoint to instantly experience what changed over a 2h absence
 */
router.post("/demo-scenario", async (req: AuthRequest, res: Response) => {
  const summary = getDemoScenarioSummary(req.user?.id ?? "demo-evaluator");
  return res.json(summary);
});

export default router;
