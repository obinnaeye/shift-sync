import bcrypt from "bcryptjs";
import { Router } from "express";
import { loginRequestSchema } from "@shiftsync/shared";
import { prisma } from "../../lib/prisma.js";
import { authenticate } from "../../middleware/authenticate.js";
import {
  csrfMatches,
  getRefreshSession,
  isFamilyRevoked,
  issueAuthTokens,
  revokeFamily,
  rotateRefreshSession,
} from "./auth.service.js";
import { verifyRefreshToken } from "./token.utils.js";
import { isProd } from "../../config/env.js";

const REFRESH_COOKIE_NAME = "shiftsync_refresh_token";

const refreshCookieOptions = {
  httpOnly: true,
  secure: isProd,
  sameSite: (isProd ? "none" : "lax") as "none" | "lax",
  path: "/",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const parse = loginRequestSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ message: "Invalid request body", errors: parse.error.flatten() });
    return;
  }

  const { email, password } = parse.data;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    res.status(401).json({ message: "Invalid credentials" });
    return;
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ message: "Invalid credentials" });
    return;
  }

  const { accessToken, refreshToken, csrfToken } = await issueAuthTokens(user);
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions);
  res.status(200).json({
    accessToken,
    csrfToken,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    },
  });
});

authRouter.post("/refresh", async (req, res) => {
  const csrfToken = req.header("x-csrf-token");
  if (!csrfToken) {
    res.status(403).json({ message: "Missing CSRF token" });
    return;
  }

  const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
  if (!refreshToken) {
    res.status(401).json({ message: "Missing refresh cookie" });
    return;
  }

  try {
    const payload = verifyRefreshToken(refreshToken);
    if (payload.typ !== "refresh") {
      res.status(401).json({ message: "Invalid token type" });
      return;
    }

    if (await isFamilyRevoked(payload.fid)) {
      res.status(401).json({ message: "Refresh token family revoked" });
      return;
    }

    const session = await getRefreshSession(payload.sid);
    if (!session || session.fid !== payload.fid || session.userId !== payload.sub) {
      await revokeFamily(payload.fid);
      res.status(401).json({ message: "Refresh token reuse detected" });
      return;
    }

    if (!csrfMatches(csrfToken, session.csrfHash)) {
      res.status(403).json({ message: "Invalid CSRF token" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, isActive: true },
    });
    if (!user || !user.isActive) {
      await revokeFamily(payload.fid);
      res.status(401).json({ message: "User not available" });
      return;
    }

    const rotated = await rotateRefreshSession({
      sid: payload.sid,
      fid: payload.fid,
      user,
    });

    res.cookie(REFRESH_COOKIE_NAME, rotated.refreshToken, refreshCookieOptions);
    res.status(200).json({
      accessToken: rotated.accessToken,
      csrfToken: rotated.csrfToken,
    });
  } catch {
    res.status(401).json({ message: "Invalid or expired refresh token" });
  }
});

authRouter.post("/logout", async (req, res) => {
  const csrfToken = req.header("x-csrf-token");
  const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;

  if (!refreshToken) {
    res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions);
    res.status(204).send();
    return;
  }

  if (!csrfToken) {
    res.status(403).json({ message: "Missing CSRF token" });
    return;
  }

  try {
    const payload = verifyRefreshToken(refreshToken);
    const session = await getRefreshSession(payload.sid);
    if (session && !csrfMatches(csrfToken, session.csrfHash)) {
      res.status(403).json({ message: "Invalid CSRF token" });
      return;
    }
    await revokeFamily(payload.fid);
  } catch {
    // Best-effort logout on malformed/expired cookies.
  }

  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions);
  res.status(204).send();
});

authRouter.get("/me", authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      isActive: true,
    },
  });

  if (!user || !user.isActive) {
    res.status(401).json({ message: "User not found or inactive" });
    return;
  }

  res.status(200).json({ user });
});
