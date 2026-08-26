import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/authMiddleware";
import { computeUserAnalytics } from "../services/analyticsService";

const router = Router();
router.use(authMiddleware);

// GET /analytics/summary
router.get("/summary", async (req: AuthRequest, res, next) => {
  try {
    const summary = await computeUserAnalytics(req.user!.id);
    return res.json({ ok: true, analytics: summary });
  } catch (error) {
    return next(error);
  }
});

export default router;
