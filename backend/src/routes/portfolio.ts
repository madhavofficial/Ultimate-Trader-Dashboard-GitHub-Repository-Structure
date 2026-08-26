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
    const [portfolio, positions] = await Promise.all([
      getPortfolioSnapshot(req.user!.id),
      prisma.position.findMany({ where: { userId: req.user!.id }, orderBy: { symbol: "asc" } }),
    ]);
    return res.json({ ok: true, user: req.user, portfolio, positions });
  } catch (error) {
    return next(error);
  }
});

export default router;
