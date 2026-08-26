import { Router } from "express";
import { z } from "zod";
import { authMiddleware, AuthRequest } from "../middleware/authMiddleware";
import { prisma } from "../db/client";
import { generateCompositeSignal } from "../services/signalEngine";

const router = Router();
router.use(authMiddleware);

// GET /signals — Active proposed trading signals
router.get("/", async (_req: AuthRequest, res, next) => {
  try {
    const signals = await prisma.signal.findMany({
      where: { status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return res.json({ ok: true, signals });
  } catch (error) {
    return next(error);
  }
});

// POST /signals/generate — Generate signal for a symbol
router.post("/generate", async (req: AuthRequest, res, next) => {
  try {
    const { symbol, price } = z.object({
      symbol: z.string().trim().min(1).transform((s) => s.toUpperCase()),
      price: z.coerce.number().positive(),
    }).parse(req.body);

    const io = req.app.get("io");
    const signal = await generateCompositeSignal(symbol, price, io);
    return res.json({ ok: true, signal });
  } catch (error) {
    return next(error);
  }
});

export default router;
