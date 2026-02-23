import type { Server as HttpServer } from "node:http";
import { Role } from "@prisma/client";
import { createAdapter } from "@socket.io/redis-adapter";
import { Server } from "socket.io";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { verifyAccessToken } from "../modules/auth/token.utils.js";

type SocketUserData = {
  userId: string;
  role: Role;
};

let io: Server | null = null;

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/+$/, "");
}

const devFrontendAllowlist = new Set(
  (env.DEV_FRONTEND_URLS ?? "")
    .split(",")
    .map((value) => normalizeOrigin(value.trim()))
    .filter(Boolean),
);
const frontendOrigin = normalizeOrigin(env.FRONTEND_URL);

async function ensureRedisReady(client: ReturnType<typeof redis.duplicate>): Promise<void> {
  if (client.status === "wait") {
    await client.connect();
    return;
  }
  if (client.status === "ready") {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const onReady = () => {
      client.off("error", onError);
      resolve();
    };
    const onError = (error: unknown) => {
      client.off("ready", onReady);
      reject(error);
    };
    client.once("ready", onReady);
    client.once("error", onError);
  });
}

async function resolveAccessibleLocationIds(
  userId: string,
  role: Role,
  requestedLocationIds: string[],
): Promise<string[]> {
  if (requestedLocationIds.length > 0) {
    const requestedSet = new Set(requestedLocationIds);
    if (role === Role.ADMIN) {
      const locations = await prisma.location.findMany({
        where: { id: { in: [...requestedSet] } },
        select: { id: true },
      });
      return locations.map((location) => location.id);
    }
    if (role === Role.MANAGER) {
      const managed = await prisma.locationManager.findMany({
        where: { userId, locationId: { in: [...requestedSet] } },
        select: { locationId: true },
      });
      return managed.map((location) => location.locationId);
    }
    const certifications = await prisma.locationCertification.findMany({
      where: {
        userId,
        revokedAt: null,
        locationId: { in: [...requestedSet] },
      },
      select: { locationId: true },
    });
    return certifications.map((location) => location.locationId);
  }

  if (role === Role.ADMIN) {
    const locations = await prisma.location.findMany({ select: { id: true } });
    return locations.map((location) => location.id);
  }
  if (role === Role.MANAGER) {
    const managed = await prisma.locationManager.findMany({
      where: { userId },
      select: { locationId: true },
    });
    return managed.map((location) => location.locationId);
  }

  const certifications = await prisma.locationCertification.findMany({
    where: { userId, revokedAt: null },
    select: { locationId: true },
  });
  return certifications.map((location) => location.locationId);
}

export async function initSocketServer(httpServer: HttpServer): Promise<Server> {
  if (io) {
    return io;
  }

  const pubClient = redis.duplicate();
  const subClient = redis.duplicate();
  await Promise.all([ensureRedisReady(pubClient), ensureRedisReady(subClient)]);

  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        const normalizedOrigin = normalizeOrigin(origin);
        if (normalizedOrigin === frontendOrigin) {
          callback(null, true);
          return;
        }
        if (env.NODE_ENV !== "production" && devFrontendAllowlist.has(normalizedOrigin)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      credentials: true,
    },
  });

  io.adapter(createAdapter(pubClient, subClient));

  io.use((socket, next) => {
    const authToken = socket.handshake.auth?.token;
    const headerToken = socket.handshake.headers.authorization;
    const bearerToken =
      typeof headerToken === "string" && headerToken.startsWith("Bearer ")
        ? headerToken.slice("Bearer ".length)
        : undefined;
    const token = (typeof authToken === "string" ? authToken : bearerToken) ?? "";

    if (!token) {
      next(new Error("Socket auth token is required"));
      return;
    }

    try {
      const payload = verifyAccessToken(token);
      if (payload.typ !== "access") {
        next(new Error("Invalid socket token type"));
        return;
      }
      socket.data.user = { userId: payload.sub, role: payload.role } satisfies SocketUserData;
      next();
    } catch {
      next(new Error("Invalid or expired socket token"));
    }
  });

  io.on("connection", (socket) => {
    const user = socket.data.user as SocketUserData;
    socket.join(`user:${user.userId}`);
    if (user.role === Role.ADMIN) {
      socket.join("admin");
    }

    void (async () => {
      const locationIds = await resolveAccessibleLocationIds(user.userId, user.role, []);
      locationIds.forEach((locationId) => socket.join(`location:${locationId}`));
    })();

    socket.on("rooms:join", async (payload?: { locationIds?: string[] }) => {
      const requested =
        payload?.locationIds?.filter((locationId): locationId is string => typeof locationId === "string") ??
        [];
      const uniqueRequested = [...new Set(requested)];
      const allowed = await resolveAccessibleLocationIds(user.userId, user.role, uniqueRequested);
      allowed.forEach((locationId) => socket.join(`location:${locationId}`));
    });
  });

  return io;
}

function socket(): Server | null {
  return io;
}

export function emitLocationEvent(event: string, locationId: string, payload: unknown): void {
  socket()?.to(`location:${locationId}`).emit(event, payload);
}

export function emitUserEvent(event: string, userId: string, payload: unknown): void {
  socket()?.to(`user:${userId}`).emit(event, payload);
}

export function emitManyUsersEvent(event: string, userIds: string[], payload: unknown): void {
  [...new Set(userIds)].forEach((userId) => {
    emitUserEvent(event, userId, payload);
  });
}

