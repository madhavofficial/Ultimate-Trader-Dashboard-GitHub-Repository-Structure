import { Router } from "express";
import { z } from "zod";
import { authMiddleware, AuthRequest } from "../middleware/authMiddleware";
import { completeKiteLogin, createKiteLoginUrl, syncKiteHoldings } from "../services/kiteService";
import { writeAuditLog } from "../services/auditLog";
import { startKiteTicker, stopKiteTicker } from "../services/streamHandler";

const router = Router();

router.get("/login", authMiddleware, (req: AuthRequest, res, next) => {
  try {
    return res.json({ url: createKiteLoginUrl(req.user!.id) });
  } catch (error) {
    return next(error);
  }
});

router.get("/callback", async (req, res, next) => {
  try {
    const query = z.object({ state: z.string().min(1), request_token: z.string().min(1) }).parse(req.query);
    const result = await completeKiteLogin(query.state, query.request_token);
    await writeAuditLog({ userId: result.userId, action: "BROKER_CONNECTED", entityType: "BrokerSession", metadata: result, request: req });
    return res.json({ ok: true, provider: "ZERODHA", brokerUserId: result.brokerUserId });
  } catch (error) {
    return next(error);
  }
});

router.post("/sync/holdings", authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const holdings = await syncKiteHoldings(req.user!.id);
    await writeAuditLog({ userId: req.user!.id, action: "SYNC_HOLDINGS", entityType: "Holding", metadata: { count: holdings.length }, request: req });
    return res.json({ ok: true, holdings });
  } catch (error) {
    return next(error);
  }
});

router.post("/stream/start", authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { tokens } = z.object({ tokens: z.array(z.number().int().positive()).min(1).max(3000) }).parse(req.body);
    const io = req.app.get("io");
    if (!io) return res.status(503).json({ error: "Market stream is unavailable" });
    return res.json({ ok: true, stream: await startKiteTicker(io, req.user!.id, tokens) });
  } catch (error) {
    return next(error);
  }
});

router.post("/stream/stop", authMiddleware, (req: AuthRequest, res) => {
  stopKiteTicker(req.user!.id);
  return res.json({ ok: true });
});

export default router;
