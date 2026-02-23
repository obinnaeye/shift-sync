import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  FRONTEND_URL: z.url().default("http://localhost:5173"),
  DEV_FRONTEND_URLS: z.string().optional(),
  DISABLE_RATE_LIMIT: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

export const env = envSchema.parse(process.env);

export const isProd = env.NODE_ENV === "production";
