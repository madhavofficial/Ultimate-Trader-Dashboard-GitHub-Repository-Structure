import crypto from "crypto";
import jwt from "jsonwebtoken";
import { KiteConnect } from "kiteconnect";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import { env } from "../config/env";
import { AppError } from "../errors/appError";

const PROVIDER = "ZERODHA";

function kiteConfig() {
  if (!env.KITE_API_KEY || !env.KITE_API_SECRET || !env.KITE_REDIRECT_URL || !env.KITE_TOKEN_ENCRYPTION_KEY) {
    throw new AppError(503, "Zerodha integration is not configured");
  }
  return {
    apiKey: env.KITE_API_KEY,
    apiSecret: env.KITE_API_SECRET,
    redirectUrl: env.KITE_REDIRECT_URL,
    encryptionKey: Buffer.from(env.KITE_TOKEN_ENCRYPTION_KEY, "hex"),
  };
}

export function createKiteLoginUrl(userId: string) {
  const config = kiteConfig();
  const state = jwt.sign({ purpose: "kite-oauth", userId }, env.JWT_ACCESS_SECRET, { expiresIn: "10m" });
  const client = new KiteConnect({ api_key: config.apiKey });
  const loginUrl = new URL(client.getLoginURL());
  loginUrl.searchParams.set("redirect_params", new URLSearchParams({ state }).toString());
  return loginUrl.toString();
}

export async function completeKiteLogin(state: string, requestToken: string) {
  const config = kiteConfig();
  const payload = jwt.verify(state, env.JWT_ACCESS_SECRET) as jwt.JwtPayload & { purpose?: string; userId?: string };
  if (payload.purpose !== "kite-oauth" || !payload.userId) throw new AppError(401, "Invalid broker login state");

  const client = new KiteConnect({ api_key: config.apiKey });
  const session = await client.generateSession(requestToken, config.apiSecret);
  client.setAccessToken(session.access_token);
  const profile = await client.getProfile();
  await prisma.brokerSession.upsert({
    where: { userId_provider: { userId: payload.userId, provider: PROVIDER } },
    update: {
      brokerUserId: session.user_id,
      accessTokenEncrypted: encryptToken(session.access_token, config.encryptionKey),
      profile: profile as unknown as Prisma.InputJsonValue,
      expiresAt: nextKiteExpiry(),
    },
    create: {
      userId: payload.userId,
      provider: PROVIDER,
      brokerUserId: session.user_id,
      accessTokenEncrypted: encryptToken(session.access_token, config.encryptionKey),
      profile: profile as unknown as Prisma.InputJsonValue,
      expiresAt: nextKiteExpiry(),
    },
  });

  return { userId: payload.userId, brokerUserId: session.user_id };
}

export async function getKiteClient(userId: string) {
  const { apiKey, accessToken } = await getKiteTickerCredentials(userId);

  const client = new KiteConnect({ api_key: apiKey });
  client.setAccessToken(accessToken);
  return client;
}

export async function getKiteTickerCredentials(userId: string) {
  const config = kiteConfig();
  const session = await prisma.brokerSession.findUnique({ where: { userId_provider: { userId, provider: PROVIDER } } });
  if (!session || (session.expiresAt && session.expiresAt <= new Date())) {
    throw new AppError(401, "Zerodha session is missing or expired");
  }
  return { apiKey: config.apiKey, accessToken: decryptToken(session.accessTokenEncrypted, config.encryptionKey) };
}

export async function syncKiteHoldings(userId: string) {
  return (await syncKiteAccount(userId)).holdings;
}

export async function syncKiteAccount(userId: string) {
  const client = await getKiteClient(userId);
  const [profile, holdings, positionsResponse] = await Promise.all([client.getProfile(), client.getHoldings(), client.getPositions()]);
  const positions = positionsResponse.net ?? [];
  const session = await prisma.brokerSession.findUniqueOrThrow({ where: { userId_provider: { userId, provider: PROVIDER } } });

  await prisma.$transaction(async (tx) => {
    await tx.brokerSession.update({ where: { id: session.id }, data: { profile: profile as unknown as Prisma.InputJsonValue } });
    await tx.holding.deleteMany({ where: { userId } });
    if (holdings.length > 0) {
      await tx.holding.createMany({
        data: holdings.map((holding) => ({
          userId,
          symbol: holding.tradingsymbol,
          qty: holding.quantity,
          avg: holding.average_price,
        })),
      });
    }
    await tx.position.deleteMany({ where: { userId } });
    if (positions.length > 0) {
      await tx.position.createMany({
        data: positions.map((position) => ({
          userId,
          exchange: position.exchange,
          symbol: position.tradingsymbol,
          product: position.product,
          instrumentToken: position.instrument_token,
          quantity: position.quantity,
          averagePrice: new Prisma.Decimal(position.average_price),
          lastPrice: new Prisma.Decimal(position.last_price),
          pnl: new Prisma.Decimal(position.pnl),
          m2m: new Prisma.Decimal(position.m2m),
          unrealized: new Prisma.Decimal(position.unrealised),
          realized: new Prisma.Decimal(position.realised),
        })),
      });
    }
  });

  return { profile, holdings, positions };
}

function encryptToken(token: string, key: Buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv.toString("hex"), cipher.getAuthTag().toString("hex"), encrypted.toString("hex")].join(".");
}

function decryptToken(value: string, key: Buffer) {
  const [ivHex, tagHex, encryptedHex] = value.split(".");
  if (!ivHex || !tagHex || !encryptedHex) throw new AppError(500, "Invalid stored broker session");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedHex, "hex")), decipher.final()]).toString("utf8");
}

function nextKiteExpiry() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000);
}
