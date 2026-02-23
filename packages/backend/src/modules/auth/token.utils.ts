import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import type { AccessTokenPayload, RefreshTokenPayload } from "./auth.types.js";

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export function signAccessToken(payload: Omit<AccessTokenPayload, "typ">): string {
  return jwt.sign(
    { ...payload, typ: "access" satisfies AccessTokenPayload["typ"] },
    env.JWT_ACCESS_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
  );
}

export function signRefreshToken(payload: Omit<RefreshTokenPayload, "typ">): string {
  return jwt.sign(
    { ...payload, typ: "refresh" satisfies RefreshTokenPayload["typ"] },
    env.JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_TOKEN_TTL_SECONDS },
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
}

export function generateOpaqueToken(size = 32): string {
  return crypto.randomBytes(size).toString("hex");
}

export function hashCsrfToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
