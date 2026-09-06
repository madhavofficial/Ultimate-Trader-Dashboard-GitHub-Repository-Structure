import { gunzipSync } from "zlib";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import { getKiteTickerCredentials } from "./kiteService";
import { enqueueJob, startJobWorker } from "./jobService";

type InstrumentRow = {
  instrument_token: string;
  exchange_token: string;
  tradingsymbol: string;
  name: string;
  last_price: string;
  expiry: string;
  strike: string;
  tick_size: string;
  lot_size: string;
  instrument_type: string;
  segment: string;
  exchange: string;
};

export async function syncInstruments(userId: string) {
  const credentials = await getKiteTickerCredentials(userId);
  const response = await fetch("https://api.kite.trade/instruments", {
    headers: {
      Authorization: `token ${credentials.apiKey}:${credentials.accessToken}`,
      "X-Kite-Version": "3",
    },
  });
  if (!response.ok) throw new Error(`Instrument download failed with HTTP ${response.status}`);

  const bytes = Buffer.from(await response.arrayBuffer());
  const csv = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8");
  const rows = parseCsv(csv).map(toInstrumentData).filter(Boolean) as Prisma.InstrumentCreateInput[];

  for (let index = 0; index < rows.length; index += 100) {
    const batch = rows.slice(index, index + 100);
    await Promise.all(batch.map((data) => prisma.instrument.upsert({
      where: { exchange_tradingsymbol: { exchange: data.exchange, tradingsymbol: data.tradingsymbol } },
      update: data,
      create: data,
    })));
  }
  return { imported: rows.length };
}

export function startInstrumentSyncScheduler(userId: string) {
  const workerStop = startJobWorker(`instruments:${userId}`, async (job) => {
    if (job.type !== "SYNC_INSTRUMENTS") return;
    await syncInstruments(userId);
  }, { pollIntervalMs: 30_000, type: "SYNC_INSTRUMENTS" });
  const timer = setInterval(() => { void enqueueJob("SYNC_INSTRUMENTS", { userId }); }, 24 * 60 * 60 * 1000);
  void enqueueJob("SYNC_INSTRUMENTS", { userId });
  return () => { workerStop(); clearInterval(timer); };
}

let ongoingSync: Promise<boolean> | null = null;

/**
 * Ensures that NSE instruments are populated and fresh in the PostgreSQL Instrument table.
 * If instruments already exist and were synced within the last 24 hours, returns true immediately without re-downloading.
 * Otherwise, triggers syncInstruments(userId) reusing the existing CSV download and upsert pipeline.
 */
export async function ensureInstrumentsAvailable(userId: string): Promise<boolean> {
  try {
    const latest = await prisma.instrument.findFirst({
      select: { syncedAt: true },
      orderBy: { syncedAt: "desc" },
    });

    const isFresh = latest && (Date.now() - latest.syncedAt.getTime() < 24 * 60 * 60 * 1000);
    if (isFresh) {
      return true;
    }

    if (ongoingSync) {
      return await ongoingSync;
    }

    ongoingSync = (async () => {
      try {
        await syncInstruments(userId);
        return true;
      } catch (err) {
        console.error(`[Instruments] Sync failed for user ${userId}:`, err);
        return false;
      } finally {
        ongoingSync = null;
      }
    })();

    return await ongoingSync;
  } catch (err) {
    console.error(`[Instruments] Error checking instrument availability:`, err);
    return false;
  }
}

export function searchInstruments(query: string) {
  return prisma.instrument.findMany({
    where: {
      OR: [
        { tradingsymbol: { contains: query, mode: "insensitive" } },
        { name: { contains: query, mode: "insensitive" } },
      ],
    },
    orderBy: [{ exchange: "asc" }, { tradingsymbol: "asc" }],
    take: 50,
  });
}

export async function symbolsForTokens(tokens: number[]) {
  const instruments = await prisma.instrument.findMany({ where: { instrumentToken: { in: tokens } }, select: { instrumentToken: true, tradingsymbol: true } });
  return new Map(instruments.map((instrument) => [instrument.instrumentToken, instrument.tradingsymbol]));
}

function toInstrumentData(row: InstrumentRow): Prisma.InstrumentCreateInput | null {
  if (!row.instrument_token || !row.exchange || !row.tradingsymbol || !row.tick_size || !row.lot_size) return null;
  const instrumentToken = Number(row.instrument_token);
  const exchangeToken = row.exchange_token ? Number(row.exchange_token) : undefined;
  const lotSize = Number(row.lot_size);
  const tickSize = Number(row.tick_size);
  if (!Number.isSafeInteger(instrumentToken) || instrumentToken <= 0 || (exchangeToken !== undefined && (!Number.isSafeInteger(exchangeToken) || exchangeToken <= 0)) || !Number.isSafeInteger(lotSize) || lotSize <= 0 || !Number.isFinite(tickSize) || tickSize <= 0) return null;
  return {
    instrumentToken,
    exchangeToken,
    tradingsymbol: row.tradingsymbol,
    name: row.name || undefined,
    lastPrice: decimalOrNull(row.last_price),
    expiry: row.expiry ? new Date(`${row.expiry}T00:00:00.000Z`) : undefined,
    strike: decimalOrNull(row.strike),
    tickSize: new Prisma.Decimal(row.tick_size),
    lotSize,
    instrumentType: row.instrument_type,
    segment: row.segment,
    exchange: row.exchange,
    syncedAt: new Date(),
  };
}

function decimalOrNull(value: string) {
  return value ? new Prisma.Decimal(value) : undefined;
}

function parseCsv(csv: string): InstrumentRow[] {
  const [headerLine, ...lines] = csv.split(/\r?\n/).filter(Boolean);
  if (!headerLine) return [];
  const headers = parseCsvLine(headerLine);
  return lines.map(parseCsvLine).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])) as InstrumentRow);
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}
