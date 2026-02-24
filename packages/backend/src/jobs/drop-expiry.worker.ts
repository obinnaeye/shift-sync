import { Queue, Worker } from "bullmq";
import { Role, SwapStatus, SwapType } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { emitLocationEvent } from "../realtime/socket.js";
import { writeAuditLog } from "../modules/audit/audit.service.js";

const QUEUE_NAME = "drop-expiry";
const POLL_JOB_NAME = "poll-open-drops";
const SYSTEM_EXPIRE_REASON = "Auto-expired by BullMQ worker";

const redisUrl = new URL(env.REDIS_URL);
const isTls = env.REDIS_URL.startsWith("rediss://");
const redisConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  db: redisUrl.pathname ? Number(redisUrl.pathname.slice(1) || "0") : 0,
  // Required for BullMQ + Upstash: null = no request timeout (long-poll jobs)
  maxRetriesPerRequest: null as null,
  // Required for Upstash serverless Redis
  enableReadyCheck: false,
  // TLS for rediss:// connections
  tls: isTls ? { rejectUnauthorized: false } : undefined,
};

const queue = new Queue(QUEUE_NAME, { connection: redisConnection });
let worker: Worker | null = null;
let systemActorId: string | null = null;

async function getSystemActorId(): Promise<string | null> {
  if (systemActorId) return systemActorId;
  const actor = await prisma.user.findFirst({
    where: { role: Role.ADMIN, isActive: true },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  systemActorId = actor?.id ?? null;
  return systemActorId;
}

async function expireOpenDrops(): Promise<void> {
  const now = new Date();
  const expiredCandidates = await prisma.swapRequest.findMany({
    where: {
      type: SwapType.DROP,
      status: SwapStatus.OPEN,
      expiresAt: { lte: now },
    },
    include: {
      assignment: {
        include: {
          shift: {
            select: {
              id: true,
              locationId: true,
            },
          },
        },
      },
    },
  });
  if (expiredCandidates.length === 0) return;

  const actorId = await getSystemActorId();

  for (const request of expiredCandidates) {
    await prisma.$transaction(async (tx) => {
      const latest = await tx.swapRequest.findUnique({ where: { id: request.id } });
      if (!latest || latest.status !== SwapStatus.OPEN) return;

      const updated = await tx.swapRequest.update({
        where: { id: request.id },
        data: {
          status: SwapStatus.EXPIRED,
          managerNote: SYSTEM_EXPIRE_REASON,
        },
      });

      if (actorId) {
        await writeAuditLog(tx, {
          actorId,
          entityType: "SwapRequest",
          entityId: request.id,
          action: "EXPIRE",
          before: latest,
          after: updated,
          shiftId: request.assignment.shiftId,
          reason: SYSTEM_EXPIRE_REASON,
        });
      }
    });

    emitLocationEvent("drop:expired", request.assignment.shift.locationId, {
      swapRequestId: request.id,
      shiftId: request.assignment.shift.id,
      locationId: request.assignment.shift.locationId,
      reason: SYSTEM_EXPIRE_REASON,
    });
  }
}

export async function initDropExpiryWorker(): Promise<void> {
  if (worker) return;

  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      if (job.name !== POLL_JOB_NAME) return;
      await expireOpenDrops();
    },
    {
      connection: redisConnection,
      concurrency: 1,
    },
  );

  await queue.add(
    POLL_JOB_NAME,
    {},
    {
      jobId: POLL_JOB_NAME,
      repeat: { every: 30_000 },
      removeOnComplete: true,
      removeOnFail: 25,
    },
  );
}

