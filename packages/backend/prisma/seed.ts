import path from "node:path";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { AssignmentStatus, PrismaClient, Role, ShiftStatus } from "@prisma/client";
import { toZonedTime } from "date-fns-tz";

dotenv.config({ path: path.resolve(import.meta.dirname, "../.env") });

const prisma = new PrismaClient();

// ── Fixed IDs ─────────────────────────────────────────────────────────────────

const LOC = {
  venice: "11111111-1111-1111-1111-111111111111",
  santaMonica: "22222222-2222-2222-2222-222222222222",
  miami: "33333333-3333-3333-3333-333333333333",
  southBeach: "44444444-4444-4444-4444-444444444444",
};

const SKILL = {
  bartender: "sk000001-0000-0000-0000-000000000000",
  lineCook: "sk000002-0000-0000-0000-000000000000",
  server: "sk000003-0000-0000-0000-000000000000",
  host: "sk000004-0000-0000-0000-000000000000",
};

const USER = {
  manager1: "mg000001-0000-0000-0000-000000000000", // Alice (LA mgr)
  manager2: "mg000002-0000-0000-0000-000000000000", // Bob (FL mgr)
  carol: "st000001-0000-0000-0000-000000000000", // Bartender+Server, certs: Venice, SantaMonica, Miami
  david: "st000002-0000-0000-0000-000000000000", // LineCook, certs: Miami, SouthBeach
  emma: "st000003-0000-0000-0000-000000000000", // Server+Host, certs: all 4 (approaches overtime)
  frank: "st000004-0000-0000-0000-000000000000", // Bartender, certs: Venice, SouthBeach
  grace: "st000005-0000-0000-0000-000000000000", // Host+Server, certs: SantaMonica, Miami
  henry: "st000006-0000-0000-0000-000000000000", // LineCook+Server, certs: Venice, SantaMonica
};

// ── Week helpers ───────────────────────────────────────────────────────────────

function getThisMonday(): Date {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff));
}

