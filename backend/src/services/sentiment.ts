export type EventType =
  | "EARNINGS"
  | "GOVT_POLICY"
  | "COMMODITY"
  | "GEOPOLITICAL"
  | "MANAGEMENT"
  | "REGULATORY"
  | "MACRO";

export type ImpactHorizon = "INTRADAY" | "SHORT_TERM" | "MEDIUM_TERM";
export type TransmissionPath = "DIRECT" | "SUPPLY_CHAIN" | "COMMODITY_INPUT" | "SECTOR_PEER" | "MACRO_FX";

export interface EnrichedEvent {
  title: string;
  source: string;
  url?: string;
  summary: string;
  eventType: EventType;
  primarySymbols: string[];
  sentimentScore: number; // -1.0 to 1.0
  confidence: number; // 0.0 to 1.0
  impactHorizon: ImpactHorizon;
  transmissionPath: TransmissionPath;
  rippleImpacts: Array<{
    symbol: string;
    sector: string;
    impactDirection: "POSITIVE" | "NEGATIVE";
    strength: number;
    rationale: string;
  }>;
  reasoning: string;
}

// Pre-configured transmission knowledge graph for Indian market equities
export const SECTOR_KNOWLEDGE_GRAPH: Record<string, {
  sector: string;
  directSymbols: string[];
  inputCommodities?: string[];
  sensitiveTo?: Array<{ factor: string; direction: "POSITIVE" | "NEGATIVE"; rationale: string }>;
}> = {
  IT: {
    sector: "Information Technology",
    directSymbols: ["TCS", "INFY", "WIPRO", "HCLTECH", "TECHM"],
    sensitiveTo: [
      { factor: "US_RECESSION", direction: "NEGATIVE", rationale: "Delays in US client discretionary IT spending" },
      { factor: "USD_INR_DEPRECIATION", direction: "POSITIVE", rationale: "Higher rupee revenue realization on export billings" },
      { factor: "AI_SPENDING_BOOM", direction: "POSITIVE", rationale: "Accelerated cloud and enterprise AI migration deals" },
    ],
  },
  OIL_GAS: {
    sector: "Oil & Gas Upstream",
    directSymbols: ["RELIANCE", "ONGC", "OIL", "BPCL", "IOC"],
    inputCommodities: ["BRENT_CRUDE"],
    sensitiveTo: [
      { factor: "CRUDE_OIL_SURGE", direction: "POSITIVE", rationale: "Higher realizations for upstream oil & gas exploration" },
      { factor: "WINDFALL_TAX_CUT", direction: "POSITIVE", rationale: "Boosts net profit margins on crude extraction" },
    ],
  },
  PAINTS_TYRES: {
    sector: "Paints & Tyres (Crude Derivative Consumers)",
    directSymbols: ["ASIANPAINT", "BERGEPAINT", "MRF", "APOLLOTYRE"],
    inputCommodities: ["BRENT_CRUDE", "RUBBER"],
    sensitiveTo: [
      { factor: "CRUDE_OIL_SURGE", direction: "NEGATIVE", rationale: "Crude derivatives form 50%+ of raw material input costs" },
      { factor: "CRUDE_OIL_DROP", direction: "POSITIVE", rationale: "Gross margin expansion as raw material costs ease" },
    ],
  },
  AVIATION: {
    sector: "Aviation & Logistics",
    directSymbols: ["INDIGO", "SPICEJET", "BLUEDART"],
    inputCommodities: ["ATF_JET_FUEL"],
    sensitiveTo: [
      { factor: "CRUDE_OIL_SURGE", direction: "NEGATIVE", rationale: "Aviation Turbine Fuel (ATF) represents 40%+ of airline operating expenses" },
    ],
  },
  AUTO: {
    sector: "Automobile & EV",
    directSymbols: ["TATAMOTORS", "MARUTI", "M&M", "BAJAJ-AUTO"],
    inputCommodities: ["STEEL", "ALUMINIUM", "LITHIUM"],
    sensitiveTo: [
      { factor: "STEEL_DUTY_HIKE", direction: "NEGATIVE", rationale: "Higher steel prices inflate vehicle bill-of-materials" },
      { factor: "FESTIVE_DEMAND_SURGE", direction: "POSITIVE", rationale: "Strong retail channel inventory clearance" },
      { factor: "EV_SUBSIDY_EXTENSION", direction: "POSITIVE", rationale: "Accelerates fleet transition and EV adoption" },
    ],
  },
  BANKING: {
    sector: "Banking & Financial Services",
    directSymbols: ["HDFCBANK", "ICICIBANK", "SBIN", "KOTAKBANK", "AXISBANK"],
    sensitiveTo: [
      { factor: "RBI_RATE_CUT", direction: "POSITIVE", rationale: "Lowers cost of funds, expands credit demand, and creates bond treasury gains" },
      { factor: "RBI_RATE_HIKE", direction: "NEGATIVE", rationale: "Compresses Net Interest Margins (NIM) and slows loan growth" },
      { factor: "NPA_RECOVERY_SURGE", direction: "POSITIVE", rationale: "Write-backs directly improve return on assets (ROA)" },
    ],
  },
  METALS: {
    sector: "Metals & Mining",
    directSymbols: ["TATASTEEL", "JSWSTEEL", "HINDALCO", "VEDL"],
    inputCommodities: ["IRON_ORE", "COKING_COAL"],
    sensitiveTo: [
      { factor: "CHINA_STIMULUS", direction: "POSITIVE", rationale: "Spurs global infrastructure demand and lifts international commodity prices" },
      { factor: "IMPORT_DUTY_PROTECTION", direction: "POSITIVE", rationale: "Shields domestic steel mills from cheap foreign dumping" },
    ],
  },
};

