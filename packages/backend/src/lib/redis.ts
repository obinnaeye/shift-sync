import { Redis } from "ioredis";
import { env } from "../config/env.js";

export const redis = new Redis(env.REDIS_URL);

redis.on("error", (err) => {
  console.error("[redis]", err);
});
