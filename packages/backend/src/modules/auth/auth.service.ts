import type { User } from "@prisma/client";
import { redis } from "../../lib/redis.js";
import {
  generateOpaqueToken,
  hashCsrfToken,
  REFRESH_TOKEN_TTL_SECONDS,
  signAccessToken,
  signRefreshToken,
} from "./token.utils.js";

type RefreshSessionRecord = {
  sid: string;
  fid: string;
  userId: string;
  csrfHash: string;
};

function refreshSessionKey(sid: string): string {
  return `auth:rt:session:${sid}`;
}

function refreshFamilyKey(fid: string): string {
  return `auth:rt:family:${fid}`;
}

function familyRevokedKey(fid: string): string {
  return `auth:rt:family:revoked:${fid}`;
}

async function addSessionToFamily(fid: string, sid: string): Promise<void> {
  const key = refreshFamilyKey(fid);
  await redis.sadd(key, sid);
  await redis.expire(key, REFRESH_TOKEN_TTL_SECONDS);
}

export async function issueAuthTokens(user: Pick<User, "id" | "role">, familyId?: string) {
  const sid = generateOpaqueToken(16);
  const fid = familyId ?? generateOpaqueToken(16);
  const csrfToken = generateOpaqueToken(20);

  const accessToken = signAccessToken({ sub: user.id, role: user.role });
  const refreshToken = signRefreshToken({ sub: user.id, role: user.role, sid, fid });

  const session: RefreshSessionRecord = {
    sid,
    fid,
    userId: user.id,
    csrfHash: hashCsrfToken(csrfToken),
  };

  await redis.set(
    refreshSessionKey(sid),
    JSON.stringify(session),
    "EX",
    REFRESH_TOKEN_TTL_SECONDS,
  );
  await addSessionToFamily(fid, sid);

  return { accessToken, refreshToken, csrfToken, sid, fid };
}

export async function getRefreshSession(sid: string): Promise<RefreshSessionRecord | null> {
  const raw = await redis.get(refreshSessionKey(sid));
  if (!raw) {
    return null;
  }
  return JSON.parse(raw) as RefreshSessionRecord;
}

export async function isFamilyRevoked(fid: string): Promise<boolean> {
  return (await redis.exists(familyRevokedKey(fid))) === 1;
}

export async function revokeFamily(fid: string): Promise<void> {
  const members = await redis.smembers(refreshFamilyKey(fid));
  if (members.length > 0) {
    const keys = members.map((sid: string) => refreshSessionKey(sid));
    await redis.del(...keys);
  }
  await redis.set(familyRevokedKey(fid), "1", "EX", REFRESH_TOKEN_TTL_SECONDS);
}

export async function rotateRefreshSession(opts: {
  sid: string;
  fid: string;
  user: Pick<User, "id" | "role">;
}) {
  await redis.del(refreshSessionKey(opts.sid));
  return issueAuthTokens(opts.user, opts.fid);
}

export function csrfMatches(inputCsrf: string, storedHash: string): boolean {
  return hashCsrfToken(inputCsrf) === storedHash;
}