const SYMBOL_KEYWORDS: Record<string, string[]> = {
  INFY: ["infosys", "infy", "salil parekh"],
  RELIANCE: ["reliance", "ril", "mukesh ambani", "jio", "reliance retail"],
  TCS: ["tcs", "tata consultancy", "k krithivasan"],
  TATAMOTORS: ["tata motors", "jlr", "jaguar land rover", "tamo"],
  HDFCBANK: ["hdfc bank", "hdfc"],
  ICICIBANK: ["icici bank", "icici"],
  SBIN: ["state bank of india", "sbi", "sbin"],
  TATASTEEL: ["tata steel"],
  ASIANPAINT: ["asian paints", "asian paint"],
  INDIGO: ["indigo", "interglobe aviation"],
};

const POSITIVE_TRIGGERS = [
  "profit surges", "profit jumps", "revenue up", "beats estimates", "strong results",
  "upgrade", "target raised", "wins contract", "deal signed", "dividend declared",
  "rbi rate cut", "stimulus", "duty cut", "tax relief", "approval granted",
  "order book expands", "all-time high", "record sales", "expansion plan",
];

const NEGATIVE_TRIGGERS = [
  "profit drops", "profit falls", "revenue declines", "misses estimates", "downgrade",
  "target cut", "losses widen", "investigation", "sebi penalty", "rbi restriction",
  "duty hike", "tax increase", "fraud", "auditor resigns", "default",
  "cyber attack", "us recession", "sanctions", "strike", "layoffs",
];

