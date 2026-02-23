import { AssignmentStatus, Role, ShiftStatus, SwapStatus, SwapType } from "@prisma/client";
import { Router } from "express";
import { toZonedTime } from "date-fns-tz";
import { prisma } from "../../lib/prisma.js";
import { authenticate } from "../../middleware/authenticate.js";
import { hasLocationAccess } from "../../middleware/require-location-access.js";
import { requireRole } from "../../middleware/require-role.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { emitLocationEvent, emitManyUsersEvent } from "../../realtime/socket.js";

export const shiftsRouter = Router();
shiftsRouter.use(authenticate);

function weekStartFor(date: Date, timezone: string): Date {
  const zoned = toZonedTime(date, timezone);
  const day = zoned.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  zoned.setDate(zoned.getDate() + diff);
  zoned.setHours(0, 0, 0, 0);
  return new Date(Date.UTC(zoned.getFullYear(), zoned.getMonth(), zoned.getDate()));
}

function isPremiumShift(startTime: Date, timezone: string): boolean {
  const local = toZonedTime(startTime, timezone);
  const day = local.getDay();
  const hour = local.getHours();
  return (day === 5 || day === 6) && hour >= 17 && hour <= 23;
}

shiftsRouter.get("/", async (req, res) => {
  const user = req.user!;
  const where: {
    locationId?: { in: string[] } | string;
    scheduleWeek?: Date;
    status?: ShiftStatus;
  } = {};
  if (user.role === Role.MANAGER) {
    const managed = await prisma.locationManager.findMany({
      where: { userId: user.id },
      select: { locationId: true },
    });
    const managedIds = managed.map((m) => m.locationId);
    where.locationId = { in: managedIds };
  }
  if (user.role === Role.STAFF) {
    where.status = ShiftStatus.PUBLISHED;
  }
  if (typeof req.query.locationId === "string") {
    if (user.role === Role.MANAGER) {
      const requested = req.query.locationId;
      const managed = await prisma.locationManager.findUnique({
        where: { userId_locationId: { userId: user.id, locationId: requested } },
      });
      if (!managed) {
        res.status(403).json({ message: "Forbidden for location" });
        return;
      }
    }
    where.locationId = req.query.locationId;
  }
  if (typeof req.query.week === "string") {
    where.scheduleWeek = new Date(`${req.query.week}T00:00:00.000Z`);
  }
  if (
    user.role !== Role.STAFF &&
    typeof req.query.status === "string" &&
    Object.values(ShiftStatus).includes(req.query.status as ShiftStatus)
  ) {
    where.status = req.query.status as ShiftStatus;
  }

  const shifts = await prisma.shift.findMany({
    where,
    include: { location: true, skill: true },
    orderBy: { startTime: "asc" },
  });
  res.status(200).json({ shifts });
});

shiftsRouter.get("/:id", async (req, res) => {
  const shiftId = String(req.params.id);
  const user = req.user!;
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: { location: true, skill: true, assignments: true },
  });
  if (!shift) {
    res.status(404).json({ message: "Shift not found" });
    return;
  }
  if (user.role === Role.STAFF && shift.status !== ShiftStatus.PUBLISHED) {
    res.status(404).json({ message: "Shift not found" });
    return;
  }
  if (user.role === Role.STAFF) {
    const filteredShift = {
      ...shift,
      assignments: shift.assignments.filter((a) => a.status === AssignmentStatus.CONFIRMED),
    };
    res.status(200).json({ shift: filteredShift });
    return;
  }
  res.status(200).json({ shift });
});

shiftsRouter.get("/:id/drop-available", requireRole([Role.STAFF]), async (req, res) => {
  const shiftId = String(req.params.id);
  const swapRequests = await prisma.swapRequest.findMany({
    where: {
      type: SwapType.DROP,
      status: SwapStatus.OPEN,
      assignment: { shiftId },
    },
    include: { assignment: true, requester: true },
    orderBy: { createdAt: "desc" },
  });
  res.status(200).json({ swapRequests });
});

shiftsRouter.post("/", requireRole([Role.ADMIN, Role.MANAGER]), async (req, res) => {
  const { locationId, skillId, startTime, endTime, headcount } = req.body as {
    locationId?: string;
    skillId?: string;
    startTime?: string;
    endTime?: string;
    headcount?: number;
  };

  if (!locationId || !skillId || !startTime || !endTime || !headcount) {
    res.status(400).json({ message: "locationId, skillId, startTime, endTime, headcount are required" });
    return;
  }

  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) {
    res.status(404).json({ message: "Location not found" });
    return;
  }

  const allowed = await hasLocationAccess(req.user!.id, req.user!.role, locationId);
  if (!allowed) {
    res.status(403).json({ message: "Forbidden for location" });
    return;
  }

  const start = new Date(startTime);
  const end = new Date(endTime);
  if (!(start < end)) {
    res.status(400).json({ message: "startTime must be before endTime" });
    return;
  }

  const scheduleWeek = weekStartFor(start, location.timezone);
  const editCutoffAt = new Date(start.getTime() - 48 * 60 * 60 * 1000);
  const created = await prisma.$transaction(async (tx) => {
    const shift = await tx.shift.create({
      data: {
        locationId,
        skillId,
        startTime: start,
        endTime: end,
        headcount,
        isPremium: isPremiumShift(start, location.timezone),
        scheduleWeek,
        editCutoffAt,
        createdBy: req.user!.id,
      },
    });

    await writeAuditLog(tx, {
      actorId: req.user!.id,
      entityType: "Shift",
      entityId: shift.id,
      action: "CREATE",
      before: null,
      after: shift,
      shiftId: shift.id,
    });

    return shift;
  });

  res.status(201).json({ shift: created });
});

