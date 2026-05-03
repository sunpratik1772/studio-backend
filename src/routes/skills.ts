import { Router } from "express";
import { db } from "@workspace/db";
import { skillsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  ListSkillsQueryParams,
  CreateSkillBody,
  UpdateSkillBody,
  UpdateSkillParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/skills", async (req, res) => {
  const parsed = ListSkillsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  let skills = await db.select().from(skillsTable);
  const { enabled, category } = parsed.data;
  if (enabled !== undefined) skills = skills.filter((s) => s.enabled === enabled);
  if (category) skills = skills.filter((s) => s.category === category);
  res.json(skills);
});

router.post("/skills", async (req, res) => {
  const parsed = CreateSkillBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;
  const skill = {
    id: randomUUID(),
    name: body.name,
    description: body.description,
    category: body.category,
    enabled: true,
    executionPolicy: body.executionPolicy ?? "auto",
    callCount: 0,
    lastCalled: null,
    avgLatencyMs: 0,
    tags: body.tags ?? [],
  };
  await db.insert(skillsTable).values(skill);
  res.status(201).json(skill);
});

router.patch("/skills/:id", async (req, res) => {
  const paramsParsed = UpdateSkillParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: paramsParsed.error.flatten() });
    return;
  }
  const bodyParsed = UpdateSkillBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.flatten() });
    return;
  }
  const updates: Partial<typeof skillsTable.$inferInsert> = {};
  if (bodyParsed.data.enabled !== undefined) updates.enabled = bodyParsed.data.enabled;
  if (bodyParsed.data.executionPolicy) updates.executionPolicy = bodyParsed.data.executionPolicy;
  if (bodyParsed.data.description) updates.description = bodyParsed.data.description;

  const [updated] = await db
    .update(skillsTable)
    .set(updates)
    .where(eq(skillsTable.id, paramsParsed.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(updated);
});

export default router;
