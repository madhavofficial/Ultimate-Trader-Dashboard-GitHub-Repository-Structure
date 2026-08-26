import { Job, Prisma } from "@prisma/client";
import { prisma } from "../db/client";

export function enqueueJob(type: string, payload?: Prisma.InputJsonValue, runAt = new Date()) {
  return prisma.job.create({ data: { type, payload, runAt } });
}

export function recordEvent(input: {
  type: string;
  source: string;
  externalId?: string;
  payload: Prisma.InputJsonValue;
  occurredAt?: Date;
}) {
  return prisma.event.create({ data: input });
}

/** Claims one due job without allowing concurrent workers to claim the same row. */
export async function claimNextJob(workerId: string, type?: string): Promise<Job | null> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Job"
      WHERE "status" = 'PENDING'
        AND "runAt" <= NOW()
        AND (${type ?? null}::text IS NULL OR "type" = ${type ?? null})
      ORDER BY "runAt" ASC, "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;

    const next = rows[0];
    if (!next) return null;

    return tx.job.update({
      where: { id: next.id },
      data: { status: "RUNNING", attempts: { increment: 1 }, lockedAt: new Date(), lockedBy: workerId },
    });
  });
}

export function completeJob(jobId: string) {
  return prisma.job.update({
    where: { id: jobId },
    data: { status: "COMPLETED", completedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null },
  });
}

export async function failJob(jobId: string, error: string, maxAttempts = 3) {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { attempts: true } });
  if (!job) throw new Error(`Job not found: ${jobId}`);

  const exhausted = job.attempts >= maxAttempts;
  return prisma.job.update({
    where: { id: jobId },
    data: {
      status: exhausted ? "FAILED" : "PENDING",
      lastError: error.slice(0, 2000),
      lockedAt: null,
      lockedBy: null,
      ...(exhausted ? { completedAt: new Date() } : { runAt: new Date(Date.now() + 1000) }),
    },
  });
}

export function startJobWorker(
  workerId: string,
  handler: (job: Job) => Promise<void>,
  options: { pollIntervalMs?: number; maxAttempts?: number; type?: string } = {},
) {
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  const maxAttempts = options.maxAttempts ?? 3;
  let stopped = false;

  const poll = async () => {
    if (stopped) return;
    try {
      const job = await claimNextJob(workerId, options.type);
      if (job) {
        try {
          await handler(job);
          await completeJob(job.id);
        } catch (error) {
          await failJob(job.id, error instanceof Error ? error.message : String(error), maxAttempts);
        }
      }
    } catch (error) {
      console.error("Job worker poll failed", error);
    }
    if (!stopped) setTimeout(poll, pollIntervalMs);
  };

  void poll();
  return () => {
    stopped = true;
  };
}