export function analyzeNewsText(title: string, summary: string): EnrichedEvent {
  const text = `${title} ${summary}`.toLowerCase();

  // 1. Identify primary symbols
  const detectedSymbols: string[] = [];
  for (const [symbol, keywords] of Object.entries(SYMBOL_KEYWORDS)) {
    if (keywords.some((keyword) => text.includes(keyword))) {
      detectedSymbols.push(symbol);
    }
  }

  // 2. Classify Event Type
  let eventType: EventType = "MACRO";
  if (text.includes("investigation") || text.includes("penalty") || text.includes("fraud") || text.includes("raid") || text.includes("curb") || text.includes("notice") || text.includes("ban")) {
    eventType = "REGULATORY";
  } else if (text.includes("q1") || text.includes("q2") || text.includes("q3") || text.includes("q4") || text.includes("earnings") || text.includes("profit") || text.includes("revenue") || text.includes("results")) {
    eventType = "EARNINGS";
  } else if (text.includes("rbi") || text.includes("sebi") || text.includes("government") || text.includes("ministry") || text.includes("pib") || text.includes("cabinet") || text.includes("budget") || text.includes("policy") || text.includes("scheme")) {
    eventType = "GOVT_POLICY";
  } else if (text.includes("crude") || text.includes("oil") || text.includes("steel") || text.includes("gold") || text.includes("commodity")) {
    eventType = "COMMODITY";
  } else if (text.includes("war") || text.includes("conflict") || text.includes("tariff") || text.includes("sanction") || text.includes("geopolitical") || text.includes("iran") || text.includes("israel") || text.includes("red sea")) {
    eventType = "GEOPOLITICAL";
  } else if (text.includes("ceo") || text.includes("cfo") || text.includes("board") || text.includes("director") || text.includes("management")) {
    eventType = "MANAGEMENT";
  }


  // 3. Compute Sentiment Score (-1.0 to 1.0)
  let posCount = 0;
  let negCount = 0;
  for (const trigger of POSITIVE_TRIGGERS) {
    if (text.includes(trigger)) posCount++;
  }
  for (const trigger of NEGATIVE_TRIGGERS) {
    if (text.includes(trigger)) negCount++;
  }

  let sentimentScore = 0;
  if (posCount > 0 || negCount > 0) {
    sentimentScore = Number(((posCount - negCount) / (posCount + negCount)).toFixed(2));
  } else {
    // Slight baseline heuristic
    if (text.includes("growth") || text.includes("boost") || text.includes("jump") || text.includes("positive")) sentimentScore = 0.35;
    if (text.includes("drop") || text.includes("slump") || text.includes("fall") || text.includes("negative") || text.includes("concern")) sentimentScore = -0.35;
  }

  // 4. Determine Transmission Path & Ripple Impacts
  const rippleImpacts: EnrichedEvent["rippleImpacts"] = [];
  let transmissionPath: TransmissionPath = detectedSymbols.length > 0 ? "DIRECT" : "MACRO_FX";

  // Crude Oil / Energy transmission
  if (text.includes("crude") || text.includes("brent") || text.includes("oil price")) {
    transmissionPath = "COMMODITY_INPUT";
    if (text.includes("surge") || text.includes("jump") || text.includes("higher") || text.includes("rises") || sentimentScore > 0) {
      rippleImpacts.push({
        symbol: "RELIANCE",
        sector: "Oil & Gas Upstream",
        impactDirection: "POSITIVE",
        strength: 0.75,
        rationale: "Higher benchmark crude prices boost refining margins & upstream exploration realizations",
      });
      rippleImpacts.push({
        symbol: "ASIANPAINT",
        sector: "Paints",
        impactDirection: "NEGATIVE",
        strength: 0.8,
        rationale: "Crude derivatives are primary raw material inputs; higher crude compresses paint gross margins",
      });
      rippleImpacts.push({
        symbol: "INDIGO",
        sector: "Aviation",
        impactDirection: "NEGATIVE",
        strength: 0.85,
        rationale: "ATF (Jet Fuel) costs increase, directly squeezing airline operational margins",
      });
    } else {
      rippleImpacts.push({
        symbol: "ASIANPAINT",
        sector: "Paints",
        impactDirection: "POSITIVE",
        strength: 0.75,
        rationale: "Softening crude prices ease raw material input costs and expand EBITDA margins",
      });
      rippleImpacts.push({
        symbol: "INDIGO",
        sector: "Aviation",
        impactDirection: "POSITIVE",
        strength: 0.8,
        rationale: "Lower jet fuel costs immediately expand operational margins",
      });
    }
  }

  // IT & US Macro transmission
  if (text.includes("us fed") || text.includes("nasdaq") || text.includes("tech spending") || text.includes("artificial intelligence") || text.includes("cloud")) {
    transmissionPath = "SECTOR_PEER";
    const dir = sentimentScore >= 0 ? "POSITIVE" : "NEGATIVE";
    rippleImpacts.push({
      symbol: "TCS",
      sector: "IT Services",
      impactDirection: dir,
      strength: 0.7,
      rationale: dir === "POSITIVE" ? "Improving US macro clarity expands discretionary enterprise tech spending" : "Cautious client tech budgets constrain deal closures",
    });
    rippleImpacts.push({
      symbol: "INFY",
      sector: "IT Services",
      impactDirection: dir,
      strength: 0.7,
      rationale: dir === "POSITIVE" ? "Accelerated cloud transformation contracts boost pipeline" : "Delayed client ramp-ups soften revenue guidance",
    });
  }

  // 5. Impact Horizon
  let impactHorizon: ImpactHorizon = "SHORT_TERM";
  if (eventType === "EARNINGS" || eventType === "REGULATORY") {
    impactHorizon = "INTRADAY";
  } else if (eventType === "GOVT_POLICY" || eventType === "GEOPOLITICAL") {
    impactHorizon = "MEDIUM_TERM";
  }

  const confidence = Number(Math.min(0.95, Math.max(0.6, 0.65 + (posCount + negCount) * 0.08 + (detectedSymbols.length > 0 ? 0.15 : 0))).toFixed(2));

  return {
    title,
    source: "MARKET_INTELLIGENCE",
    summary: summary.slice(0, 300),
    eventType,
    primarySymbols: detectedSymbols.length > 0 ? detectedSymbols : ["NIFTY"],
    sentimentScore,
    confidence,
    impactHorizon,
    transmissionPath,
    rippleImpacts,
    reasoning: `Extracted ${detectedSymbols.length} ticker(s) with ${eventType} event category. Sentiment scored at ${sentimentScore > 0 ? '+' : ''}${sentimentScore} (confidence: ${Math.round(confidence * 100)}%). ${rippleImpacts.length > 0 ? `Identified ${rippleImpacts.length} second-order market transmission ripple(s).` : 'Direct corporate price action transmission.'}`,
  };
}

