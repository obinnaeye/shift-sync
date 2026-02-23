import { AssignmentStatus, Prisma, Role, SwapStatus, SwapType } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { authenticate } from "../../middleware/authenticate.js";
import { hasLocationAccess } from "../../middleware/require-location-access.js";
import { requireRole } from "../../middleware/require-role.js";
import { emitLocationEvent, emitManyUsersEvent, emitUserEvent } from "../../realtime/socket.js";
import { writeAuditLog } from "../audit/audit.service.js";
import { constraintEngine } from "../constraints/constraint-engine.js";

export const swapRequestsRouter = Router();
swapRequestsRouter.use(authenticate);

function isTerminal(status: SwapStatus): boolean {
  return (
    status === SwapStatus.APPROVED ||
    status === SwapStatus.REJECTED ||
    status === SwapStatus.CANCELLED ||
    status === SwapStatus.EXPIRED
  );
}

swapRequestsRouter.post("/", requireRole([Role.STAFF]), async (req, res) => {
  const { type, assignmentId, targetId } = req.body as {
    type?: SwapType;
    assignmentId?: string;
    targetId?: string | null;
  };

  if (!type || !assignmentId || !Object.values(SwapType).includes(type)) {
    res.status(400).json({ message: "type and assignmentId are required" });
    return;
  }

  const assignment = await prisma.shiftAssignment.findUnique({
    where: { id: assignmentId },
    include: { shift: true },
  });
  if (!assignment) {
    res.status(404).json({ message: "Assignment not found" });
    return;
  }
  if (assignment.userId !== req.user!.id) {
    res.status(403).json({ message: "You can only create requests for your own assignment" });
    return;
  }

  const existing = await prisma.swapRequest.findFirst({
    where: {
      assignmentId,
      status: { in: [SwapStatus.PENDING_ACCEPTANCE, SwapStatus.OPEN, SwapStatus.PENDING_MANAGER] },
    },
  });
  if (existing) {
    res.status(409).json({ message: "Active swap/drop already exists", swapRequest: existing });
    return;
  }
  const pendingCount = await prisma.swapRequest.count({
    where: {
      requesterId: req.user!.id,
      status: {
        in: [SwapStatus.PENDING_ACCEPTANCE, SwapStatus.OPEN, SwapStatus.PENDING_MANAGER],
      },
    },
  });
  if (pendingCount >= 3) {
    res.status(422).json({ message: "Max 3 pending swap/drop requests allowed" });
    return;
  }

  if (type === SwapType.SWAP && !targetId) {
    res.status(400).json({ message: "targetId is required for SWAP" });
    return;
  }

  const created = await prisma.$transaction(async (tx) => {
    const data: Prisma.SwapRequestCreateInput = {
      type,
      assignment: { connect: { id: assignmentId } },
      requester: { connect: { id: req.user!.id } },
      target: targetId ? { connect: { id: targetId } } : undefined,
      status: type === SwapType.SWAP ? SwapStatus.PENDING_ACCEPTANCE : SwapStatus.OPEN,
      expiresAt:
        type === SwapType.DROP
          ? new Date(assignment.shift.startTime.getTime() - 24 * 60 * 60 * 1000)
          : null,
    };

    const swap = await tx.swapRequest.create({ data });
    await writeAuditLog(tx, {
      actorId: req.user!.id,
      entityType: "SwapRequest",
      entityId: swap.id,
      action: "CREATE",
      before: null,
      after: swap,
      shiftId: assignment.shiftId,
    });
    return swap;
  });

  if (created.type === SwapType.SWAP && created.targetId) {
    emitUserEvent("swap:received", created.targetId, {
      swapRequest: created,
      shift: assignment.shift,
    });
  }
  if (created.type === SwapType.DROP) {
    emitLocationEvent("drop:available", assignment.shift.locationId, {
      swapRequest: created,
      shift: assignment.shift,
    });
  }

  res.status(201).json({ swapRequest: created });
});

swapRequestsRouter.get("/", async (req, res) => {
  let where: Prisma.SwapRequestWhereInput = {};
  if (req.user!.role === Role.STAFF) {
    where = {
      OR: [
        { requesterId: req.user!.id },
        { targetId: req.user!.id },
        { assignment: { userId: req.user!.id } },
      ],
    };
  } else if (req.user!.role === Role.MANAGER) {
    const managed = await prisma.locationManager.findMany({
      where: { userId: req.user!.id },
      select: { locationId: true },
    });
    where = {
      assignment: { shift: { locationId: { in: managed.map((m) => m.locationId) } } },
    };
  }

  const swapRequests = await prisma.swapRequest.findMany({
    where,
    include: {
      assignment: { include: { shift: true } },
      requester: true,
      target: true,
    },
    orderBy: { createdAt: "desc" },
  });
  res.status(200).json({ swapRequests });
});