shiftsRouter.patch("/:id", requireRole([Role.ADMIN, Role.MANAGER]), async (req, res) => {
  const shiftId = String(req.params.id);
  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: { location: true },
  });
  if (!shift) {
    res.status(404).json({ message: "Shift not found" });
    return;
  }

  const allowed = await hasLocationAccess(req.user!.id, req.user!.role, shift.locationId);
  if (!allowed) {
    res.status(403).json({ message: "Forbidden for location" });
    return;
  }

  const startTime = req.body.startTime ? new Date(req.body.startTime) : shift.startTime;
  const endTime = req.body.endTime ? new Date(req.body.endTime) : shift.endTime;
  const now = new Date();
  if (shift.editCutoffAt && shift.editCutoffAt <= now) {
    res.status(422).json({ message: "Shift edit cutoff has passed" });
    return;
  }
  if (!(startTime < endTime)) {
    res.status(400).json({ message: "startTime must be before endTime" });
    return;
  }

  const locationTimezone = shift.location.timezone;
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.shift.findUnique({ where: { id: shift.id } });
    const saved = await tx.shift.update({
      where: { id: shift.id },
      data: {
        startTime,
        endTime,
        headcount: req.body.headcount ?? shift.headcount,
        skillId: req.body.skillId ?? shift.skillId,
        isPremium: isPremiumShift(startTime, locationTimezone),
        scheduleWeek: weekStartFor(startTime, locationTimezone),
      },
    });

    await tx.shiftAssignment.updateMany({
      where: { shiftId: shift.id, status: AssignmentStatus.CONFIRMED },
      data: { shiftStartTime: startTime, shiftEndTime: endTime },
    });

    const swapsToCancel = await tx.swapRequest.findMany({
      where: {
        assignment: { shiftId: shift.id },
        status: { in: [SwapStatus.PENDING_ACCEPTANCE, SwapStatus.OPEN, SwapStatus.PENDING_MANAGER] },
      },
      select: {
        id: true,
        type: true,
        requesterId: true,
        targetId: true,
      },
    });

    await tx.swapRequest.updateMany({
      where: {
        assignment: { shiftId: shift.id },
        status: { in: [SwapStatus.PENDING_ACCEPTANCE, SwapStatus.OPEN, SwapStatus.PENDING_MANAGER] },
      },
      data: {
        status: SwapStatus.CANCELLED,
        managerNote: "Shift was edited by manager",
      },
    });

    await writeAuditLog(tx, {
      actorId: req.user!.id,
      entityType: "Shift",
      entityId: shift.id,
      action: "UPDATE",
      before,
      after: saved,
      shiftId: shift.id,
    });

    return { saved, swapsToCancel };
  });

  emitLocationEvent("schedule:updated", shift.locationId, {
    shiftId: shift.id,
    changes: {
      startTime: result.saved.startTime,
      endTime: result.saved.endTime,
      headcount: result.saved.headcount,
      skillId: result.saved.skillId,
    },
  });

  result.swapsToCancel.forEach((swapRequest) => {
    const recipientIds = [
      swapRequest.requesterId,
      swapRequest.targetId,
    ].filter((id): id is string => Boolean(id));
    emitManyUsersEvent("swap:cancelled", recipientIds, {
      swapRequest: { id: swapRequest.id, type: swapRequest.type, status: SwapStatus.CANCELLED },
      reason: "Shift was edited by manager",
    });
  });

  res.status(200).json({ shift: result.saved });
});

shiftsRouter.delete("/:id", requireRole([Role.ADMIN, Role.MANAGER]), async (req, res) => {
  const shiftId = String(req.params.id);
  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift) {
    res.status(404).json({ message: "Shift not found" });
    return;
  }

  const allowed = await hasLocationAccess(req.user!.id, req.user!.role, shift.locationId);
  if (!allowed) {
    res.status(403).json({ message: "Forbidden for location" });
    return;
  }

  await prisma.$transaction(async (tx) => {
    const before = await tx.shift.findUnique({ where: { id: shift.id } });
    const cancelled = await tx.shift.update({
      where: { id: shift.id },
      data: { status: ShiftStatus.CANCELLED },
    });
    await writeAuditLog(tx, {
      actorId: req.user!.id,
      entityType: "Shift",
      entityId: shift.id,
      action: "CANCEL",
      before,
      after: cancelled,
      shiftId: shift.id,
    });
  });

  res.status(204).send();
});
