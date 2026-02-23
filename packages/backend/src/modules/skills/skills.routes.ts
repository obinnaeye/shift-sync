import { Role } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { authenticate } from "../../middleware/authenticate.js";
import { requireRole } from "../../middleware/require-role.js";

export const skillsRouter = Router();
skillsRouter.use(authenticate);

skillsRouter.get("/", async (_req, res) => {
  const skills = await prisma.skill.findMany({ orderBy: { name: "asc" } });
  res.status(200).json({ skills });
});

skillsRouter.post("/", requireRole([Role.ADMIN]), async (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) {
    res.status(400).json({ message: "name is required" });
    return;
  }
  try {
    const skill = await prisma.skill.create({ data: { name: name.trim() } });
    res.status(201).json({ skill });
  } catch {
    res.status(409).json({ message: "Skill name already exists" });
  }
});
