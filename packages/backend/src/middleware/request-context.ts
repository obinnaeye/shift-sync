import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  req.correlationId = randomUUID();
  res.setHeader("X-Correlation-Id", req.correlationId);
  next();
}

export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startedAt = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    console.log(
      JSON.stringify({
        level: "info",
        ts: new Date().toISOString(),
        correlationId: req.correlationId,
        userId: req.user?.id ?? null,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs,
      }),
    );
  });

  next();
}
