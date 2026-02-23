import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { authenticate } from "../../middleware/authenticate.js";
import { requireRole } from "../../middleware/require-role.js";

export const usersRouter = Router();
usersRouter.use(authenticate);

const createUserSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  role: z.enum(["ADMIN", "MANAGER", "STAFF"]),
  password: z.string().min(8),
  phone: z.string().optional(),
  desiredWeeklyHours: z.number().int().min(0).max(80).optional(),
});

const updateUserSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phone: z.string().optional().nullable(),
  role: z.enum(["ADMIN", "MANAGER", "STAFF"]).optional(),
  isActive: z.boolean().optional(),
  desiredWeeklyHours: z.number().int().min(0).max(80).optional().nullable(),
  password: z.string().min(8).optional(),
});

const availabilityRowSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  timezone: z.string().min(1),
});

const availabilitySchema = z.array(availabilityRowSchema);

// ── Notification preferences (must be before /:id to avoid collision) ────────

usersRouter.get("/me/notification-preferences", async (req, res) => {
  const userId = req.user!.id;
  const prefs = await prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
  res.status(200).json({ preferences: prefs });
});

usersRouter.put("/me/notification-preferences", async (req, res) => {
  const userId = req.user!.id;
  const { inApp, email } = req.body as { inApp?: boolean; email?: boolean };
  const prefs = await prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId, inApp: inApp ?? true, email: email ?? false },
    update: {
      ...(typeof inApp === "boolean" ? { inApp } : {}),
      ...(typeof email === "boolean" ? { email } : {}),
    },
  });
  res.status(200).json({ preferences: prefs });
});

// ── List all users ────────────────────────────────────────────────────────────

usersRouter.get("/", requireRole([Role.ADMIN, Role.MANAGER]), async (req, res) => {
  const role = req.query.role ? String(req.query.role) : undefined;
  const isActive = req.query.isActive !== undefined ? String(req.query.isActive) : undefined;
  const users = await prisma.user.findMany({
    where: {
      ...(role ? { role: role as Role } : {}),
      ...(isActive !== undefined ? { isActive: isActive === "true" } : {}),
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      phone: true,
      isActive: true,
      desiredWeeklyHours: true,
      createdAt: true,
      skills: {
        select: { skillId: true, skill: { select: { id: true, name: true } } },
      },
      certifications: {
        where: { revokedAt: null },
        select: { locationId: true, location: { select: { id: true, name: true } } },
      },
    },
    orderBy: [{ role: "asc" }, { lastName: "asc" }, { firstName: "asc" }],
  });
  res.status(200).json({ users });
});

// ── Create user (admin only) ──────────────────────────────────────────────────

usersRouter.post("/", requireRole([Role.ADMIN]), async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
    return;
  }
  const { email, firstName, lastName, role, password, phone, desiredWeeklyHours } = parsed.data;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ message: "Email already in use" });
    return;
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, firstName, lastName, role, passwordHash, phone, desiredWeeklyHours },
    select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true },
  });
  res.status(201).json({ user });
});

// ── Get user detail ───────────────────────────────────────────────────────────

usersRouter.get("/:id", requireRole([Role.ADMIN, Role.MANAGER]), async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: String(req.params.id) },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      phone: true,
      isActive: true,
      desiredWeeklyHours: true,
      createdAt: true,
      skills: {
        select: { skill: { select: { id: true, name: true } } },
      },
      certifications: {
        where: { revokedAt: null },
        select: { locationId: true, location: { select: { id: true, name: true } } },
      },
      managedLocations: {
        select: { locationId: true, location: { select: { id: true, name: true } } },
      },
    },
  });
  if (!user) {
    res.status(404).json({ message: "User not found" });
    return;
  }
  res.status(200).json({ user });
});

// ── Update user (admin only) ──────────────────────────────────────────────────

usersRouter.patch("/:id", requireRole([Role.ADMIN]), async (req, res) => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
    return;
  }
  const { password, ...fields } = parsed.data;
  const data: Record<string, unknown> = { ...fields };
  if (password) data.passwordHash = await bcrypt.hash(password, 10);
  try {
    const user = await prisma.user.update({
      where: { id: String(req.params.id) },
      data,
      select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true, desiredWeeklyHours: true },
    });
    res.status(200).json({ user });
  } catch {
    res.status(404).json({ message: "User not found" });
  }
});

// ── Skills ────────────────────────────────────────────────────────────────────

usersRouter.post("/:id/skills", requireRole([Role.ADMIN, Role.MANAGER]), async (req, res) => {
  const { skillId } = req.body as { skillId?: string };
  if (!skillId) {
    res.status(400).json({ message: "skillId required" });
    return;
  }
  const userId = String(req.params.id);
  await prisma.userSkill.upsert({
    where: { userId_skillId: { userId, skillId } },
    create: { userId, skillId },
    update: {},
  });
  res.status(200).json({ ok: true });
});

usersRouter.delete("/:id/skills/:skillId", requireRole([Role.ADMIN, Role.MANAGER]), async (req, res) => {
  await prisma.userSkill.deleteMany({
    where: { userId: String(req.params.id), skillId: String(req.params.skillId) },
  });
  res.status(200).json({ ok: true });
});

// ── Certifications ────────────────────────────────────────────────────────────

usersRouter.post("/:id/certifications", requireRole([Role.ADMIN, Role.MANAGER]), async (req, res) => {
  const { locationId } = req.body as { locationId?: string };
  if (!locationId) {
    res.status(400).json({ message: "locationId required" });
    return;
  }
  const userId = String(req.params.id);
  await prisma.locationCertification.upsert({
    where: { userId_locationId: { userId, locationId } },
    create: { userId, locationId },
    update: { revokedAt: null },
  });
  res.status(200).json({ ok: true });
});

usersRouter.delete("/:id/certifications/:locationId", requireRole([Role.ADMIN, Role.MANAGER]), async (req, res) => {
  try {
    await prisma.locationCertification.update({
      where: { userId_locationId: { userId: String(req.params.id), locationId: String(req.params.locationId) } },
      data: { revokedAt: new Date() },
    });
    res.status(200).json({ ok: true });
  } catch {
    res.status(404).json({ message: "Certification not found" });
  }
});

// ── Availability ──────────────────────────────────────────────────────────────

usersRouter.get("/:id/availability", async (req, res) => {
  const me = req.user!;
  const targetId = String(req.params.id);
  if (me.role === Role.STAFF && me.id !== targetId) {
    res.status(403).json({ message: "Forbidden" });
    return;
  }
  const availability = await prisma.availability.findMany({
    where: { userId: targetId },
    orderBy: { dayOfWeek: "asc" },
  });
  res.status(200).json({ availability });
});

usersRouter.put("/:id/availability", async (req, res) => {
  const me = req.user!;
  const targetId = String(req.params.id);
  if (me.role === Role.STAFF && me.id !== targetId) {
    res.status(403).json({ message: "Forbidden" });
    return;
  }
  const parsed = availabilitySchema.safeParse(req.body.availability);
  if (!parsed.success) {
    res.status(400).json({ message: "Invalid availability data", errors: parsed.error.flatten() });
    return;
  }
  await prisma.$transaction([
    prisma.availability.deleteMany({ where: { userId: targetId } }),
    ...parsed.data.map((entry) =>
      prisma.availability.create({ data: { userId: targetId, ...entry } }),
    ),
  ]);
  const availability = await prisma.availability.findMany({
    where: { userId: targetId },
    orderBy: { dayOfWeek: "asc" },
  });
  res.status(200).json({ availability });
});
