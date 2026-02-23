import { Role, ShiftStatus } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { authenticate } from "../../middleware/authenticate.js";
import { hasLocationAccess, requireLocationAccess } from "../../middleware/require-location-access.js";
import { requireRole } from "../../middleware/require-role.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { emitLocationEvent } from "../../realtime/socket.js";

export const schedulesRouter = Router();
schedulesRouter.use(authenticate);

schedulesRouter.get("/:locationId/:week", async (req, res) => {
  const locationId = String(req.params.locationId);
  const week = new Date(`${String(req.params.week)}T00:00:00.000Z`);
  const user = req.user!;
  const where: {
    locationId: string;
    scheduleWeek: Date;
    status?: ShiftStatus;
  } = { locationId, scheduleWeek: week };

  if (user.role === Role.MANAGER) {
    const allowed = await hasLocationAccess(user.id, user.role, locationId);
    if (!allowed) {
      res.status(403).json({ message: "Forbidden for location" });
      return;
    }
  }
  if (user.role === Role.STAFF) {
    const cert = await prisma.locationCertification.findUnique({
      where: { userId_locationId: { userId: user.id, locationId } },
    });
    if (!cert || cert.revokedAt) {
      res.status(403).json({ message: "Forbidden for location" });
      return;
    }
    where.status = ShiftStatus.PUBLISHED;
  }

  const shifts = await prisma.shift.findMany({
    where,
    include: { assignments: true, skill: true },
    orderBy: { startTime: "asc" },
  });
  res.status(200).json({ shifts });
});

schedulesRouter.post(
  "/:locationId/:week/publish",
  requireRole([Role.ADMIN, Role.MANAGER]),
  requireLocationAccess,
  async (req, res) => {
    const week = new Date(`${String(req.params.week)}T00:00:00.000Z`);
    const locationId = String(req.params.locationId);
    const now = new Date();

    const shifts = await prisma.shift.findMany({
      where: { locationId, scheduleWeek: week, status: ShiftStatus.DRAFT },
    });
    if (shifts.length === 0) {
      res.status(200).json({ updated: 0, shiftIds: [] });
      return;
    }
    if (shifts.some((s) => s.editCutoffAt && s.editCutoffAt <= now)) {
      res.status(422).json({ message: "Cannot publish: at least one shift passed edit cutoff" });
      return;
    }

    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        const freshShifts = await tx.shift.findMany({
          where: { locationId, scheduleWeek: week, status: ShiftStatus.DRAFT },
        });
        if (freshShifts.some((s) => s.editCutoffAt && s.editCutoffAt <= now)) {
          throw new Error("PUBLISH_CUTOFF_PASSED");
        }

        const updated = await tx.shift.updateMany({
          where: { locationId, scheduleWeek: week, status: ShiftStatus.DRAFT },
          data: { status: ShiftStatus.PUBLISHED, publishedAt: now },
        });

        for (const shift of shifts) {
          await writeAuditLog(tx, {
            actorId: req.user!.id,
            entityType: "Shift",
            entityId: shift.id,
            action: "PUBLISH",
            before: shift,
            after: { ...shift, status: ShiftStatus.PUBLISHED, publishedAt: now },
            shiftId: shift.id,
          });
        }

        return updated;
      });
    } catch (err) {
      if (err instanceof Error && err.message === "PUBLISH_CUTOFF_PASSED") {
        res.status(422).json({ message: "Cannot publish: at least one shift passed edit cutoff" });
        return;
      }
      throw err;
    }

    res.status(200).json({
      updated: result.count,
      locationId,
      week: String(req.params.week),
      shiftIds: shifts.map((s) => s.id),
    });

    emitLocationEvent("schedule:published", locationId, {
      locationId,
      week: String(req.params.week),
      shiftIds: shifts.map((s) => s.id),
    });
  },
);

schedulesRouter.post(
  "/:locationId/:week/unpublish",
  requireRole([Role.ADMIN, Role.MANAGER]),
  requireLocationAccess,
  async (req, res) => {
    const week = new Date(`${String(req.params.week)}T00:00:00.000Z`);
    const locationId = String(req.params.locationId);
    const now = new Date();

    const shifts = await prisma.shift.findMany({
      where: { locationId, scheduleWeek: week, status: ShiftStatus.PUBLISHED },
    });
    if (shifts.length === 0) {
      res.status(200).json({ updated: 0, shiftIds: [] });
      return;
    }
    if (shifts.some((s) => s.editCutoffAt && s.editCutoffAt <= now)) {
      res.status(422).json({ message: "Cannot unpublish: at least one shift passed edit cutoff" });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.shift.updateMany({
        where: { locationId, scheduleWeek: week, status: ShiftStatus.PUBLISHED },
        data: { status: ShiftStatus.DRAFT, publishedAt: null },
      });

      for (const shift of shifts) {
        await writeAuditLog(tx, {
          actorId: req.user!.id,
          entityType: "Shift",
          entityId: shift.id,
          action: "UNPUBLISH",
          before: shift,
          after: { ...shift, status: ShiftStatus.DRAFT, publishedAt: null },
          shiftId: shift.id,
        });
      }

      return updated;
    });

    res.status(200).json({
      updated: result.count,
      locationId,
      week: String(req.params.week),
      shiftIds: shifts.map((s) => s.id),
    });
  },
);
