import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/authMiddleware";
import { prisma } from "../db/client";

const router = Router();
router.use(authMiddleware);

// GET /notifications/history
router.get("/history", async (req: AuthRequest, res, next) => {
  try {
    const history = await prisma.alertNotification.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return res.json({ ok: true, notifications: history });
  } catch (error) {
    return next(error);
  }
});

export default router;
