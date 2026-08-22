import { Router } from "express";
import { prisma } from "../db/client";
import { authMiddleware, AuthRequest } from "../middleware/authMiddleware";

const router = Router();
router.use(authMiddleware);

router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const holdings = await prisma.holding.findMany({ where: { userId: req.user!.id }, orderBy: { symbol: "asc" } });
    return res.json({ ok: true, user: req.user, holdings });
  } catch (error) {
    return next(error);
  }
});

export default router;
