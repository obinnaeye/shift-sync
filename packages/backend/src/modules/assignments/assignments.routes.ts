import { AssignmentStatus, Prisma, Role } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { redis } from "../../lib/redis.js";
import { authenticate } from "../../middleware/authenticate.js";
import { hasLocationAccess } from "../../middleware/require-location-access.js";
import { requireRole } from "../../middleware/require-role.js";
import { emitLocationEvent, emitUserEvent } from "../../realtime/socket.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { constraintEngine } from "../constraints/constraint-engine.js";

export const assignmentsRouter = Router();
assignmentsRouter.use(authenticate);

function isShiftActiveNow(startTime: Date, endTime: Date): boolean {
  const now = new Date();
  return startTime <= now && endTime > now;
}

assignmentsRouter.get("/:id/assignments", requireRole([Role.ADMIN, Role.MANAGER]), async (req, res) => {
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

  const assignments = await prisma.shiftAssignment.findMany({
    where: { shiftId },
    include: { user: true },
  });
  res.status(200).json({ assignments });
});

assignmentsRouter.post("/:id/assignments", requireRole([Role.ADMIN, Role.MANAGER]), async (req, res) => {
  const shiftId = String(req.params.id);
  const userId = req.body?.userId as string | undefined;
  const forceOverride = Boolean(req.body?.forceOverride === true);
  const overrideReason = (req.body?.overrideReason as string | undefined) ?? undefined;

  if (!userId) {
    res.status(400).json({ message: "userId is required" });
    return;
  }

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

  const lockKey = `lock:assign:${userId}`;
  const lockOwner = req.user!.id;
  const lockResult = await redis.set(lockKey, lockOwner, "EX", 10, "NX");
  const lockAcquired = lockResult === "OK";
  if (!lockAcquired) {
    const conflictingManagerId = await redis.get(lockKey);
    emitUserEvent("conflict:detected", req.user!.id, {
      staffId: userId,
      conflictingManagerId: conflictingManagerId ?? "unknown",
    });
  }

  try {
    const constraint = await constraintEngine.check({
      shiftId,
      staffId: userId,
      actorId: req.user!.id,
      forceOverride,
      overrideReason,
    });
    if (constraint.hasBlocking) {
      res.status(422).json({
        error: "CONSTRAINT_VIOLATION",
        violations: constraint.violations.filter((v) => !v.passed),
        suggestions: constraint.suggestions,
      });
      return;
    }

    try {
      const assignment = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "headcount" FROM "shifts" WHERE "id" = ${shiftId} FOR UPDATE`;

        const currentShift = await tx.shift.findUnique({ where: { id: shiftId } });
        if (!currentShift) {
          throw new Error("SHIFT_NOT_FOUND");
        }

        const confirmedCount = await tx.shiftAssignment.count({
          where: { shiftId, status: AssignmentStatus.CONFIRMED },
        });
        if (confirmedCount >= currentShift.headcount) {
          throw new Error("SHIFT_FULL");
        }

        const created = await tx.shiftAssignment.create({
          data: {
            shiftId,
            userId,
            assignedBy: req.user!.id,
            status: AssignmentStatus.CONFIRMED,
            shiftStartTime: currentShift.startTime,
            shiftEndTime: currentShift.endTime,
          },
        });

        if (forceOverride && overrideReason && constraint.overrideTypes.length > 0) {
          for (const overrideType of constraint.overrideTypes) {
            await tx.managerOverride.create({
              data: {
                managerId: req.user!.id,
                userId,
                shiftId,
                overrideType,
                reason: overrideReason,
              },
            });
          }
        }

        await writeAuditLog(tx, {
          actorId: req.user!.id,
          entityType: "ShiftAssignment",
          entityId: created.id,
          action: "CREATE",
          before: null,
          after: created,
          shiftId,
          reason: overrideReason ?? null,
        });

        return created;
      });

      const warnings = constraint.violations.filter((v) => v.severity === "WARNING");
      emitUserEvent("assignment:created", userId, {
        shift: {
          id: shift.id,
          locationId: shift.locationId,
          startTime: shift.startTime,
          endTime: shift.endTime,
          scheduleWeek: shift.scheduleWeek,
        },
        assignment,
      });

      if (warnings.some((warning) => warning.rule === "WEEKLY_WARNING" && !warning.passed)) {
        emitUserEvent("overtime:warning", req.user!.id, {
          staffId: userId,
          week: shift.scheduleWeek.toISOString().slice(0, 10),
          projectedHours: null,
        });
      }

      if (isShiftActiveNow(shift.startTime, shift.endTime)) {
        emitLocationEvent("on-duty:update", shift.locationId, {
          locationId: shift.locationId,
          userId,
          action: "clock-in",
        });
      }

      res.status(201).json({ assignment, warnings });
    } catch (err) {
      if (err instanceof Error && err.message === "SHIFT_FULL") {
        res.status(409).json({ message: "Shift is already fully staffed" });
        return;
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        res.status(409).json({ message: "Assignment already exists for this shift and user" });
        return;
      }

      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("23P01") || msg.includes("no_overlap_per_user")) {
        res.status(409).json({ message: "Assignment conflicts with existing confirmed assignment (overlap)" });
        return;
      }

      throw err;
    }
  } finally {
    if (lockAcquired) {
      const currentOwner = await redis.get(lockKey);
      if (currentOwner === lockOwner) {
        await redis.del(lockKey);
      }
    }
  }
});

assignmentsRouter.delete("/:id/assignments/:userId", requireRole([Role.ADMIN, Role.MANAGER]), async (req, res) => {
    const shiftId = String(req.params.id);
    const targetUserId = String(req.params.userId);
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

    let removedActiveAssignment = false;
    await prisma.$transaction(async (tx) => {
      const existing = await tx.shiftAssignment.findFirst({
        where: { shiftId, userId: targetUserId },
      });
      if (!existing) {
        return;
      }
      removedActiveAssignment = existing.status === AssignmentStatus.CONFIRMED;
      const updated = await tx.shiftAssignment.update({
        where: { id: existing.id },
        data: { status: AssignmentStatus.DROPPED },
      });
      await writeAuditLog(tx, {
        actorId: req.user!.id,
        entityType: "ShiftAssignment",
        entityId: existing.id,
        action: "UPDATE",
        before: existing,
        after: updated,
        shiftId,
      });
    });

    emitUserEvent("assignment:removed", targetUserId, { shiftId });
    if (removedActiveAssignment && isShiftActiveNow(shift.startTime, shift.endTime)) {
      emitLocationEvent("on-duty:update", shift.locationId, {
        locationId: shift.locationId,
        userId: targetUserId,
        action: "clock-out",
      });
    }

    res.status(204).send();
  });
