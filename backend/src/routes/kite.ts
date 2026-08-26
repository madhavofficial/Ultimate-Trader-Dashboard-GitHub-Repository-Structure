import { Router } from "express";
import { z } from "zod";
import { authMiddleware, AuthRequest } from "../middleware/authMiddleware";
import { completeKiteLogin, createKiteLoginUrl, syncKiteAccount, syncKiteHoldings } from "../services/kiteService";
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

router.post("/sync/account", authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const result = await syncKiteAccount(req.user!.id);
    await writeAuditLog({ userId: req.user!.id, action: "SYNC_ACCOUNT", entityType: "BrokerSession", metadata: { holdings: result.holdings.length, positions: result.positions.length }, request: req });
    return res.json({ ok: true, profile: result.profile, holdings: result.holdings, positions: result.positions });
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

// GET /broker/kite/margins
router.get("/margins", authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { getKiteMargins } = await import("../services/kiteService");
    const margins = await getKiteMargins(req.user!.id);
    return res.json({ ok: true, margins });
  } catch (error) {
    return next(error);
  }
});

// GET /broker/kite/orders
router.get("/orders", authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const { getKiteOrders } = await import("../services/kiteService");
    const orders = await getKiteOrders(req.user!.id);
    return res.json({ ok: true, orders });
  } catch (error) {
    return next(error);
  }
});

// POST /broker/kite/orders — Live Order Execution with Double Confirmation
router.post("/orders", authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const schema = z.object({
      symbol: z.string().trim().min(1).transform((s) => s.toUpperCase()),
      exchange: z.enum(["NSE", "BSE"]).default("NSE"),
      transaction_type: z.enum(["BUY", "SELL"]),
      order_type: z.enum(["MARKET", "LIMIT", "SL", "SL-M"]).default("MARKET"),
      quantity: z.number().int().positive().safe(),
      price: z.number().positive().optional(),
      trigger_price: z.number().positive().optional(),
      product: z.enum(["CNC", "MIS", "NRML"]).default("CNC"),
      validity: z.enum(["DAY", "IOC"]).default("DAY"),
      tag: z.string().max(16).optional(),
    });

    const body = schema.parse(req.body);
    const { placeKiteLiveOrder } = await import("../services/kiteService");
    const orderResult = await placeKiteLiveOrder(req.user!.id, {
      ...body,
      symbol: body.symbol,
    });

    await writeAuditLog({
      userId: req.user!.id,
      action: "LIVE_ORDER_PLACED",
      entityType: "Trade",
      metadata: { ...body, orderResult: orderResult as any },
      request: req,
    });


    return res.json({ ok: true, orderResult });
  } catch (error) {
    return next(error);
  }
});

export default router;