/** UTC time on Monday + offsetDays days at localHour in given timezone */
function shiftAt(monday: Date, offsetDays: number, localHour: number, tz: string): Date {
  // Add days to get the target day in UTC
  const candidate = new Date(monday.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  // We need local midnight of that day in tz, then add localHour
  const zoned = toZonedTime(candidate, tz);
  zoned.setHours(localHour, 0, 0, 0);
  // Convert back to UTC
  return new Date(candidate.getTime() + (localHour - toZonedTime(candidate, tz).getHours()) * 3600000
    + (zoned.getHours() - toZonedTime(candidate, tz).getHours()) * 3600000);
}

/** Returns UTC Date for `localHour:00` on `monday + offsetDays` in `tz` */
function utcFor(monday: Date, offsetDays: number, localHour: number, tz: string): Date {
  // Build the date string as if we're working in localtime
  const base = new Date(monday.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  const yr = base.getUTCFullYear();
  const mo = String(base.getUTCMonth() + 1).padStart(2, "0");
  const dy = String(base.getUTCDate()).padStart(2, "0");
  const hr = String(localHour).padStart(2, "0");
  // Parse in local tz using toZonedTime reverse (offset trick)
  const localDateStr = `${yr}-${mo}-${dy}T${hr}:00:00`;
  const tempDate = new Date(localDateStr + "Z");
  const zoned = toZonedTime(tempDate, tz);
  const offsetMs = tempDate.getTime() - zoned.getTime();
  return new Date(tempDate.getTime() + offsetMs);
}

function isPremium(startTime: Date, tz: string): boolean {
  const local = toZonedTime(startTime, tz);
  const day = local.getDay();
  const hour = local.getHours();
  return (day === 5 || day === 6) && hour >= 17;
}

function weekStart(date: Date, tz: string): Date {
  const zoned = toZonedTime(date, tz);
  const day = zoned.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  zoned.setDate(zoned.getDate() + diff);
  zoned.setHours(0, 0, 0, 0);
  return new Date(Date.UTC(zoned.getFullYear(), zoned.getMonth(), zoned.getDate()));
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const monday = getThisMonday();
  const LA = "America/Los_Angeles";
  const ET = "America/New_York";

  // Locations
  await prisma.location.createMany({
    data: [
      { id: LOC.venice, name: "Coastal Eats - Venice Beach", address: "123 Ocean Front Walk, Venice, CA", timezone: LA },
      { id: LOC.santaMonica, name: "Coastal Eats - Santa Monica", address: "456 Santa Monica Blvd, Santa Monica, CA", timezone: LA },
      { id: LOC.miami, name: "Coastal Eats - Miami Beach", address: "789 Collins Ave, Miami Beach, FL", timezone: ET },
      { id: LOC.southBeach, name: "Coastal Eats - South Beach", address: "101 Ocean Dr, Miami Beach, FL", timezone: ET },
    ],
    skipDuplicates: true,
  });

  // Skills
  await prisma.skill.createMany({
    data: [
      { id: SKILL.bartender, name: "Bartender" },
      { id: SKILL.lineCook, name: "Line Cook" },
      { id: SKILL.server, name: "Server" },
      { id: SKILL.host, name: "Host" },
    ],
    skipDuplicates: true,
  });

  // Passwords
  const pw = async (plain: string) => bcrypt.hash(plain, 10);
  const staffPass = await pw("Staff1234!");
  const mgrPass = await pw("Manager1234!");

  if (process.env.NODE_ENV === "production" && !process.env.SEED_ADMIN_PASSWORD) {
    throw new Error("SEED_ADMIN_PASSWORD must be set in production");
  }
  const adminPass = await pw(process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!");

  // Admin
  await prisma.user.upsert({
    where: { email: "admin@shiftsync.local" },
    update: { firstName: "ShiftSync", lastName: "Admin", role: Role.ADMIN, passwordHash: adminPass, isActive: true },
    create: { email: "admin@shiftsync.local", firstName: "ShiftSync", lastName: "Admin", role: Role.ADMIN, passwordHash: adminPass, isActive: true },
  });

  // Managers
  await prisma.user.upsert({
    where: { email: "alice.manager@shiftsync.local" },
    update: { firstName: "Alice", lastName: "Nguyen", role: Role.MANAGER, passwordHash: mgrPass },
    create: { id: USER.manager1, email: "alice.manager@shiftsync.local", firstName: "Alice", lastName: "Nguyen", role: Role.MANAGER, passwordHash: mgrPass },
  });
  await prisma.user.upsert({
    where: { email: "bob.manager@shiftsync.local" },
    update: { firstName: "Bob", lastName: "Torres", role: Role.MANAGER, passwordHash: mgrPass },
    create: { id: USER.manager2, email: "bob.manager@shiftsync.local", firstName: "Bob", lastName: "Torres", role: Role.MANAGER, passwordHash: mgrPass },
  });

  // Manager location assignments
  await prisma.locationManager.createMany({
    data: [
      { userId: USER.manager1, locationId: LOC.venice },
      { userId: USER.manager1, locationId: LOC.santaMonica },
      { userId: USER.manager2, locationId: LOC.miami },
      { userId: USER.manager2, locationId: LOC.southBeach },
    ],
    skipDuplicates: true,
  });

  // Staff users
  const staffUsers = [
    { id: USER.carol, email: "carol.smith@shiftsync.local", firstName: "Carol", lastName: "Smith", desiredWeeklyHours: 32 },
    { id: USER.david, email: "david.jones@shiftsync.local", firstName: "David", lastName: "Jones", desiredWeeklyHours: 24 },
    { id: USER.emma, email: "emma.williams@shiftsync.local", firstName: "Emma", lastName: "Williams", desiredWeeklyHours: 40 },
    { id: USER.frank, email: "frank.brown@shiftsync.local", firstName: "Frank", lastName: "Brown", desiredWeeklyHours: 30 },
    { id: USER.grace, email: "grace.davis@shiftsync.local", firstName: "Grace", lastName: "Davis", desiredWeeklyHours: 28 },
    { id: USER.henry, email: "henry.wilson@shiftsync.local", firstName: "Henry", lastName: "Wilson", desiredWeeklyHours: 32 },
  ];

  for (const u of staffUsers) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { firstName: u.firstName, lastName: u.lastName, role: Role.STAFF, passwordHash: staffPass, desiredWeeklyHours: u.desiredWeeklyHours },
      create: { ...u, role: Role.STAFF, passwordHash: staffPass },
    });
  }

  // Skills per user
  await prisma.userSkill.createMany({
    data: [
      { userId: USER.carol, skillId: SKILL.bartender },
      { userId: USER.carol, skillId: SKILL.server },
      { userId: USER.david, skillId: SKILL.lineCook },
      { userId: USER.emma, skillId: SKILL.server },
      { userId: USER.emma, skillId: SKILL.host },
      { userId: USER.frank, skillId: SKILL.bartender },
      { userId: USER.grace, skillId: SKILL.host },
      { userId: USER.grace, skillId: SKILL.server },
      { userId: USER.henry, skillId: SKILL.lineCook },
      { userId: USER.henry, skillId: SKILL.server },
    ],
    skipDuplicates: true,
  });

  // Location certifications
  await prisma.locationCertification.createMany({
    data: [
      // Carol: Venice, SantaMonica, Miami (Bartender+Server across 2 timezones)
      { userId: USER.carol, locationId: LOC.venice },
      { userId: USER.carol, locationId: LOC.santaMonica },
      { userId: USER.carol, locationId: LOC.miami },
      // David: Miami, SouthBeach (FL only)
      { userId: USER.david, locationId: LOC.miami },
      { userId: USER.david, locationId: LOC.southBeach },
      // Emma: all locations (evaluates overtime)
      { userId: USER.emma, locationId: LOC.venice },
      { userId: USER.emma, locationId: LOC.santaMonica },
      { userId: USER.emma, locationId: LOC.miami },
      { userId: USER.emma, locationId: LOC.southBeach },
      // Frank: Venice, SouthBeach
      { userId: USER.frank, locationId: LOC.venice },
      { userId: USER.frank, locationId: LOC.southBeach },
      // Grace: SantaMonica, Miami
      { userId: USER.grace, locationId: LOC.santaMonica },
      { userId: USER.grace, locationId: LOC.miami },
      // Henry: Venice, SantaMonica (LA only — timezone tangle scenario)
      { userId: USER.henry, locationId: LOC.venice },
      { userId: USER.henry, locationId: LOC.santaMonica },
    ],
    skipDuplicates: true,
  });

  // Henry's availability: Mon-Fri 9am-5pm LA time
  // (timezone tangle: if assigned to a Miami shift at 9am ET, that is 6am LA — outside window)
  await prisma.availability.deleteMany({ where: { userId: USER.henry } });
  await prisma.availability.createMany({
    data: [1, 2, 3, 4, 5].map((day) => ({
      userId: USER.henry,
      dayOfWeek: day,
      startTime: "09:00",
      endTime: "17:00",
      timezone: LA,
      isRecurring: true,
    })),
  });

  // Emma's availability: every day 8am-11pm ET
  await prisma.availability.deleteMany({ where: { userId: USER.emma } });
  await prisma.availability.createMany({
    data: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
      userId: USER.emma,
      dayOfWeek: day,
      startTime: "08:00",
      endTime: "23:00",
      timezone: ET,
      isRecurring: true,
    })),
  });

  // ── Shifts ─────────────────────────────────────────────────────────────────
  // We use upsert by ID so repeated seeds update times to the current week

  type ShiftData = {
    id: string;
    locationId: string;
    skillId: string;
    start: Date;
    end: Date;
    headcount: number;
    tz: string;
    status: ShiftStatus;
    creatorId: string;
  };

  const SHIFTS: ShiftData[] = [
    // Venice Beach — LA timezone
    { id: "sh000001-0000-0000-0000-000000000000", locationId: LOC.venice, skillId: SKILL.server, start: utcFor(monday, 0, 9, LA), end: utcFor(monday, 0, 17, LA), headcount: 2, tz: LA, status: ShiftStatus.PUBLISHED, creatorId: USER.manager1 },
    { id: "sh000002-0000-0000-0000-000000000000", locationId: LOC.venice, skillId: SKILL.lineCook, start: utcFor(monday, 2, 9, LA), end: utcFor(monday, 2, 17, LA), headcount: 1, tz: LA, status: ShiftStatus.PUBLISHED, creatorId: USER.manager1 },
    { id: "sh000003-0000-0000-0000-000000000000", locationId: LOC.venice, skillId: SKILL.bartender, start: utcFor(monday, 4, 17, LA), end: utcFor(monday, 4, 23, LA), headcount: 2, tz: LA, status: ShiftStatus.PUBLISHED, creatorId: USER.manager1 }, // Fri 5pm-11pm PREMIUM
    { id: "sh000004-0000-0000-0000-000000000000", locationId: LOC.venice, skillId: SKILL.server, start: utcFor(monday, 5, 17, LA), end: utcFor(monday, 5, 23, LA), headcount: 2, tz: LA, status: ShiftStatus.PUBLISHED, creatorId: USER.manager1 }, // Sat 5pm-11pm PREMIUM
    // Santa Monica — LA timezone
    { id: "sh000005-0000-0000-0000-000000000000", locationId: LOC.santaMonica, skillId: SKILL.host, start: utcFor(monday, 1, 10, LA), end: utcFor(monday, 1, 16, LA), headcount: 1, tz: LA, status: ShiftStatus.PUBLISHED, creatorId: USER.manager1 },
    { id: "sh000006-0000-0000-0000-000000000000", locationId: LOC.santaMonica, skillId: SKILL.server, start: utcFor(monday, 4, 17, LA), end: utcFor(monday, 4, 23, LA), headcount: 2, tz: LA, status: ShiftStatus.PUBLISHED, creatorId: USER.manager1 }, // Fri PM PREMIUM
    // Miami Beach — ET timezone
    { id: "sh000007-0000-0000-0000-000000000000", locationId: LOC.miami, skillId: SKILL.server, start: utcFor(monday, 0, 9, ET), end: utcFor(monday, 0, 17, ET), headcount: 2, tz: ET, status: ShiftStatus.PUBLISHED, creatorId: USER.manager2 },
    { id: "sh000008-0000-0000-0000-000000000000", locationId: LOC.miami, skillId: SKILL.server, start: utcFor(monday, 1, 9, ET), end: utcFor(monday, 1, 17, ET), headcount: 1, tz: ET, status: ShiftStatus.PUBLISHED, creatorId: USER.manager2 },
    { id: "sh000009-0000-0000-0000-000000000000", locationId: LOC.miami, skillId: SKILL.server, start: utcFor(monday, 2, 9, ET), end: utcFor(monday, 2, 17, ET), headcount: 1, tz: ET, status: ShiftStatus.PUBLISHED, creatorId: USER.manager2 },
    { id: "sh000010-0000-0000-0000-000000000000", locationId: LOC.miami, skillId: SKILL.server, start: utcFor(monday, 3, 9, ET), end: utcFor(monday, 3, 17, ET), headcount: 1, tz: ET, status: ShiftStatus.PUBLISHED, creatorId: USER.manager2 },
    { id: "sh000011-0000-0000-0000-000000000000", locationId: LOC.miami, skillId: SKILL.bartender, start: utcFor(monday, 4, 17, ET), end: utcFor(monday, 4, 23, ET), headcount: 2, tz: ET, status: ShiftStatus.PUBLISHED, creatorId: USER.manager2 }, // Fri PM ET PREMIUM
    { id: "sh000012-0000-0000-0000-000000000000", locationId: LOC.miami, skillId: SKILL.server, start: utcFor(monday, 5, 17, ET), end: utcFor(monday, 5, 23, ET), headcount: 2, tz: ET, status: ShiftStatus.PUBLISHED, creatorId: USER.manager2 }, // Sat PM ET PREMIUM
    // South Beach — ET timezone (DRAFT, not yet published)
    { id: "sh000013-0000-0000-0000-000000000000", locationId: LOC.southBeach, skillId: SKILL.lineCook, start: utcFor(monday, 2, 10, ET), end: utcFor(monday, 2, 18, ET), headcount: 1, tz: ET, status: ShiftStatus.DRAFT, creatorId: USER.manager2 },
    { id: "sh000014-0000-0000-0000-000000000000", locationId: LOC.southBeach, skillId: SKILL.bartender, start: utcFor(monday, 4, 17, ET), end: utcFor(monday, 4, 23, ET), headcount: 2, tz: ET, status: ShiftStatus.PUBLISHED, creatorId: USER.manager2 }, // Fri PM PREMIUM
  ];

  for (const s of SHIFTS) {
    const sw = weekStart(s.start, s.tz);
    const prem = isPremium(s.start, s.tz);
    const editCutoffAt = new Date(s.start.getTime() - 48 * 60 * 60 * 1000);
    await prisma.shift.upsert({
      where: { id: s.id },
      update: { startTime: s.start, endTime: s.end, headcount: s.headcount, isPremium: prem, scheduleWeek: sw, editCutoffAt, status: s.status },
      create: { id: s.id, locationId: s.locationId, skillId: s.skillId, startTime: s.start, endTime: s.end, headcount: s.headcount, isPremium: prem, status: s.status, scheduleWeek: sw, editCutoffAt, createdBy: s.creatorId },
    });
  }

  // ── Assignments ────────────────────────────────────────────────────────────
  // Emma: assigned Mon–Thu at Miami (8h each = 32h) — overtime scenario
  // Carol: assigned Venice Mon, Venice Fri PM, Miami Fri PM bartender
  // Frank: Venice Fri PM, SouthBeach Fri PM
  // Grace: SantaMonica Tue Host, Miami Mon+Fri
  // Henry: Venice Mon

  type AssignData = {
    id: string;
    shiftId: string;
    userId: string;
    managerId: string;
  };

  const getShift = async (id: string) => prisma.shift.findUniqueOrThrow({ where: { id } });

  const ASSIGNS: AssignData[] = [
    // Emma (32h at Miami Mon-Thu)
    { id: "as000001-0000-0000-0000-000000000000", shiftId: "sh000007", userId: USER.emma, managerId: USER.manager2 },
    { id: "as000002-0000-0000-0000-000000000000", shiftId: "sh000008", userId: USER.emma, managerId: USER.manager2 },
    { id: "as000003-0000-0000-0000-000000000000", shiftId: "sh000009", userId: USER.emma, managerId: USER.manager2 },
    { id: "as000004-0000-0000-0000-000000000000", shiftId: "sh000010", userId: USER.emma, managerId: USER.manager2 },
    // Carol
    { id: "as000005-0000-0000-0000-000000000000", shiftId: "sh000001", userId: USER.carol, managerId: USER.manager1 }, // Venice Mon server
    { id: "as000006-0000-0000-0000-000000000000", shiftId: "sh000003", userId: USER.carol, managerId: USER.manager1 }, // Venice Fri PM bartender PREMIUM
    // Frank
    { id: "as000007-0000-0000-0000-000000000000", shiftId: "sh000003", userId: USER.frank, managerId: USER.manager1 }, // Venice Fri PM bartender PREMIUM (2nd slot)
    { id: "as000008-0000-0000-0000-000000000000", shiftId: "sh000014", userId: USER.frank, managerId: USER.manager2 }, // SouthBeach Fri PM PREMIUM
    // Henry
    { id: "as000009-0000-0000-0000-000000000000", shiftId: "sh000001", userId: USER.henry, managerId: USER.manager1 }, // Venice Mon server (2nd slot)
    { id: "as000010-0000-0000-0000-000000000000", shiftId: "sh000002", userId: USER.henry, managerId: USER.manager1 }, // Venice Wed line cook
    // Grace
    { id: "as000011-0000-0000-0000-000000000000", shiftId: "sh000005", userId: USER.grace, managerId: USER.manager1 }, // SantaMonica Tue host
    { id: "as000012-0000-0000-0000-000000000000", shiftId: "sh000007", userId: USER.grace, managerId: USER.manager2 }, // Miami Mon server (2nd slot)
  ];

  // Reconstruct full UUID from short shiftId like "sh000007" → "sh000007-0000-0000-0000-000000000000"
  for (const a of ASSIGNS) {
    const shiftId = `${a.shiftId.slice(0, 2)}000${a.shiftId.slice(5)}-0000-0000-0000-000000000000`;

    try {
      const shift = await getShift(shiftId);
      await prisma.shiftAssignment.upsert({
        where: { shiftId_userId: { shiftId: shift.id, userId: a.userId } },
        update: { status: AssignmentStatus.CONFIRMED, shiftStartTime: shift.startTime, shiftEndTime: shift.endTime },
        create: {
          shiftId: shift.id,
          userId: a.userId,
          assignedBy: a.managerId,
          status: AssignmentStatus.CONFIRMED,
          shiftStartTime: shift.startTime,
          shiftEndTime: shift.endTime,
        },
      });
    } catch {
      // skip if shift not found (shouldn't happen)
    }
  }

  console.log("✅ Seed complete.");
  console.log("   Locations:  4 (2 LA, 2 ET)");
  console.log("   Skills:     4 (Bartender, Line Cook, Server, Host)");
  console.log("   Users:      9 (1 admin, 2 managers, 6 staff)");
  console.log("   Shifts:     14 (12 PUBLISHED, 1 DRAFT, 5 PREMIUM)");
  console.log("   Assignments: ~12 (Emma is at 32h — overtime scenario ready)");
  console.log("");
  console.log("   Login credentials:");
  console.log("   admin@shiftsync.local  / ChangeMe123! (or SEED_ADMIN_PASSWORD)");
  console.log("   alice.manager@shiftsync.local / Manager1234!  (manages LA)");
  console.log("   bob.manager@shiftsync.local   / Manager1234!  (manages FL)");
  console.log("   carol.smith@shiftsync.local   / Staff1234!");
  console.log("   emma.williams@shiftsync.local / Staff1234!  (32h, approaching overtime)");
  console.log("   henry.wilson@shiftsync.local  / Staff1234!  (LA-only availability — timezone tangle)");
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