export async function analyzeNewsAsync(title: string, summary: string): Promise<EnrichedEvent> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;

  if (process.env.GEMINI_API_KEY) {
    try {
      const prompt = `Analyze this Indian financial news headline and summary for stock market impact.
Headline: ${title}
Summary: ${summary}

Return ONLY valid JSON matching this schema:
{
  "eventType": "EARNINGS" | "GOVT_POLICY" | "COMMODITY" | "GEOPOLITICAL" | "MANAGEMENT" | "REGULATORY" | "MACRO",
  "primarySymbols": string[], // NSE stock symbols like INFY, RELIANCE, TCS, etc.
  "sentimentScore": number, // float from -1.0 (very bearish) to 1.0 (very bullish)
  "confidence": number, // float from 0.0 to 1.0
  "impactHorizon": "INTRADAY" | "SHORT_TERM" | "MEDIUM_TERM",
  "transmissionPath": "DIRECT" | "SUPPLY_CHAIN" | "COMMODITY_INPUT" | "SECTOR_PEER" | "MACRO_FX",
  "rippleImpacts": [
    {
      "symbol": string,
      "sector": string,
      "impactDirection": "POSITIVE" | "NEGATIVE",
      "strength": number,
      "rationale": string
    }
  ],
  "reasoning": string
}`;

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { response_mime_type: "application/json" },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawJson) {
          const parsed = JSON.parse(rawJson);
          return {
            title,
            source: "LLM_GEMINI",
            summary: summary.slice(0, 300),
            eventType: parsed.eventType ?? "MACRO",
            primarySymbols: Array.isArray(parsed.primarySymbols) && parsed.primarySymbols.length > 0 ? parsed.primarySymbols : ["NIFTY"],
            sentimentScore: Number(parsed.sentimentScore ?? 0),
            confidence: Number(parsed.confidence ?? 0.8),
            impactHorizon: parsed.impactHorizon ?? "SHORT_TERM",
            transmissionPath: parsed.transmissionPath ?? "DIRECT",
            rippleImpacts: Array.isArray(parsed.rippleImpacts) ? parsed.rippleImpacts : [],
            reasoning: parsed.reasoning ?? "Classified by Gemini Flash financial intelligence.",
          };
        }
      }
    } catch (err) {
      console.warn("LLM sentiment enrichment failed, falling back to deterministic NLP:", err);
    }
  }

  // Fallback to fast deterministic NLP
  return analyzeNewsText(title, summary);
}

