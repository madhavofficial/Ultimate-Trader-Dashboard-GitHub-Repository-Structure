import crypto from "crypto";
import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../db/client";
import { env } from "../config/env";
import { AppError } from "../errors/appError";
import { writeAuditLog } from "../services/auditLog";

const router = Router();
const BCRYPT_ROUNDS = 12;
const REFRESH_COOKIE = "refresh_token";

const registerSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  password: z.string().min(8).refine(
    (value) => /[A-Z]/.test(value) && /[0-9]/.test(value) && /[^A-Za-z0-9]/.test(value),
    { message: "Password must have upper, number and symbol" },
  ),
});
const loginSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  password: z.string().min(1),
});

const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 6,
  message: { error: "Too many attempts, try again later" },
});

router.use(cookieParser());

function issueAccessToken(user: { id: string; email: string }) {
  return jwt.sign({ email: user.email }, env.JWT_ACCESS_SECRET, { subject: user.id, expiresIn: "15m" });
}

function issueRefreshToken(user: { id: string; email: string }) {
  return jwt.sign({ email: user.email }, env.JWT_REFRESH_SECRET, { subject: user.id, expiresIn: "7d" });
}

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

router.post("/register", authLimiter, async (req, res, next) => {
  try {
    const parsed = registerSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: parsed.email } });
    if (existing) throw new AppError(409, "Email already registered");

    const user = await prisma.user.create({
      data: { email: parsed.email, passwordHash: await bcrypt.hash(parsed.password, BCRYPT_ROUNDS) },
      select: { id: true, email: true },
    });
    await writeAuditLog({ userId: user.id, action: "REGISTER", entityType: "User", entityId: user.id, request: req });
    return res.status(201).json({ ok: true, user });
  } catch (error) {
    return next(error);
  }
});

router.post("/login", authLimiter, async (req, res, next) => {
  try {
    const parsed = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: parsed.email } });
    if (!user || !(await bcrypt.compare(parsed.password, user.passwordHash))) {
      throw new AppError(401, "Invalid credentials");
    }

    const refreshToken = issueRefreshToken(user);
    await prisma.refreshToken.create({
      data: { tokenHash: hashToken(refreshToken), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), userId: user.id },
    });
    res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions());
    await writeAuditLog({ userId: user.id, action: "LOGIN", entityType: "User", entityId: user.id, request: req });
    return res.json({ accessToken: issueAccessToken(user) });
  } catch (error) {
    return next(error);
  }
});

router.post("/refresh", async (req, res, next) => {
  try {
    const rawToken = req.cookies?.[REFRESH_COOKIE];
    if (!rawToken) throw new AppError(401, "No refresh token");

    const record = await prisma.refreshToken.findFirst({
      where: { tokenHash: hashToken(rawToken), revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!record) throw new AppError(401, "Invalid refresh token");

    const payload = jwt.verify(rawToken, env.JWT_REFRESH_SECRET) as jwt.JwtPayload;
    if (payload.sub !== record.userId) throw new AppError(401, "Invalid refresh token");

    const newRefreshToken = issueRefreshToken(record.user);
    await prisma.$transaction([
      prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } }),
      prisma.refreshToken.create({
        data: { tokenHash: hashToken(newRefreshToken), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), userId: record.userId },
      }),
    ]);
    res.cookie(REFRESH_COOKIE, newRefreshToken, refreshCookieOptions());
    return res.json({ accessToken: issueAccessToken(record.user) });
  } catch (error) {
    return next(error);
  }
});

router.post("/logout", async (req, res, next) => {
  try {
    const rawToken = req.cookies?.[REFRESH_COOKIE];
    if (rawToken) {
      await prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(rawToken), revokedAt: null }, data: { revokedAt: new Date() } });
    }
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export default router;
