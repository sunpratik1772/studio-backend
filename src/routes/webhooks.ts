import { Router } from "express";
import { db } from "@workspace/db";
import { channelConfigsTable, agentSessionsTable, memoryLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { IngestWebhookParams, IngestWebhookBody } from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router = Router();

async function simulateBackgroundWorker(
  eventId: string,
  channel: string,
  payload: unknown
): Promise<void> {
  // Simulate async Pub/Sub processing
  setTimeout(async () => {
    try {
      logger.info({ eventId, channel }, "Background worker processing webhook event");

      // Find or create a running agent session for this channel
      const sessions = await db.select().from(agentSessionsTable);
      let targetSession = sessions.find(
        (s) => s.channel === channel && s.status === "running"
      );

      if (!targetSession) {
        const newSession = {
          id: randomUUID(),
          name: `${channel.charAt(0).toUpperCase() + channel.slice(1)} Agent`,
          model: "gpt-4o",
          status: "running" as const,
          channel,
          tokensUsed: Math.floor(Math.random() * 500) + 100,
          tokensLimit: 100000,
          loopCount: 1,
          lastActivity: new Date(),
          metadata: { triggeredBy: eventId } as Record<string, unknown>,
          createdAt: new Date(),
        };
        await db.insert(agentSessionsTable).values(newSession);
        targetSession = newSession;
      } else if (targetSession) {
        await db
          .update(agentSessionsTable)
          .set({
            loopCount: targetSession.loopCount + 1,
            tokensUsed: targetSession.tokensUsed + Math.floor(Math.random() * 300) + 50,
            lastActivity: new Date(),
          })
          .where(eq(agentSessionsTable.id, targetSession.id));
      }

      if (!targetSession) return;

      // Write webhook log
      await db.insert(memoryLogsTable).values({
        id: randomUUID(),
        agentId: targetSession.id,
        type: "webhook",
        level: "info",
        message: `Received ${channel} webhook event ${eventId}`,
        payload: payload as Record<string, unknown>,
        toolName: null,
        durationMs: Math.floor(Math.random() * 200) + 50,
        timestamp: new Date(),
      });

      // Simulate tool call log
      await db.insert(memoryLogsTable).values({
        id: randomUUID(),
        agentId: targetSession.id,
        type: "tool_call",
        level: "info",
        message: `Executed respond_to_${channel} tool`,
        payload: {
          input: { eventId, channel, payload },
          output: { success: true, responseId: randomUUID() },
        } as Record<string, unknown>,
        toolName: `respond_to_${channel}`,
        durationMs: Math.floor(Math.random() * 800) + 200,
        timestamp: new Date(),
      });

      logger.info({ eventId, agentId: targetSession.id }, "Background worker completed");
    } catch (err) {
      logger.error({ err, eventId }, "Background worker failed");
    }
  }, 500);
}

router.post("/webhooks/:channel", async (req, res) => {
  const paramsParsed = IngestWebhookParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: paramsParsed.error.flatten() });
    return;
  }
  const bodyParsed = IngestWebhookBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.flatten() });
    return;
  }

  const { channel } = paramsParsed.data;
  const eventId = randomUUID();
  const queuedAt = new Date();

  // Update channel config event counter
  const [channelConfig] = await db
    .select()
    .from(channelConfigsTable)
    .where(eq(channelConfigsTable.channel, channel));

  if (channelConfig) {
    await db
      .update(channelConfigsTable)
      .set({
        eventsReceived: channelConfig.eventsReceived + 1,
        lastEvent: queuedAt,
      })
      .where(eq(channelConfigsTable.channel, channel));
  }

  // Fire-and-forget background worker (simulates Pub/Sub)
  simulateBackgroundWorker(eventId, channel, bodyParsed.data);

  res.status(202).json({
    eventId,
    channel,
    status: "queued",
    agentSessionId: null,
    queuedAt: queuedAt.toISOString(),
  });
});

router.get("/webhooks/channels", async (req, res) => {
  const configs = await db.select().from(channelConfigsTable);
  res.json(configs);
});

export default router;
