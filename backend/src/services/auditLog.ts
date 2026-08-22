import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";

export async function writeAuditLog(input: {
  userId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
  request?: { ip?: string; headers: Record<string, string | string[] | undefined> };
}) {
  await prisma.auditLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata,
      ipAddress: input.request?.ip,
      userAgent: input.request?.headers["user-agent"]?.toString(),
    },
  });
}
