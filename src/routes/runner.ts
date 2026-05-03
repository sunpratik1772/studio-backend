import { Router } from "express";
import { db, agentSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { runAgent } from "../services/agentRunner";
import { RunAgentBody, RunAgentOnceBody } from "@workspace/api-zod";

const router = Router();

router.post("/agents/run-once", async (req, res, next) => {
  try {
    const parsed = RunAgentOnceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { prompt, name, model, maxSteps } = parsed.data;
    const id = randomUUID();
    const session = {
      id,
      name: name ?? `ephemeral-${id.slice(0, 8)}`,
      model: model ?? "gemini-2.5-flash",
      status: "idle" as const,
      channel: "console",
      tokensUsed: 0,
      tokensLimit: 100_000,
      loopCount: 0,
      lastActivity: null,
      metadata: { ephemeral: true } as Record<string, unknown>,
    };
    await db.insert(agentSessionsTable).values(session);
    const result = await runAgent({
      agentId: id,
      prompt,
      model: model ?? "gemini-2.5-flash",
      maxSteps: maxSteps ?? 8,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/agents/:id/run", async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: "Missing agent id" });
      return;
    }
    const [session] = await db
      .select()
      .from(agentSessionsTable)
      .where(eq(agentSessionsTable.id, id));
    if (!session) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    const parsed = RunAgentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { prompt, model, maxSteps, systemInstruction } = parsed.data;
    const result = await runAgent({
      agentId: id,
      prompt,
      model: model ?? session.model ?? "gemini-2.5-flash",
      maxSteps: maxSteps ?? 8,
      systemInstruction,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
