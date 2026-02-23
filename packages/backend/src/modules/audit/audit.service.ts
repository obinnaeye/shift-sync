import { Prisma, type PrismaClient } from "@prisma/client";

type TxClient = Prisma.TransactionClient | PrismaClient;

type AuditInput = {
  actorId: string;
  entityType: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  shiftId?: string | null;
};

function toNullableJson(value: unknown) {
  if (value === null || value === undefined) {
    return Prisma.JsonNull;
  }
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function writeAuditLog(tx: TxClient, input: AuditInput) {
  return tx.auditLog.create({
    data: {
      actorId: input.actorId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      before: toNullableJson(input.before),
      after: toNullableJson(input.after),
      reason: input.reason ?? null,
      shiftId: input.shiftId ?? null,
    },
  });
}
