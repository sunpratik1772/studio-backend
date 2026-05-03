import { Router } from "express";
import { db } from "@workspace/db";
import { memoryLogsTable, agentSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ListLogsQueryParams, GetAgentTraceParams } from "@workspace/api-zod";
import { randomUUID } from "crypto";

const router = Router();

router.get("/logs", async (req, res) => {
  const parsed = ListLogsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { agentId, type, limit } = parsed.data;
  let logs = await db.select().from(memoryLogsTable);
  if (agentId) logs = logs.filter((l) => l.agentId === agentId);
  if (type) logs = logs.filter((l) => l.type === type);
  logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  res.json(logs.slice(0, limit));
});

router.get("/logs/:agentId/trace", async (req, res) => {
  const parsed = GetAgentTraceParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { agentId } = parsed.data;

  const [session] = await db
    .select()
    .from(agentSessionsTable)
    .where(eq(agentSessionsTable.id, agentId));

  const logs = await db
    .select()
    .from(memoryLogsTable)
    .where(eq(memoryLogsTable.agentId, agentId));

  const messages = logs
    .filter((l) => l.type === "trace")
    .map((l, i) => ({
      id: l.id,
      role: i % 2 === 0 ? "user" : "assistant",
      content: l.message,
      toolCall: l.payload ?? null,
      timestamp: l.timestamp,
    }));

  const dagSteps = logs
    .filter((l) => l.type === "tool_call")
    .map((l) => ({
      stepId: l.id,
      type: "tool_call" as const,
      toolName: l.toolName ?? "unknown",
      input: (l.payload as Record<string, unknown>)?.input ?? {},
      output: (l.payload as Record<string, unknown>)?.output ?? {},
      status: "success" as const,
      durationMs: l.durationMs ?? 0,
      timestamp: l.timestamp,
    }));

  if (!session) {
    // Return empty trace for unknown agent
    res.json({
      agentId,
      sessionName: "Unknown Session",
      messages,
      dagSteps,
      totalTokens: 0,
      durationMs: 0,
    });
    return;
  }

  res.json({
    agentId,
    sessionName: session.name,
    messages,
    dagSteps,
    totalTokens: session.tokensUsed,
    durationMs: session.loopCount * 1200,
  });
});

export default router;
