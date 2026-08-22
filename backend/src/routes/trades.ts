import { Router } from "express";
import { prisma } from "../db/client";
import { authMiddleware, AuthRequest } from "../middleware/authMiddleware";
import { writeAuditLog } from "../services/auditLog";
import { tradeInputSchema } from "../utils/validation";

const router = Router();
router.use(authMiddleware);

router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const trades = await prisma.trade.findMany({ where: { userId: req.user!.id }, orderBy: { timestamp: "desc" } });
    return res.json({ ok: true, trades });
  } catch (error) {
    return next(error);
  }
});

router.post("/add", async (req: AuthRequest, res, next) => {
  try {
    const input = tradeInputSchema.parse(req.body);
    const trade = await prisma.trade.create({
      data: {
        symbol: input.symbol!,
        qty: input.qty,
        price: input.price,
        side: input.side,
        user: { connect: { id: req.user!.id } },
      },
    });
    await writeAuditLog({ userId: req.user!.id, action: "CREATE", entityType: "Trade", entityId: trade.id, metadata: input, request: req });
    return res.status(201).json({ ok: true, trade });
  } catch (error) {
    return next(error);
  }
});

export default router;
