import { Router } from "express";
import { prisma } from "../db/client";
import { authMiddleware, AuthRequest } from "../middleware/authMiddleware";
import { writeAuditLog } from "../services/auditLog";
import { alertInputSchema } from "../utils/validation";

const router = Router();
router.use(authMiddleware);

router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const alerts = await prisma.alert.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: "desc" } });
    return res.json({ ok: true, alerts });
  } catch (error) {
    return next(error);
  }
});

router.post("/add", async (req: AuthRequest, res, next) => {
  try {
    const input = alertInputSchema.parse(req.body);
    const alert = await prisma.alert.create({
      data: {
        symbol: input.symbol!,
        condition: input.condition,
        value: input.value,
        user: { connect: { id: req.user!.id } },
      },
    });
    await writeAuditLog({ userId: req.user!.id, action: "CREATE", entityType: "Alert", entityId: alert.id, metadata: input, request: req });
    return res.status(201).json({ ok: true, alert });
  } catch (error) {
    return next(error);
  }
});

export default router;
