import { AssignmentStatus, Role, ShiftStatus } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { authenticate } from "../../middleware/authenticate.js";
import { hasLocationAccess } from "../../middleware/require-location-access.js";
import { requireRole } from "../../middleware/require-role.js";

export const locationsRouter = Router();
locationsRouter.use(authenticate);

locationsRouter.get("/", async (req, res) => {
  const user = req.user!;

  if (user.role === Role.ADMIN) {
    const locations = await prisma.location.findMany({ orderBy: { name: "asc" } });
    res.status(200).json({ locations });
    return;
  }

  if (user.role === Role.MANAGER) {
    const locations = await prisma.location.findMany({
      where: { managers: { some: { userId: user.id } } },
      orderBy: { name: "asc" },
    });
    res.status(200).json({ locations });
    return;
  }

  const locations = await prisma.location.findMany({
    where: {
      certifications: {
        some: {
          userId: user.id,
          revokedAt: null,
        },
      },
    },
    orderBy: { name: "asc" },
  });
  res.status(200).json({ locations });
});

locationsRouter.get("/:id/on-duty", requireRole([Role.ADMIN, Role.MANAGER]), async (req, res) => {
  const locationId = String(req.params.id);
  const allowed = await hasLocationAccess(req.user!.id, req.user!.role, locationId);
  if (!allowed) {
    res.status(403).json({ message: "Forbidden for location" });
    return;
  }

  const now = new Date();
  const assignments = await prisma.shiftAssignment.findMany({
    where: {
      status: AssignmentStatus.CONFIRMED,
      shift: {
        locationId,
        status: ShiftStatus.PUBLISHED,
        startTime: { lte: now },
        endTime: { gt: now },
      },
    },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      },
      shift: {
        select: {
          id: true,
          startTime: true,
          endTime: true,
          locationId: true,
        },
      },
    },
    orderBy: { shiftStartTime: "asc" },
  });

  res.status(200).json({
    locationId,
    asOf: now.toISOString(),
    onDuty: assignments,
  });
});

