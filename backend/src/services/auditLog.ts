import { Prisma } from "@prisma/client";
import { prisma } from "../db/client";

export async function writeAuditLog(input: {
  userId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
  request?: { ip?: string; socket?: { remoteAddress?: string }; headers: Record<string, string | string[] | undefined> };
}) {
  try {
    const forwardedFor = input.request?.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim();
    const ipAddress = forwardedFor || input.request?.socket?.remoteAddress || input.request?.ip;
    await prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata,
        ipAddress,
        userAgent: input.request?.headers["user-agent"]?.toString(),
      },
    });
  } catch (error) {
    console.error("Failed to write audit log", error);
  }
}
