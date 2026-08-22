import { Router } from "express";
import { prisma } from "../db/client";
import { authMiddleware, AuthRequest } from "../middleware/authMiddleware";
import { ensurePortfolioAccount } from "../services/paperTradingService";
import { getPortfolioSnapshot } from "../services/portfolioService";

const router = Router();
router.use(authMiddleware);

router.get("/", async (req: AuthRequest, res, next) => {
  try {
    await ensurePortfolioAccount(req.user!.id);
    return res.json({ ok: true, user: req.user, portfolio: await getPortfolioSnapshot(req.user!.id) });
  } catch (error) {
    return next(error);
  }
});

export default router;
