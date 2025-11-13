import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/authMiddleware";

const router = Router();

// temporary mock holdings
let mockHoldings = [
  { symbol: "INFY", qty: 10, avg: 1500 },
  { symbol: "RELIANCE", qty: 5, avg: 2400 },
  { symbol: "TCS", qty: 2, avg: 3800 },
];

// PROTECTED
router.get("/", authMiddleware, (req: AuthRequest, res) => {
  return res.json({
    ok: true,
    user: req.user,
    holdings: mockHoldings,
  });
});

export default router;