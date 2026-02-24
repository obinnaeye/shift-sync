import { Redis } from "ioredis";
import { env } from "../config/env.js";

const redisUrl = env.REDIS_URL;
const isTls = redisUrl.startsWith("rediss://");

// Upstash requires TLS — enforce rediss:// in production
if (env.NODE_ENV === "production" && !isTls) {
  console.error(
    "[redis] FATAL: REDIS_URL must start with rediss:// in production (TLS required by Upstash). Got:",
    redisUrl.slice(0, 20) + "...",
  );
  process.exit(1);
}

export const redis = new Redis(redisUrl, {
  // Required for Upstash serverless Redis — disables the CLIENT INFO
  // ready-check that Upstash resets, causing ECONNRESET on connect
  enableReadyCheck: false,
  // Explicit TLS for rediss:// connections; rejectUnauthorized:false
  // avoids cert-chain issues on some Upstash regions
  tls: isTls ? { rejectUnauthorized: false } : undefined,
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    if (times > 5) {
      console.error("[redis] Giving up after 5 connection attempts — check REDIS_URL");
      return null;
    }
    return Math.min(times * 300, 3000);
  },
});

redis.on("error", (err: Error) => {
  console.error("[redis]", err.message);
});

redis.on("connect", () => {
  console.log("[redis] Connected");
});
