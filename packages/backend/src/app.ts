import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { prisma } from "./lib/prisma.js";
import { redis } from "./lib/redis.js";
import {
  correlationIdMiddleware,
  requestLoggerMiddleware,
} from "./middleware/request-context.js";
import { shiftsRouter } from "./modules/shifts/shifts.routes.js";
import { schedulesRouter } from "./modules/schedules/schedules.routes.js";
import { assignmentsRouter } from "./modules/assignments/assignments.routes.js";
import { swapRequestsRouter } from "./modules/swap-requests/swap-requests.routes.js";
import { analyticsRouter } from "./modules/analytics/analytics.routes.js";
import { locationsRouter } from "./modules/locations/locations.routes.js";
import { usersRouter } from "./modules/users/users.routes.js";
import { skillsRouter } from "./modules/skills/skills.routes.js";
import { auditRouter } from "./modules/audit/audit.routes.js";

export const app = express();

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

app.use(
  cors({
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
  }),
);
app.use(express.json());
app.use(cookieParser());
app.use(correlationIdMiddleware);
app.use(requestLoggerMiddleware);

// In non-production environments DISABLE_RATE_LIMIT=true skips all rate
// limiting so E2E test suites can run without exhausting the login window.
// The rate-limit contract is still verified by API-003 which must be run
// with DISABLE_RATE_LIMIT unset (or =false) in an isolated CI step.
const skipRateLimit = (_req: import("express").Request) => Boolean(env.DISABLE_RATE_LIMIT);

app.use(
  "/api/v1/auth/login",
  rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipRateLimit,
  }),
);

app.use(
  "/api/v1",
  rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === "/auth/login" || skipRateLimit(req),
  }),
);

app.get("/healthz", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/readyz", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await redis.ping();
    res.status(200).json({ status: "ready" });
  } catch {
    res.status(503).json({ status: "not_ready" });
  }
});

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/shifts", shiftsRouter);
app.use("/api/v1/shifts", assignmentsRouter);
app.use("/api/v1/schedules", schedulesRouter);
app.use("/api/v1/swap-requests", swapRequestsRouter);
app.use("/api/v1/analytics", analyticsRouter);
app.use("/api/v1/locations", locationsRouter);
app.use("/api/v1/users", usersRouter);
app.use("/api/v1/skills", skillsRouter);
app.use("/api/v1/audit-logs", auditRouter);

app.use((_req, res) => {
  res.status(404).json({ message: "Not found" });
});
