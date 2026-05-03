import { pgTable, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const memoryLogsTable = pgTable("memory_logs", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  type: text("type").notNull(),
  level: text("level").notNull().default("info"),
  message: text("message").notNull(),
  payload: jsonb("payload"),
  toolName: text("tool_name"),
  durationMs: integer("duration_ms"),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

export const insertMemoryLogSchema = createInsertSchema(memoryLogsTable);
export type InsertMemoryLog = z.infer<typeof insertMemoryLogSchema>;
export type MemoryLog = typeof memoryLogsTable.$inferSelect;
