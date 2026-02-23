import { AssignmentStatus, Role } from "@prisma/client";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { prisma } from "../../lib/prisma.js";

export type ConstraintSeverity = "BLOCKING" | "WARNING";

export type ConstraintViolation = {
  passed: boolean;
  severity: ConstraintSeverity;
  rule: string;
  message: string;
  overrideApplied?: boolean;
};

type CheckInput = {
  shiftId: string;
  staffId: string;
  actorId: string;
  forceOverride?: boolean;
  overrideReason?: string;
};

export type ConstraintResult = {
  violations: ConstraintViolation[];
  hasBlocking: boolean;
  suggestions: Array<{ userId: string; name: string; reason: string }>;
  overrideTypes: string[];
};

const HOURS = {
  DAILY_HARD_LIMIT: 12,
  WEEKLY_HARD_LIMIT: 40,
  DAILY_WARNING: 8,
  WEEKLY_WARNING: 35,
  REST_GAP: 10,
};

export class ConstraintEngine {
  async check(input: CheckInput): Promise<ConstraintResult> {
    const shift = await prisma.shift.findUnique({
      where: { id: input.shiftId },
      include: { location: true, skill: true },
    });

    if (!shift) {
      return {
        violations: [
          {
            passed: false,
            severity: "BLOCKING",
            rule: "SHIFT_EXISTS",
            message: "Shift not found",
          },
        ],
        hasBlocking: true,
        suggestions: [],
        overrideTypes: [],
      };
    }

    const user = await prisma.user.findUnique({
      where: { id: input.staffId },
      include: { skills: true },
    });

    if (!user || !user.isActive || user.role !== Role.STAFF) {
      return {
        violations: [
          {
            passed: false,
            severity: "BLOCKING",
            rule: "STAFF_VALID",
            message: "Target user is not an active staff member",
          },
        ],
        hasBlocking: true,
        suggestions: [],
        overrideTypes: [],
      };
    }

    const existingAssignments = await prisma.shiftAssignment.findMany({
      where: {
        userId: input.staffId,
        status: AssignmentStatus.CONFIRMED,
      },
      include: {
        shift: {
          include: { location: true },
        },
      },
    });

    const violations: ConstraintViolation[] = [];
    const overrideTypes: string[] = [];
    const add = (v: ConstraintViolation) => violations.push(v);
    const shiftDurationHours =
      (shift.endTime.getTime() - shift.startTime.getTime()) / (1000 * 60 * 60);
    const shiftLocalDayKey = this.dayKeyInTimezone(shift.startTime, shift.location.timezone);

    // 1. CERTIFICATION
    const cert = await prisma.locationCertification.findUnique({
      where: { userId_locationId: { userId: input.staffId, locationId: shift.locationId } },
    });
    if (!cert || cert.revokedAt) {
      add({
        passed: false,
        severity: "BLOCKING",
        rule: "CERTIFICATION",
        message: "Staff is not actively certified for this location",
      });
    }

    // 2. SKILL_MATCH
    const hasSkill = user.skills.some((s) => s.skillId === shift.skillId);
    if (!hasSkill) {
      add({
        passed: false,
        severity: "BLOCKING",
        rule: "SKILL_MATCH",
        message: "Staff does not have the required skill",
      });
    }

    // 3. AVAILABILITY
    const availabilityViolation = await this.checkAvailability({
      staffId: input.staffId,
      shiftStart: shift.startTime,
      shiftEnd: shift.endTime,
    });
    if (availabilityViolation) add(availabilityViolation);

    // 4. NO_OVERLAP
    const overlap = existingAssignments.find((a) => {
      if (a.shiftId === shift.id) return false;
      return a.shiftEndTime > shift.startTime && a.shiftStartTime < shift.endTime;
    });
    if (overlap) {
      add({
        passed: false,
        severity: "BLOCKING",
        rule: "NO_OVERLAP",
        message: "Staff has an overlapping confirmed shift",
      });
    }

    // 5. REST_GAP
    const restViolation = existingAssignments.find((a) => {
      if (a.shiftId === shift.id) return false;
      if (a.shiftEndTime <= shift.startTime) {
        const gapHours = (shift.startTime.getTime() - a.shiftEndTime.getTime()) / (1000 * 60 * 60);
        return gapHours < HOURS.REST_GAP;
      }
      if (a.shiftStartTime >= shift.endTime) {
        const gapHours = (a.shiftStartTime.getTime() - shift.endTime.getTime()) / (1000 * 60 * 60);
        return gapHours < HOURS.REST_GAP;
      }
      return false;
    });
    if (restViolation) {
      add({
        passed: false,
        severity: "BLOCKING",
        rule: "REST_GAP",
        message: "Staff must have at least 10h rest gap between shifts",
      });
    }

    const sameDayHours = existingAssignments
      .filter((a) => this.dayKeyInTimezone(a.shiftStartTime, shift.location.timezone) === shiftLocalDayKey)
      .reduce((acc, a) => acc + this.durationHours(a.shiftStartTime, a.shiftEndTime), 0);
    const projectedDaily = sameDayHours + shiftDurationHours;

    // 6. DAILY_HARD_LIMIT (override)
    if (projectedDaily > HOURS.DAILY_HARD_LIMIT) {
      const overrideApplied = Boolean(input.forceOverride && input.overrideReason);
      add({
        passed: overrideApplied,
        severity: "BLOCKING",
        rule: "DAILY_HARD_LIMIT",
        message: `Projected daily hours ${projectedDaily.toFixed(2)} exceed 12h`,
        overrideApplied,
      });
      if (overrideApplied) {
        overrideTypes.push("12H_DAILY_LIMIT");
      }
    }

    const shiftWeekStart = this.isoWeekStartInTimezone(shift.startTime, shift.location.timezone);
    const weekHours = existingAssignments
      .filter((a) => this.isoWeekStartInTimezone(a.shiftStartTime, shift.location.timezone) === shiftWeekStart)
      .reduce((acc, a) => acc + this.durationHours(a.shiftStartTime, a.shiftEndTime), 0);
    const projectedWeekly = weekHours + shiftDurationHours;

    // 7. WEEKLY_HARD_LIMIT
    if (projectedWeekly > HOURS.WEEKLY_HARD_LIMIT) {
      add({
        passed: false,
        severity: "BLOCKING",
        rule: "WEEKLY_HARD_LIMIT",
        message: `Projected weekly hours ${projectedWeekly.toFixed(2)} exceed 40h`,
      });
    }

    // 8. WEEKLY_WARNING
    if (projectedWeekly >= HOURS.WEEKLY_WARNING && projectedWeekly < HOURS.WEEKLY_HARD_LIMIT) {
      add({
        passed: true,
        severity: "WARNING",
        rule: "WEEKLY_WARNING",
        message: `Projected weekly hours ${projectedWeekly.toFixed(2)} in warning range (35-39h)`,
      });
    }

    // 9. DAILY_WARNING
    if (projectedDaily > HOURS.DAILY_WARNING && projectedDaily <= HOURS.DAILY_HARD_LIMIT) {
      add({
        passed: true,
        severity: "WARNING",
        rule: "DAILY_WARNING",
        message: `Projected daily hours ${projectedDaily.toFixed(2)} exceed 8h`,
      });
    }

    // 10/11. consecutive day checks
    const consecutiveDays = this.calculateConsecutiveDays(existingAssignments, shift.startTime, shift.location.timezone);
    if (consecutiveDays >= 6) {
      add({
        passed: true,
        severity: "WARNING",
        rule: "CONSECUTIVE_6TH_DAY",
        message: "This assignment lands on staff's 6th consecutive worked day",
      });
    }
    if (consecutiveDays >= 7) {
      const overrideApplied = Boolean(input.forceOverride && input.overrideReason);
      add({
        passed: overrideApplied,
        severity: "BLOCKING",
        rule: "CONSECUTIVE_7TH_DAY",
        message: "This assignment lands on staff's 7th consecutive worked day",
        overrideApplied,
      });
      if (overrideApplied) {
        overrideTypes.push("7TH_CONSECUTIVE_DAY");
      }
    }

    const hasBlocking = violations.some((v) => v.severity === "BLOCKING" && !v.passed);
    const suggestions = hasBlocking
      ? await this.buildSuggestions({ shiftId: shift.id, locationId: shift.locationId, skillId: shift.skillId, excludeUserId: input.staffId })
      : [];
    return { violations, hasBlocking, suggestions, overrideTypes };
  }

