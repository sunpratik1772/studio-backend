import { pgTable, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const skillsTable = pgTable("skills", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  executionPolicy: text("execution_policy").notNull().default("auto"),
  callCount: integer("call_count").notNull().default(0),
  lastCalled: timestamp("last_called"),
  avgLatencyMs: integer("avg_latency_ms").default(0),
  tags: text("tags").array(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSkillSchema = createInsertSchema(skillsTable).omit({ createdAt: true });
export type InsertSkill = z.infer<typeof insertSkillSchema>;
export type Skill = typeof skillsTable.$inferSelect;
