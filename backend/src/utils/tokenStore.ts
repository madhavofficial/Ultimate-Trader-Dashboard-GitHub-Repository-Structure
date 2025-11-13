import crypto from 'crypto';

interface RefreshTokenRecord {
  userId: string;
  tokenHash: string; // store hash only
  expiresAt: number;
}

const refreshTokenStore = new Map<string, RefreshTokenRecord>();

export function storeRefreshToken(id: string, record: RefreshTokenRecord) {
  refreshTokenStore.set(id, record);
}

export function getRefreshTokenRecord(id: string) {
  return refreshTokenStore.get(id);
}

export function revokeRefreshToken(id: string) {
  refreshTokenStore.delete(id);
}

export function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function rotateId() {
  return crypto.randomBytes(16).toString('hex');
}