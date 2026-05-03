import { Router } from "express";
import { db } from "@workspace/db";
import { agentSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  ListAgentsQueryParams,
  CreateAgentBody,
  UpdateAgentBody,
  GetAgentParams,
  DeleteAgentParams,
  UpdateAgentParams,
} from "@workspace/api-zod";

const router = Router();

router.get("/agents/summary", async (req, res) => {
  const sessions = await db.select().from(agentSessionsTable);
  const summary = {
    total: sessions.length,
    running: sessions.filter((s) => s.status === "running").length,
    idle: sessions.filter((s) => s.status === "idle").length,
    failed: sessions.filter((s) => s.status === "failed").length,
    completed: sessions.filter((s) => s.status === "completed").length,
    totalTokensUsed: sessions.reduce((acc, s) => acc + s.tokensUsed, 0),
    avgLoopCount:
      sessions.length > 0
        ? sessions.reduce((acc, s) => acc + s.loopCount, 0) / sessions.length
        : 0,
    activeChannels: new Set(
      sessions.filter((s) => s.channel).map((s) => s.channel)
    ).size,
  };
  res.json(summary);
});

router.get("/agents", async (req, res) => {
  const parsed = ListAgentsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { status, limit } = parsed.data;
  let sessions = await db.select().from(agentSessionsTable);
  if (status) sessions = sessions.filter((s) => s.status === status);
  res.json(sessions.slice(0, limit));
});

router.post("/agents", async (req, res) => {
  const parsed = CreateAgentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;
  const session = {
    id: randomUUID(),
    name: body.name,
    model: body.model,
    status: "idle" as const,
    channel: body.channel ?? null,
    tokensUsed: 0,
    tokensLimit: body.tokensLimit ?? 100000,
    loopCount: 0,
    lastActivity: null,
    metadata: body.metadata ?? null,
  };
  await db.insert(agentSessionsTable).values(session);
  res.status(201).json(session);
});

router.get("/agents/:id", async (req, res) => {
  const parsed = GetAgentParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const [session] = await db
    .select()
    .from(agentSessionsTable)
    .where(eq(agentSessionsTable.id, parsed.data.id));
  if (!session) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(session);
});

router.patch("/agents/:id", async (req, res) => {
  const paramsParsed = UpdateAgentParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: paramsParsed.error.flatten() });
    return;
  }
  const bodyParsed = UpdateAgentBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.flatten() });
    return;
  }
  const updates: Partial<typeof agentSessionsTable.$inferInsert> = {};
  if (bodyParsed.data.status) updates.status = bodyParsed.data.status;
  if (bodyParsed.data.metadata) updates.metadata = bodyParsed.data.metadata;

  const [updated] = await db
    .update(agentSessionsTable)
    .set(updates)
    .where(eq(agentSessionsTable.id, paramsParsed.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(updated);
});

router.delete("/agents/:id", async (req, res) => {
  const parsed = DeleteAgentParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  await db
    .delete(agentSessionsTable)
    .where(eq(agentSessionsTable.id, parsed.data.id));
  res.status(204).send();
});

export default router;