swapRequestsRouter.get("/my-assignments", requireRole([Role.STAFF]), async (req, res) => {
  const assignments = await prisma.shiftAssignment.findMany({
    where: {
      userId: req.user!.id,
      status: AssignmentStatus.CONFIRMED,
      shift: {
        status: { in: ["DRAFT", "PUBLISHED"] },
      },
    },
    include: {
      shift: {
        include: {
          location: true,
          skill: true,
        },
      },
    },
    orderBy: { shiftStartTime: "asc" },
  });
  res.status(200).json({ assignments });
});

swapRequestsRouter.get("/drop-available", requireRole([Role.STAFF]), async (req, res) => {
  const certifications = await prisma.locationCertification.findMany({
    where: { userId: req.user!.id, revokedAt: null },
    select: { locationId: true },
  });
  const locationIds = certifications.map((certification) => certification.locationId);
  if (locationIds.length === 0) {
    res.status(200).json({ swapRequests: [] });
    return;
  }

  const now = new Date();
  const swapRequests = await prisma.swapRequest.findMany({
    where: {
      type: SwapType.DROP,
      status: SwapStatus.OPEN,
      requesterId: { not: req.user!.id },
      targetId: null,
      expiresAt: { gt: now },
      assignment: {
        shift: {
          locationId: { in: locationIds },
          status: "PUBLISHED",
          startTime: { gt: now },
        },
      },
    },
    include: {
      requester: true,
      assignment: {
        include: {
          shift: {
            include: {
              location: true,
              skill: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  res.status(200).json({ swapRequests });
});

swapRequestsRouter.get("/:id", async (req, res) => {
  const swapId = String(req.params.id);
  const swap = await prisma.swapRequest.findUnique({
    where: { id: swapId },
    include: { assignment: true, requester: true, target: true },
  });
  if (!swap) {
    res.status(404).json({ message: "Swap request not found" });
    return;
  }
  if (
    req.user!.role === Role.STAFF &&
    swap.requesterId !== req.user!.id &&
    swap.targetId !== req.user!.id
  ) {
    res.status(403).json({ message: "Forbidden" });
    return;
  }
  res.status(200).json({ swapRequest: swap });
});

swapRequestsRouter.post("/:id/accept", requireRole([Role.STAFF]), async (req, res) => {
  const swapId = String(req.params.id);
  const swap = await prisma.swapRequest.findUnique({ where: { id: swapId } });
  if (!swap) {
    res.status(404).json({ message: "Swap request not found" });
    return;
  }
  if (swap.type !== SwapType.SWAP || swap.status !== SwapStatus.PENDING_ACCEPTANCE) {
    res.status(409).json({ message: "Swap is not in PENDING_ACCEPTANCE state" });
    return;
  }
  if (swap.targetId !== req.user!.id) {
    res.status(403).json({ message: "Only target staff can accept this swap" });
    return;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.swapRequest.update({
      where: { id: swap.id },
      data: { status: SwapStatus.PENDING_MANAGER },
    });
    await writeAuditLog(tx, {
      actorId: req.user!.id,
      entityType: "SwapRequest",
      entityId: swap.id,
      action: "ACCEPT",
      before: swap,
      after: next,
    });
    return next;
  });

  emitUserEvent("swap:accepted", swap.requesterId, {
    swapRequest: updated,
  });

  res.status(200).json({ swapRequest: updated });
});

swapRequestsRouter.post("/:id/reject", requireRole([Role.STAFF]), async (req, res) => {
  const swapId = String(req.params.id);
  const swap = await prisma.swapRequest.findUnique({ where: { id: swapId } });
  if (!swap) {
    res.status(404).json({ message: "Swap request not found" });
    return;
  }
  if (swap.type !== SwapType.SWAP || swap.status !== SwapStatus.PENDING_ACCEPTANCE) {
    res.status(409).json({ message: "Swap is not in PENDING_ACCEPTANCE state" });
    return;
  }
  if (swap.targetId !== req.user!.id) {
    res.status(403).json({ message: "Only target staff can reject this swap" });
    return;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.swapRequest.update({
      where: { id: swap.id },
      data: { status: SwapStatus.CANCELLED, managerNote: "Rejected by target staff" },
    });
    await writeAuditLog(tx, {
      actorId: req.user!.id,
      entityType: "SwapRequest",
      entityId: swap.id,
      action: "REJECT",
      before: swap,
      after: next,
    });
    return next;
  });

  emitManyUsersEvent(
    "swap:cancelled",
    [updated.requesterId, updated.targetId ?? req.user!.id],
    { swapRequest: updated, reason: "Rejected by target staff" },
  );

  res.status(200).json({ swapRequest: updated });
});

swapRequestsRouter.post("/:id/cancel", requireRole([Role.STAFF]), async (req, res) => {
  const swapId = String(req.params.id);
  const swap = await prisma.swapRequest.findUnique({ where: { id: swapId } });
  if (!swap) {
    res.status(404).json({ message: "Swap request not found" });
    return;
  }
  if (swap.requesterId !== req.user!.id) {
    res.status(403).json({ message: "Only requester can cancel request" });
    return;
  }
  if (isTerminal(swap.status)) {
    res.status(200).json({ swapRequest: swap });
    return;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.swapRequest.update({
      where: { id: swap.id },
      data: { status: SwapStatus.CANCELLED, managerNote: "Cancelled by requester" },
    });
    await writeAuditLog(tx, {
      actorId: req.user!.id,
      entityType: "SwapRequest",
      entityId: swap.id,
      action: "CANCEL",
      before: swap,
      after: next,
    });
    return next;
  });

  emitManyUsersEvent(
    "swap:cancelled",
    [updated.requesterId, updated.targetId ?? ""].filter((id): id is string => Boolean(id)),
    { swapRequest: updated, reason: "Cancelled by requester" },
  );

  res.status(200).json({ swapRequest: updated });
});

swapRequestsRouter.post("/:id/approve", requireRole([Role.ADMIN, Role.MANAGER]), async (req, res) => {
  const swapId = String(req.params.id);
  const swap = await prisma.swapRequest.findUnique({
    where: { id: swapId },
    include: { assignment: { include: { shift: true } } },
  });
  if (!swap) {
    res.status(404).json({ message: "Swap request not found" });
    return;
  }
  if (swap.status !== SwapStatus.PENDING_MANAGER) {
    res.status(409).json({ message: "Request is not awaiting manager decision" });
    return;
  }

  const allowed = await hasLocationAccess(req.user!.id, req.user!.role, swap.assignment.shift.locationId);
  if (!allowed) {
    res.status(403).json({ message: "Forbidden for location" });
    return;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.swapRequest.update({
      where: { id: swap.id },
      data: {
        status: SwapStatus.APPROVED,
        managerApprovedBy: req.user!.id,
        managerNote: req.body?.managerNote ?? null,
      },
    });
    if (swap.targetId && (swap.type === SwapType.DROP || swap.type === SwapType.SWAP)) {
      await tx.shiftAssignment.update({
        where: { id: swap.assignmentId },
        data: { userId: swap.targetId, status: AssignmentStatus.CONFIRMED },
      });
    }
    await writeAuditLog(tx, {
      actorId: req.user!.id,
      entityType: "SwapRequest",
      entityId: swap.id,
      action: "APPROVE",
      before: swap,
      after: next,
      shiftId: swap.assignment.shiftId,
      reason: req.body?.managerNote ?? null,
    });
    return next;
  });

  emitManyUsersEvent(
    "swap:resolved",
    [swap.requesterId, swap.targetId ?? "", swap.assignment.userId].filter(
      (id): id is string => Boolean(id),
    ),
    { swapRequest: updated, outcome: SwapStatus.APPROVED },
  );

  if (
    swap.targetId &&
    swap.assignment.shift.startTime <= new Date() &&
    swap.assignment.shift.endTime > new Date()
  ) {
    emitLocationEvent("on-duty:update", swap.assignment.shift.locationId, {
      locationId: swap.assignment.shift.locationId,
      userId: swap.assignment.userId,
      action: "clock-out",
    });
    emitLocationEvent("on-duty:update", swap.assignment.shift.locationId, {
      locationId: swap.assignment.shift.locationId,
      userId: swap.targetId,
      action: "clock-in",
    });
  }

  res.status(200).json({ swapRequest: updated });
});

swapRequestsRouter.post(
  "/:id/reject-manager",
  requireRole([Role.ADMIN, Role.MANAGER]),
  async (req, res) => {
    const swapId = String(req.params.id);
    const swap = await prisma.swapRequest.findUnique({
      where: { id: swapId },
      include: { assignment: { include: { shift: true } } },
    });

    if (!swap) {
      res.status(404).json({ message: "Swap request not found" });
      return;
    }
    const allowed = await hasLocationAccess(req.user!.id, req.user!.role, swap.assignment.shift.locationId);
    if (!allowed) {
      res.status(403).json({ message: "Forbidden for location" });
      return;
    }
    if (swap.status !== SwapStatus.PENDING_MANAGER) {
      res.status(409).json({ message: "Request is not awaiting manager decision" });
      return;
    }

    const managerNote = (req.body?.managerNote as string | undefined) ?? "Rejected by manager";

    const updated = await prisma.$transaction(async (tx) => {
      let nextStatus: SwapStatus = SwapStatus.REJECTED;
      let pickupAttempts = swap.pickupAttempts;
      let nextTargetId: string | null | undefined = swap.targetId;

      if (swap.type === SwapType.DROP) {
        pickupAttempts += 1;
        if (pickupAttempts >= 3) {
          nextStatus = SwapStatus.CANCELLED;
        } else {
          nextStatus = SwapStatus.OPEN;
          nextTargetId = null;
        }
      }

      const next = await tx.swapRequest.update({
        where: { id: swap.id },
        data: {
          status: nextStatus,
          managerApprovedBy: req.user!.id,
          managerNote,
          pickupAttempts,
          targetId: nextTargetId,
        },
      });

      await writeAuditLog(tx, {
        actorId: req.user!.id,
        entityType: "SwapRequest",
        entityId: swap.id,
        action: "REJECT_MANAGER",
        before: swap,
        after: next,
        shiftId: swap.assignment.shiftId,
        reason: managerNote,
      });
      return next;
    });

    emitManyUsersEvent(
      "swap:resolved",
      [swap.requesterId, swap.targetId ?? "", swap.assignment.userId].filter(
        (id): id is string => Boolean(id),
      ),
      { swapRequest: updated, outcome: updated.status },
    );

    if (swap.type === SwapType.DROP && updated.status === SwapStatus.OPEN) {
      emitLocationEvent("drop:available", swap.assignment.shift.locationId, {
        swapRequest: updated,
        shift: swap.assignment.shift,
      });
    }

    res.status(200).json({ swapRequest: updated });
  },
);

swapRequestsRouter.post("/:id/pickup", requireRole([Role.STAFF]), async (req, res) => {
  const swapId = String(req.params.id);
  const swap = await prisma.swapRequest.findUnique({
    where: { id: swapId },
    include: { assignment: true },
  });
  if (!swap) {
    res.status(404).json({ message: "Swap request not found" });
    return;
  }
  if (swap.type !== SwapType.DROP || swap.status !== SwapStatus.OPEN) {
    res.status(409).json({ message: "Drop request is not open for pickup" });
    return;
  }
  if (swap.requesterId === req.user!.id) {
    res.status(422).json({ message: "Requester cannot pick up their own dropped shift" });
    return;
  }
  const assignment = await prisma.shiftAssignment.findUnique({
    where: { id: swap.assignmentId },
  });
  if (!assignment) {
    res.status(404).json({ message: "Assignment not found for this request" });
    return;
  }
  const shift = await prisma.shift.findUnique({
    where: { id: assignment.shiftId },
    select: { id: true, locationId: true },
  });
  if (!shift) {
    res.status(404).json({ message: "Shift not found for this request" });
    return;
  }
  const checks = await constraintEngine.check({
    shiftId: assignment.shiftId,
    staffId: req.user!.id,
    actorId: req.user!.id,
  });
  if (checks.hasBlocking) {
    res.status(422).json({
      error: "CONSTRAINT_VIOLATION",
      violations: checks.violations.filter((v) => v.severity === "BLOCKING" && !v.passed),
      suggestions: checks.suggestions,
    });
    return;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.swapRequest.update({
      where: { id: swap.id },
      data: { targetId: req.user!.id, status: SwapStatus.PENDING_MANAGER },
    });
    await writeAuditLog(tx, {
      actorId: req.user!.id,
      entityType: "SwapRequest",
      entityId: swap.id,
      action: "PICKUP",
      before: swap,
      after: next,
      shiftId: swap.assignment.shiftId,
    });
    return next;
  });

  emitLocationEvent("drop:claimed", shift.locationId, {
    shiftId: shift.id,
  });

  res.status(200).json({ swapRequest: updated });
});
