import { Router } from "express";
import { prisma } from "../db/client";
import { authMiddleware, AuthRequest } from "../middleware/authMiddleware";
import { syncNewsFeed } from "../workers/newsWorker";
import { SECTOR_KNOWLEDGE_GRAPH, generatePriceImpactExplanation, EventType } from "../services/sentiment";

const router = Router();
router.use(authMiddleware);

// GET /intelligence/events — Recent AI enriched market events
router.get("/events", async (_req: AuthRequest, res, next) => {
  try {
    const events = await prisma.event.findMany({
      where: { status: "PROCESSED" },
      orderBy: { occurredAt: "desc" },
      take: 20,
    });

    const parsedEvents = events.map((event) => {
      const payload = event.payload as Record<string, any>;
      const title = payload?.title ?? "Market Announcement";
      const summary = payload?.summary ?? "";
      const primarySymbols = payload?.primarySymbols ?? [];
      const eventType = (payload?.eventType ?? event.type) as EventType;
      const sentimentScore = payload?.sentimentScore ?? 0;
      const priceImpactExplanation =
        payload?.priceImpactExplanation ||
        generatePriceImpactExplanation(title, summary, primarySymbols, eventType, sentimentScore);

      return {
        id: event.id,
        type: event.type,
        source: event.source,
        title,
        summary,
        url: payload?.url,
        eventType,
        primarySymbols,
        sentimentScore,
        confidence: payload?.confidence ?? 0.7,
        impactHorizon: payload?.impactHorizon ?? "SHORT_TERM",
        transmissionPath: payload?.transmissionPath ?? "DIRECT",
        rippleImpacts: payload?.rippleImpacts ?? [],
        reasoning: payload?.reasoning ?? "",
        priceImpactExplanation,
        occurredAt: event.occurredAt,
      };
    });

    return res.json({ ok: true, events: parsedEvents });
  } catch (error) {
    return next(error);
  }
});

// GET /intelligence/exposure/:symbol — Exposure graph for a symbol
router.get("/exposure/:symbol", async (req: AuthRequest, res, next) => {
  try {
    const rawSymbol = Array.isArray(req.params.symbol) ? req.params.symbol[0] : req.params.symbol;
    const symbol = (rawSymbol || "").toUpperCase();


    // Look for sector linkages in the knowledge graph
    let matchedSector: string | null = null;
    let sensitivityFactors: any[] = [];
    let inputCommodities: string[] = [];

    for (const [key, data] of Object.entries(SECTOR_KNOWLEDGE_GRAPH)) {
      if (data.directSymbols.includes(symbol)) {
        matchedSector = data.sector;
        sensitivityFactors = data.sensitiveTo ?? [];
        inputCommodities = data.inputCommodities ?? [];
        break;
      }
    }

    return res.json({
      ok: true,
      symbol,
      sector: matchedSector ?? "General Market",
      inputCommodities,
      sensitivities: sensitivityFactors,
    });
  } catch (error) {
    return next(error);
  }
});

// POST /intelligence/sync-news — Trigger on-demand news sync
router.post("/sync-news", async (req: AuthRequest, res, next) => {
  try {
    const io = req.app.get("io");
    const result = await syncNewsFeed(io ?? null);
    return res.json({ ok: true, ...result });
  } catch (error) {
    return next(error);
  }
});

export default router;
