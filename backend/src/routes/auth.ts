import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { hashToken, rotateId, storeRefreshToken, getRefreshTokenRecord, revokeRefreshToken } from '../utils/tokenStore';

const router = Router();

// Use a strong bcrypt cost
const BCRYPT_ROUNDS = 12;

// In-memory user store (replace with DB later)
const users = new Map<string, { id: string; email: string; passwordHash: string }>();

// validators
const registerSchema = z.object({ email: z.string().email(), password: z.string().min(8).refine(p => /[A-Z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p), { message: 'Password must have upper, number and symbol' }) });
const loginSchema = z.object({ email: z.string().email(), password: z.string() });

// rate limiter for auth routes
const authLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 6, message: { error: 'Too many attempts, try again later' } });

router.use(cookieParser());

// Register
router.post('/register', authLimiter, async (req, res) => {
  try {
    const parsed = registerSchema.parse(req.body);
    const existing = Array.from(users.values()).find(u => u.email === parsed.email);
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const id = uuidv4();
    const hash = await bcrypt.hash(parsed.password, BCRYPT_ROUNDS);
    users.set(id, { id, email: parsed.email, passwordHash: hash });

    return res.json({ ok: true, id });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Invalid input' });
  }
});

// Login
router.post('/login', authLimiter, async (req, res) => {
  try {
    const parsed = loginSchema.parse(req.body);
    const userEntry = Array.from(users.values()).find(u => u.email === parsed.email);
    if (!userEntry) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(parsed.password, userEntry.passwordHash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    // create tokens
    const accessToken = jwt.sign({ email: userEntry.email }, process.env.JWT_ACCESS_SECRET as string, { subject: userEntry.id, expiresIn: '15m' });
    const refreshToken = jwt.sign({ email: userEntry.email }, process.env.JWT_REFRESH_SECRET as string, { subject: userEntry.id, expiresIn: '7d' });

    // store a hash of the refresh token and rotate id
    const rid = rotateId();
    const tokenHash = hashToken(refreshToken);
    storeRefreshToken(rid, { userId: userEntry.id, tokenHash, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 });

    // Set secure httpOnly cookie for refresh token id
    res.cookie('rtid', rid, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });

    return res.json({ accessToken });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Invalid input' });
  }
});

// Refresh endpoint
router.post('/refresh', async (req, res) => {
  try {
    const rid = req.cookies?.rtid;
    if (!rid) return res.status(401).json({ error: 'No refresh token' });

    const record = getRefreshTokenRecord(rid);
    if (!record) return res.status(401).json({ error: 'Invalid refresh token' });

    // read raw refresh token from Authorization header (rotate on client) or cookie (client can store token outside cookie)
    const rawToken = req.headers['x-refresh-token'] as string | undefined;
    if (!rawToken) return res.status(400).json({ error: 'Missing raw refresh token in header' });

    const tokenHash = hashToken(rawToken);
    if (tokenHash !== record.tokenHash) {
      // possible theft or mismatch
      revokeRefreshToken(rid);
      return res.status(401).json({ error: 'Refresh token mismatch' });
    }

    // verify token signature
    const payload = jwt.verify(rawToken, process.env.JWT_REFRESH_SECRET as string) as any;
    const userId = payload.sub as string;

    // rotate: issue new refresh token and replace store
    const newRefreshToken = jwt.sign({ email: payload.email }, process.env.JWT_REFRESH_SECRET as string, { subject: userId, expiresIn: '7d' });
    const newRid = rotateId();
    storeRefreshToken(newRid, { userId, tokenHash: hashToken(newRefreshToken), expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 });
    revokeRefreshToken(rid);

    // issue new access token
    const accessToken = jwt.sign({ email: payload.email }, process.env.JWT_ACCESS_SECRET as string, { subject: userId, expiresIn: '15m' });

    res.cookie('rtid', newRid, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });

    return res.json({ accessToken });
  } catch (err: any) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  try {
    const rid = req.cookies?.rtid;
    if (rid) revokeRefreshToken(rid as string);
    res.clearCookie('rtid');
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Logout failed' });
  }
});

export default router;