  private durationHours(start: Date, end: Date): number {
    return (end.getTime() - start.getTime()) / (1000 * 60 * 60);
  }

  private dayKeyInTimezone(date: Date, timezone: string): string {
    const zoned = toZonedTime(date, timezone);
    const y = zoned.getFullYear();
    const m = String(zoned.getMonth() + 1).padStart(2, "0");
    const d = String(zoned.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  private isoWeekStartInTimezone(date: Date, timezone: string): string {
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

  private calculateConsecutiveDays(
    assignments: Array<{ shiftStartTime: Date; shift: { location: { timezone: string } } }>,
    candidateStart: Date,
    candidateTimezone: string,
  ): number {
    const workedDays = new Set<string>();
    for (const a of assignments) {
      workedDays.add(this.dayKeyInTimezone(a.shiftStartTime, a.shift.location.timezone));
    }
    const targetZoned = toZonedTime(candidateStart, candidateTimezone);
    let consecutive = 1;
    let cursor = new Date(targetZoned);
    while (true) {
      cursor.setDate(cursor.getDate() - 1);
      const y = cursor.getFullYear();
      const m = String(cursor.getMonth() + 1).padStart(2, "0");
      const d = String(cursor.getDate()).padStart(2, "0");
      const key = `${y}-${m}-${d}`;
      if (!workedDays.has(key)) break;
      consecutive += 1;
    }
    return consecutive;
  }

  private async checkAvailability(input: {
    staffId: string;
    shiftStart: Date;
    shiftEnd: Date;
  }): Promise<ConstraintViolation | null> {
    const records = await prisma.availability.findMany({
      where: { userId: input.staffId, isRecurring: true },
    });
    if (records.length === 0) {
      return {
        passed: false,
        severity: "BLOCKING",
        rule: "AVAILABILITY",
        message: "No recurring availability is configured for staff",
      };
    }

    let recurring: (typeof records)[number] | null = null;
    for (const record of records) {
      const maybeDay = toZonedTime(input.shiftStart, record.timezone).getDay();
      if (record.dayOfWeek === maybeDay) {
        recurring = record;
        break;
      }
    }
    if (!recurring) {
      return {
        passed: false,
        severity: "BLOCKING",
        rule: "AVAILABILITY",
        message: "Staff is unavailable for this day of week",
      };
    }
    const timezone = recurring.timezone;
    const dateKey = this.dayKeyInTimezone(input.shiftStart, timezone);

    const exception = await prisma.availabilityException.findFirst({
      where: { userId: input.staffId, date: new Date(`${dateKey}T00:00:00.000Z`) },
    });

    if (exception) {
      if (!exception.isAvailable || !exception.startTime || !exception.endTime) {
        return {
          passed: false,
          severity: "BLOCKING",
          rule: "AVAILABILITY",
          message: "Staff has an unavailable exception for this date",
        };
      }
      const availStart = fromZonedTime(`${dateKey}T${exception.startTime}:00`, timezone);
      const availEnd = fromZonedTime(`${dateKey}T${exception.endTime}:00`, timezone);
      if (input.shiftStart < availStart || input.shiftEnd > availEnd) {
        return {
          passed: false,
          severity: "BLOCKING",
          rule: "AVAILABILITY",
          message: "Shift is outside availability exception window",
        };
      }
      return null;
    }

    const availStart = fromZonedTime(`${dateKey}T${recurring.startTime}:00`, timezone);
    const availEnd = fromZonedTime(`${dateKey}T${recurring.endTime}:00`, timezone);
    if (input.shiftStart < availStart || input.shiftEnd > availEnd) {
      return {
        passed: false,
        severity: "BLOCKING",
        rule: "AVAILABILITY",
        message: "Shift is outside recurring availability window",
      };
    }

    return null;
  }

  private async buildSuggestions(input: {
    shiftId: string;
    locationId: string;
    skillId: string;
    excludeUserId: string;
  }): Promise<Array<{ userId: string; name: string; reason: string }>> {
    const users = await prisma.user.findMany({
      where: {
        id: { not: input.excludeUserId },
        role: Role.STAFF,
        isActive: true,
        certifications: { some: { locationId: input.locationId, revokedAt: null } },
        skills: { some: { skillId: input.skillId } },
      },
      select: { id: true, firstName: true, lastName: true },
      take: 3,
    });
    return users.map((u) => ({
      userId: u.id,
      name: `${u.firstName} ${u.lastName}`.trim(),
      reason: "Certified at location and has required skill",
    }));
  }
}

export const constraintEngine = new ConstraintEngine();
