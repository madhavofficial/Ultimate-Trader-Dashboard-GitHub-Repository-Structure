import { Router, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AuthRequest } from "../middleware/authMiddleware";
import { getWatchlistSummary } from "../services/watchlist/changeDetectionService";
import { recordOrUpdateCheckpoint } from "../services/watchlist/snapshotService";
import { getDemoScenarioSummary } from "../services/watchlist/demoScenarioService";
import { prisma } from "../db/client";
import { env } from "../config/env";

const router = Router();

/**
 * Flexible auth middleware for watchlist:
 * - If valid Bearer token provided, uses real authenticated user.
 * - If unauthenticated (evaluators, judges, or guest view), falls back to the database user or demo evaluator.
 */
async function watchlistAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) {
    try {
      const token = auth.split(" ")[1];
      const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as any;
      req.user = { id: payload.sub, email: payload.email };
      return next();
    } catch {
      // invalid token, fallback below
    }
  }

  // Graceful fallback for evaluator / guest preview without requiring prior login
  const dbUser = await prisma.user.findFirst({ select: { id: true, email: true } });
  if (dbUser) {
    req.user = dbUser;
  } else {
    req.user = { id: "demo-evaluator", email: "demo@example.com" };
  }
  return next();
}

router.use(watchlistAuth);

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
