import { Redis } from "ioredis";
import { env } from "../config/env.js";

const redisUrl = env.REDIS_URL;

// Upstash (and any remote Redis) requires TLS — enforce rediss:// in production
if (env.NODE_ENV === "production" && !redisUrl.startsWith("rediss://")) {
  console.error(
    "[redis] FATAL: REDIS_URL must start with rediss:// in production (TLS required by Upstash). Got:",
    redisUrl.slice(0, 20) + "...",
  );
  process.exit(1);
}

export const redis = new Redis(redisUrl, {
  // Don't block startup — connection errors are surfaced via the error event
  lazyConnect: false,
  // Upstash requires TLS; the rediss:// scheme enables it automatically in ioredis
  tls: redisUrl.startsWith("rediss://") ? {} : undefined,
  // Limit reconnect noise — crash fast if misconfigured
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    if (times > 5) {
      console.error("[redis] Giving up after 5 connection attempts — check REDIS_URL");
      return null; // stop retrying
    }
    return Math.min(times * 200, 2000);
  },
});

redis.on("error", (err: Error) => {
  console.error("[redis]", err.message);
});

redis.on("connect", () => {
  console.log("[redis] Connected");
});
