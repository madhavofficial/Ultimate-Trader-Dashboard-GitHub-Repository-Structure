import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/authMiddleware";

const router = Router();

// temp per-user alerts
const userAlerts = new Map<string, any[]>();

router.get("/", authMiddleware, (req: AuthRequest, res) => {
  const alerts = userAlerts.get(req.user!.id) || [];
  return res.json({ ok: true, alerts });
});

router.post("/add", authMiddleware, (req: AuthRequest, res) => {
  const { symbol, condition, value } = req.body;
  if (!symbol || !condition || value === undefined) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const alerts = userAlerts.get(req.user!.id) || [];
  const newAlert = {
    id: alerts.length + 1,
    symbol,
    condition,
    value,
  };

  alerts.push(newAlert);
  userAlerts.set(req.user!.id, alerts);

  return res.json({ ok: true, message: "Alert added", alert: newAlert });
});

export default router;