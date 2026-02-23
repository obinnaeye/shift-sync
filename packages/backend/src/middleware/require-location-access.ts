import { Role } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";

export async function hasLocationAccess(userId: string, role: Role, locationId: string): Promise<boolean> {
  if (role === Role.ADMIN) {
    return true;
  }
  if (role !== Role.MANAGER) {
    return false;
  }

  const manager = await prisma.locationManager.findUnique({
    where: { userId_locationId: { userId, locationId } },
    select: { userId: true },
  });
  return Boolean(manager);
}

export async function requireLocationAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }

  if (req.user.role === Role.ADMIN) {
    next();
    return;
  }

  const locationId =
    (req.params.locationId as string | undefined) ??
    (req.body?.locationId as string | undefined) ??
    (req.query.locationId as string | undefined);

  if (!locationId) {
    res.status(400).json({ message: "locationId is required for access check" });
    return;
  }

  const allowed = await hasLocationAccess(req.user.id, req.user.role, locationId);
  if (!allowed) {
    res.status(403).json({ message: "Forbidden for location" });
    return;
  }
  next();
}
