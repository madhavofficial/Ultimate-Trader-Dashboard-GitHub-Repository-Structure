import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/authMiddleware";

const router = Router();

// temp trade history per user (in-memory)
const userTrades = new Map<string, any[]>();

router.get("/", authMiddleware, (req: AuthRequest, res) => {
  const trades = userTrades.get(req.user!.id) || [];
  return res.json({ ok: true, trades });
});

router.post("/add", authMiddleware, (req: AuthRequest, res) => {
  const { symbol, qty, price, side } = req.body;
  if (!symbol || !qty || !price || !side) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const trades = userTrades.get(req.user!.id) || [];
  const newTrade = {
    id: trades.length + 1,
    symbol,
    qty,
    price,
    side,
    timestamp: Date.now(),
  };

  trades.push(newTrade);
  userTrades.set(req.user!.id, trades);

  return res.json({ ok: true, message: "Trade added", trade: newTrade });
});

export default router;