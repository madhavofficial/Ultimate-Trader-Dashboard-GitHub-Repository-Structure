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

router.delete("/:id", async (req: AuthRequest, res, next) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) return res.status(400).json({ error: "Missing alert id" });
    await prisma.alert.deleteMany({ where: { id, userId: req.user!.id } });
    await writeAuditLog({ userId: req.user!.id, action: "DELETE", entityType: "Alert", entityId: id, request: req });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});


export default router;

