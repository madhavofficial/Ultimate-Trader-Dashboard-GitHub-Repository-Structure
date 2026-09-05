import { Router, Response, NextFunction, Request } from "express";
import { authMiddleware, AuthRequest } from "../middleware/authMiddleware";
import { getWatchlistSummary } from "../services/watchlist/changeDetectionService";
import { recordOrUpdateCheckpoint } from "../services/watchlist/snapshotService";
import { getDemoScenarioSummary } from "../services/watchlist/demoScenarioService";

const router = Router();

/**
 * POST & GET /watchlist/demo-scenario
 * Explicitly unauthenticated, demo-scoped evaluator endpoint.
 * - Operates entirely in-memory and isolated.
 * - Does NOT access or query any real user database state.
 * - Does NOT mutate any checkpoints or watchlist items.
 */
router.all("/demo-scenario", (_req: Request, res: Response) => {
  const summary = getDemoScenarioSummary("demo-evaluator");
  return res.json(summary);
});

// All production routes below require strict, verified authentication
router.use(authMiddleware);

/**
 * GET /watchlist/summary (and alias /watchlist/changes)
 * Returns complete "What meaningfully changed while you were away" payload for authenticated user
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

export default router;
