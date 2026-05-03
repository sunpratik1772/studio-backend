import { pgTable, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const agentSessionsTable = pgTable("agent_sessions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  model: text("model").notNull(),
  status: text("status").notNull().default("idle"),
  channel: text("channel"),
  tokensUsed: integer("tokens_used").notNull().default(0),
  tokensLimit: integer("tokens_limit").notNull().default(100000),
  loopCount: integer("loop_count").notNull().default(0),
  lastActivity: timestamp("last_activity"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAgentSessionSchema = createInsertSchema(agentSessionsTable).omit({ createdAt: true });
export type InsertAgentSession = z.infer<typeof insertAgentSessionSchema>;
export type AgentSession = typeof agentSessionsTable.$inferSelect;
