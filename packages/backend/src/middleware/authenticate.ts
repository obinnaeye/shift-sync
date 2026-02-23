import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../modules/auth/token.utils.js";

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ message: "Missing bearer token" });
    return;
  }

  const token = header.slice("Bearer ".length);
  try {
    const payload = verifyAccessToken(token);
    if (payload.typ !== "access") {
      res.status(401).json({ message: "Invalid token type" });
      return;
    }
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
  }
}
