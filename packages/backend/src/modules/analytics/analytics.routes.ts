import { AssignmentStatus, Role } from "@prisma/client";
import { Router } from "express";
import { toZonedTime } from "date-fns-tz";
import { prisma } from "../../lib/prisma.js";
import { authenticate } from "../../middleware/authenticate.js";
import { requireRole } from "../../middleware/require-role.js";

export const analyticsRouter = Router();
analyticsRouter.use(authenticate);
analyticsRouter.use(requireRole([Role.ADMIN, Role.MANAGER]));

// ── Helpers ───────────────────────────────────────────────────────────────────

function durationHours(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / (1000 * 60 * 60);
}

function dayKeyInTimezone(date: Date, timezone: string): string {
  const zoned = toZonedTime(date, timezone);
  const y = zoned.getFullYear();
  const m = String(zoned.getMonth() + 1).padStart(2, "0");
  const d = String(zoned.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isoWeekStartInTimezone(date: Date, timezone: string): string {
  const zoned = toZonedTime(date, timezone);
  const day = zoned.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(zoned);
  monday.setDate(zoned.getDate() + diff);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, "0");
  const d = String(monday.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function computeConsecutiveDays(targetDayKey: string, existingDayKeys: Set<string>): number {
  const allDays = new Set(existingDayKeys);
  allDays.add(targetDayKey);

  const parseDay = (key: string): Date => new Date(`${key}T12:00:00Z`);
  const target = parseDay(targetDayKey);

  let count = 1;

  let cur = target;
  for (let i = 1; i <= 13; i++) {
    const prev = addDays(cur, -1);
    const prevKey = prev.toISOString().slice(0, 10);
    if (allDays.has(prevKey)) {
      count++;
      cur = prev;
    } else break;
  }

  cur = target;
  for (let i = 1; i <= 13; i++) {
    const next = addDays(cur, 1);
    const nextKey = next.toISOString().slice(0, 10);
    if (allDays.has(nextKey)) {
      count++;
      cur = next;
    } else break;
  }

  return count;
}

// ── What-if ───────────────────────────────────────────────────────────────────

analyticsRouter.get("/what-if", async (req, res) => {
  const staffId = String(req.query.staffId ?? "");
  const shiftId = String(req.query.shiftId ?? "");
  if (!staffId || !shiftId) {
    res.status(400).json({ message: "staffId and shiftId are required" });
    return;
  }

  const shift = await prisma.shift.findUnique({
    where: { id: shiftId },
    include: { location: true },
  });
  if (!shift) {
    res.status(404).json({ message: "Shift not found" });
    return;
  }

  const assignments = await prisma.shiftAssignment.findMany({
    where: { userId: staffId, status: AssignmentStatus.CONFIRMED },
    include: { shift: { include: { location: true } } },
  });

  const shiftHours = durationHours(shift.startTime, shift.endTime);
  const shiftDay = dayKeyInTimezone(shift.startTime, shift.location.timezone);
  const shiftWeek = isoWeekStartInTimezone(shift.startTime, shift.location.timezone);

  const currentDailyHours = assignments
    .filter((a) => dayKeyInTimezone(a.shiftStartTime, shift.location.timezone) === shiftDay)
    .reduce((acc, a) => acc + durationHours(a.shiftStartTime, a.shiftEndTime), 0);

  const currentWeeklyHours = assignments
    .filter((a) => isoWeekStartInTimezone(a.shiftStartTime, shift.location.timezone) === shiftWeek)
    .reduce((acc, a) => acc + durationHours(a.shiftStartTime, a.shiftEndTime), 0);

  const projectedDailyHours = currentDailyHours + shiftHours;
  const projectedWeeklyHours = currentWeeklyHours + shiftHours;

  const overtimeRisk =
    projectedWeeklyHours > 40
      ? "OVER_LIMIT"
      : projectedWeeklyHours >= 40
        ? "AT_LIMIT"
        : projectedWeeklyHours >= 35
          ? "WARNING"
          : "LOW";

  // Compute consecutive days including the target shift
  const existingDayKeys = new Set(
    assignments
      .filter((a) => isoWeekStartInTimezone(a.shiftStartTime, shift.location.timezone) === shiftWeek)
      .map((a) => dayKeyInTimezone(a.shiftStartTime, shift.location.timezone)),
  );
  const consecutiveDays = computeConsecutiveDays(shiftDay, existingDayKeys);

  const warnings: string[] = [];
  if (projectedWeeklyHours > 40) warnings.push("This assignment would exceed the 40-hour weekly hard limit.");
  else if (projectedWeeklyHours >= 35) warnings.push("This assignment would push weekly hours into overtime warning territory (35 h+).");
  if (projectedDailyHours > 12) warnings.push("This assignment would exceed the 12-hour daily hard limit.");
  else if (projectedDailyHours > 8) warnings.push("This assignment would exceed the 8-hour daily warning threshold.");
  if (consecutiveDays >= 7) warnings.push("This would be the 7th consecutive day worked — manager override required.");
  else if (consecutiveDays === 6) warnings.push("This would be the 6th consecutive day worked — consider rest.");

  res.status(200).json({
    result: {
      currentWeeklyHours: Number(currentWeeklyHours.toFixed(2)),
      projectedWeeklyHours: Number(projectedWeeklyHours.toFixed(2)),
      currentDailyHours: Number(currentDailyHours.toFixed(2)),
      projectedDailyHours: Number(projectedDailyHours.toFixed(2)),
      overtimeRisk,
      consecutiveDays,
      warnings,
    },
  });
});

// ── Overtime summary (weekly, per-location) ───────────────────────────────────

analyticsRouter.get("/overtime", async (req, res) => {
  const { locationId, week } = req.query;
  if (!locationId || !week) {
    res.status(400).json({ message: "locationId and week are required" });
    return;
  }

  const weekStart = new Date(String(week));
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

  const assignments = await prisma.shiftAssignment.findMany({
    where: {
      status: AssignmentStatus.CONFIRMED,
      shift: { locationId: String(locationId), startTime: { gte: weekStart, lt: weekEnd } },
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, desiredWeeklyHours: true } },
      shift: { include: { location: true } },
    },
  });

  const byUser = new Map<string, {
    user: { id: string; firstName: string; lastName: string; desiredWeeklyHours: number | null };
    hours: number;
    shifts: Array<{ shiftId: string; startTime: Date; endTime: Date; hours: number }>;
  }>();

  for (const a of assignments) {
    const hours = durationHours(a.shiftStartTime, a.shiftEndTime);
    if (!byUser.has(a.userId)) {
      byUser.set(a.userId, { user: a.user, hours: 0, shifts: [] });
    }
    const entry = byUser.get(a.userId)!;
    entry.hours += hours;
    entry.shifts.push({ shiftId: a.shiftId, startTime: a.shiftStartTime, endTime: a.shiftEndTime, hours });
  }

  const summary = Array.from(byUser.values())
    .map(({ user, hours, shifts }) => ({
      userId: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      weeklyHours: Number(hours.toFixed(2)),
      desiredWeeklyHours: user.desiredWeeklyHours,
      overtimeRisk:
        hours > 40 ? "OVER_LIMIT" : hours >= 40 ? "AT_LIMIT" : hours >= 35 ? "WARNING" : "LOW",
      shifts,
    }))
    .sort((a, b) => b.weeklyHours - a.weeklyHours);

  res.status(200).json({ summary, week: String(week), locationId: String(locationId) });
});

// ── Fairness analytics ────────────────────────────────────────────────────────

analyticsRouter.get("/fairness", async (req, res) => {
  const { locationId, weekFrom, weekTo } = req.query;

  const where: Record<string, unknown> = { status: AssignmentStatus.CONFIRMED };
  if (locationId) {
    where.shift = { locationId: String(locationId) };
  }
  if (weekFrom || weekTo) {
    const shiftWhere: Record<string, unknown> = locationId
      ? { locationId: String(locationId) }
      : {};
    shiftWhere.startTime = {
      ...(weekFrom ? { gte: new Date(String(weekFrom)) } : {}),
      ...(weekTo ? { lte: new Date(new Date(String(weekTo)).getTime() + 7 * 24 * 60 * 60 * 1000) } : {}),
    };
    where.shift = shiftWhere;
  }

  const assignments = await prisma.shiftAssignment.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          desiredWeeklyHours: true,
        },
      },
      shift: {
        select: {
          id: true,
          isPremium: true,
          startTime: true,
          endTime: true,
        },
      },
    },
  });

  type Entry = {
    userId: string;
    firstName: string;
    lastName: string;
    totalHours: number;
    totalShifts: number;
    premiumShifts: number;
    desiredWeeklyHours: number | null;
  };

  const byUser = new Map<string, Entry>();

  for (const a of assignments) {
    const hours = durationHours(a.shiftStartTime, a.shiftEndTime);
    if (!byUser.has(a.userId)) {
      byUser.set(a.userId, {
        userId: a.userId,
        firstName: a.user.firstName,
        lastName: a.user.lastName,
        totalHours: 0,
        totalShifts: 0,
        premiumShifts: 0,
        desiredWeeklyHours: a.user.desiredWeeklyHours,
      });
    }
    const entry = byUser.get(a.userId)!;
    entry.totalHours += hours;
    entry.totalShifts += 1;
    if (a.shift.isPremium) entry.premiumShifts += 1;
  }

  const report = Array.from(byUser.values()).map((e) => ({
    ...e,
    totalHours: Number(e.totalHours.toFixed(2)),
  }));

  // Fairness score: 0–100 based on std deviation of premium shift share
  let premiumFairnessScore = 100;
  if (report.length > 1) {
    const shares = report.map((e) => (e.totalShifts > 0 ? e.premiumShifts / e.totalShifts : 0));
    const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
    const variance = shares.reduce((a, b) => a + (b - mean) ** 2, 0) / shares.length;
    const stdDev = Math.sqrt(variance);
    premiumFairnessScore = Math.max(0, Math.round(100 - stdDev * 200));
  }

  const totalPremiumShifts = report.reduce((a, e) => a + e.premiumShifts, 0);
  const avgHours =
    report.length > 0
      ? Number((report.reduce((a, e) => a + e.totalHours, 0) / report.length).toFixed(2))
      : 0;

  res.status(200).json({ report, premiumFairnessScore, totalPremiumShifts, avgHours });
});
