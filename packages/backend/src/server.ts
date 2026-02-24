import { createServer } from "node:http";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { redis } from "./lib/redis.js";
import { app } from "./app.js";
import { initDropExpiryWorker } from "./jobs/drop-expiry.worker.js";
import { initSocketServer } from "./realtime/socket.js";

async function bootstrap() {
  await prisma.$connect();
  // Ping Redis but don't crash if it's momentarily unavailable on startup;
  // ioredis will reconnect automatically and the /readyz endpoint tracks health.
  await redis.ping().catch((err: Error) => {
    console.warn("[redis] Initial ping failed, will retry automatically:", err.message);
  });
  const httpServer = createServer(app);
  await initSocketServer(httpServer);
  await initDropExpiryWorker();

  httpServer.listen(env.PORT, () => {
    const baseUrl = `http://localhost:${env.PORT}`;
    console.log(
      JSON.stringify({
        level: "info",
        ts: new Date().toISOString(),
        correlationId: "startup",
        message: `backend listening on ${baseUrl}`,
        url: baseUrl,
        apiBaseUrl: `${baseUrl}/api/v1`,
      }),
    );
  });
}

bootstrap().catch(async (err) => {
  console.error(
    JSON.stringify({
      level: "error",
      ts: new Date().toISOString(),
      correlationId: "startup",
      message: "Failed to start backend",
      error: err instanceof Error ? err.message : String(err),
    }),
  );
  await prisma.$disconnect().catch(() => {});
  redis.disconnect();
  process.exit(1);
});
