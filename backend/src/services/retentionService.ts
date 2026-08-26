import { prisma } from "../db/client";

export async function runDatabaseRetentionCleanup() {
  const now = new Date();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [expiredTokens, oldJobs, staleEvents] = await Promise.all([
    // Delete expired or revoked refresh tokens
    prisma.refreshToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: now } },
          { revokedAt: { not: null } },
        ],
      },
    }),
    // Delete completed background jobs older than 7 days
    prisma.job.deleteMany({
      where: {
        status: "COMPLETED",
        updatedAt: { lt: sevenDaysAgo },
      },
    }),
    // Delete processed market events older than 30 days
    prisma.event.deleteMany({
      where: {
        status: "PROCESSED",
        occurredAt: { lt: thirtyDaysAgo },
      },
    }),
  ]);

  return {
    deletedTokens: expiredTokens.count,
    deletedJobs: oldJobs.count,
    deletedEvents: staleEvents.count,
  };
}

export function startRetentionScheduler(intervalMs = 24 * 60 * 60 * 1000) {
  const timer = setInterval(() => {
    runDatabaseRetentionCleanup().catch((err) => console.error("Database retention cleanup error:", err));
  }, intervalMs);

  return () => clearInterval(timer);
}
