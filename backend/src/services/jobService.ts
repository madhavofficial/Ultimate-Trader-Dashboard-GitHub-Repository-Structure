import { Prisma } from "@prisma/client";
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
