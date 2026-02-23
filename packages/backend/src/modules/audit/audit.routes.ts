import { Role } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { authenticate } from "../../middleware/authenticate.js";
import { requireRole } from "../../middleware/require-role.js";

export const auditRouter = Router();
auditRouter.use(authenticate);
auditRouter.use(requireRole([Role.ADMIN, Role.MANAGER]));

auditRouter.get("/", async (req, res) => {
  const { locationId, entityType, shiftId, dateFrom, dateTo, limit = "50", page = "1" } = req.query;

  const take = Math.min(Number(limit), 200);
  const skip = (Number(page) - 1) * take;

  const where: Record<string, unknown> = {};
  if (entityType) where.entityType = String(entityType);
  if (shiftId) where.shiftId = String(shiftId);
  if (locationId) where.shiftId = { not: null };
  if (dateFrom || dateTo) {
    where.createdAt = {
      ...(dateFrom ? { gte: new Date(String(dateFrom)) } : {}),
      ...(dateTo ? { lte: new Date(String(dateTo)) } : {}),
    };
  }

  // If locationId filter: only include audit logs for shifts at that location
  let shiftIdsAtLocation: string[] | undefined;
  if (locationId) {
    const shifts = await prisma.shift.findMany({
      where: { locationId: String(locationId) },
      select: { id: true },
    });
    shiftIdsAtLocation = shifts.map((s) => s.id);
    where.shiftId = { in: shiftIdsAtLocation };
  }

  const [logs, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where,
      include: {
        actor: { select: { id: true, firstName: true, lastName: true, role: true } },
        shift: { select: { id: true, startTime: true, endTime: true, location: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take,
      skip,
    }),
    prisma.auditLog.count({ where }),
  ]);

  res.status(200).json({ logs, total, page: Number(page), limit: take });
});
