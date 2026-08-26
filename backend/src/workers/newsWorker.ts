import crypto from "crypto";
import { Server } from "socket.io";
import { prisma } from "../db/client";
import { analyzeNewsText, EnrichedEvent } from "../services/sentiment";

export interface RawNewsArticle {
  id: string;
  source: string;
  title: string;
  summary: string;
  url?: string;
  publishedAt: Date;
}

// Curated live mock / real-world feed source items for Indian equity markets
const SAMPLE_MARKET_FEED: Array<Omit<RawNewsArticle, "id" | "publishedAt">> = [
  {
    source: "ECONOMIC_TIMES",
    title: "Infosys signs $1.5 Billion multi-year enterprise AI transformation deal with European major",
    summary: "Infosys expands its cloud and Topaz generative AI suite pipeline, raising confidence in FY27 revenue guidance with strong margin accretion.",
    url: "https://economictimes.indiatimes.com/tech/ites/infosys-ai-deal-europe",
  },
  {
    source: "MONEYCONTROL",
    title: "Brent Crude climbs above $85 per barrel following Red Sea shipping lane geopolitical tensions",
    summary: "Rising maritime insurance and rerouting around Cape of Good Hope lifts oil benchmarks. Upstream energy stocks gain while paints and airlines face input cost headwinds.",
    url: "https://www.moneycontrol.com/news/business/markets/brent-crude-surges",
  },
  {
    source: "PIB_GOVT_INDIA",
    title: "Cabinet approves expansion of PLI Scheme for domestic Electronics & Semiconductor Component Manufacturing",
    summary: "Ministry of Electronics & IT expands budgetary outlay by ₹12,500 crore to incentivize local hardware fabrication and component suppliers.",
    url: "https://pib.gov.in/PressReleasePage.aspx?PRID=2048911",
  },
  {
    source: "REUTERS_INDIA",
    title: "TCS reports 12% profit surge in Q2; Management notes early signs of client discretionary spending revival",
    summary: "Tata Consultancy Services beats analyst expectations across BFSI and UK retail verticals, declaring an interim dividend of ₹28 per share.",
    url: "https://reuters.com/business/tcs-q2-results-profit-surge",
  },
  {
    source: "BLOOMBERG_INDIA",
    title: "RBI MPC signals neutral stance; liquidity surplus improves short-term banking cost of funds",
    summary: "Reserve Bank of India Governor highlights easing headline CPI inflation, paving the way for potential rate adjustments in upcoming quarters.",
    url: "https://bloomberg.com/news/rbi-monetary-policy-neutral",
  },
  {
    source: "FINANCIAL_EXPRESS",
    title: "Reliance Retail expands quick-commerce network with 200 automated fulfillment dark stores",
    summary: "RIL subsidiary ramps up high-density local delivery infrastructure to capture fast-growing grocery and consumer electronics market share.",
    url: "https://financialexpress.com/industry/reliance-retail-quick-commerce",
  },
];

export async function processNewsArticle(io: Server | null, article: RawNewsArticle) {
  const externalId = article.id || crypto.createHash("sha256").update(`${article.source}:${article.title}`).digest("hex").slice(0, 32);

  const existing = await prisma.event.findUnique({
    where: { source_externalId: { source: article.source, externalId } },
  });
  if (existing) return null;

  // Run AI Enrichment
  const enriched: EnrichedEvent = analyzeNewsText(article.title, article.summary);

  const eventRecord = await prisma.event.create({
    data: {
      type: enriched.eventType,
      source: article.source,
      externalId,
      payload: {
        title: article.title,
        url: article.url,
        summary: enriched.summary,
        eventType: enriched.eventType,
        primarySymbols: enriched.primarySymbols,
        sentimentScore: enriched.sentimentScore,
        confidence: enriched.confidence,
        impactHorizon: enriched.impactHorizon,
        transmissionPath: enriched.transmissionPath,
        rippleImpacts: enriched.rippleImpacts,
        reasoning: enriched.reasoning,
        publishedAt: article.publishedAt.toISOString(),
      },
      occurredAt: article.publishedAt,
      status: "PROCESSED",
      processedAt: new Date(),
    },
  });

  // Broadcast to live connected clients on dashboard
  if (io) {
    io.emit("market:event", {
      id: eventRecord.id,
      source: article.source,
      title: article.title,
      url: article.url,
      ...enriched,
      publishedAt: article.publishedAt.toISOString(),
    });
  }

  return eventRecord;
}

export async function syncNewsFeed(io: Server | null) {
  let ingestedCount = 0;

  for (const item of SAMPLE_MARKET_FEED) {
    const id = crypto.createHash("sha256").update(`${item.source}:${item.title}`).digest("hex").slice(0, 32);
    const publishedAt = new Date(Date.now() - Math.floor(Math.random() * 3600000));

    const result = await processNewsArticle(io, {
      id,
      source: item.source,
      title: item.title,
      summary: item.summary,
      url: item.url,
      publishedAt,
    });

    if (result) ingestedCount++;
  }

  return { ingestedCount };
}

let schedulerTimer: NodeJS.Timeout | null = null;

export function startNewsWorkerScheduler(io: Server, intervalMs = 60000) {
  if (schedulerTimer) return;
  console.log(`Starting background news intelligence worker (polling every ${intervalMs / 1000}s)...`);

  // Initial sync
  void syncNewsFeed(io).catch((err) => console.error("Initial news sync error:", err));

  schedulerTimer = setInterval(() => {
    void syncNewsFeed(io).catch((err) => console.error("News worker polling error:", err));
  }, intervalMs);
}

export function stopNewsWorkerScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
