import { Router } from "express";
import { z } from "zod";
import { authMiddleware, AuthRequest } from "../middleware/authMiddleware";
import { ensureRiskSettings, toggleKillSwitch } from "../services/riskEngine";
import { prisma } from "../db/client";

const router = Router();
router.use(authMiddleware);

// GET /risk/settings
router.get("/settings", async (req: AuthRequest, res, next) => {
  try {
    const settings = await ensureRiskSettings(req.user!.id);
    return res.json({ ok: true, settings });
  } catch (error) {
    return next(error);
  }
});

// POST /risk/settings
router.post("/settings", async (req: AuthRequest, res, next) => {
  try {
    const schema = z.object({
      maxDailyLoss: z.coerce.number().positive().optional(),
      maxPositionSize: z.coerce.number().positive().optional(),
      maxSectorExposurePct: z.coerce.number().min(5).max(100).optional(),
      stopLossDefaultPct: z.coerce.number().min(0.5).max(20).optional(),
      takeProfitDefaultPct: z.coerce.number().min(0.5).max(50).optional(),
    });
    const body = schema.parse(req.body);

    const updated = await prisma.riskSettings.upsert({
      where: { userId: req.user!.id },
      update: body,
      create: { userId: req.user!.id, ...body },
    });

    return res.json({ ok: true, settings: updated });
  } catch (error) {
    return next(error);
  }
});

// POST /risk/kill-switch
router.post("/kill-switch", async (req: AuthRequest, res, next) => {
  try {
    const { active, reason } = z.object({ active: z.boolean(), reason: z.string().optional() }).parse(req.body);
    const settings = await toggleKillSwitch(req.user!.id, active, reason);
    return res.json({ ok: true, settings });
  } catch (error) {
    return next(error);
  }
});

export default router;
