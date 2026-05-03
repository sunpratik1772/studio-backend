import { pgTable, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const channelConfigsTable = pgTable("channel_configs", {
  id: text("id").primaryKey(),
  channel: text("channel").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  webhookUrl: text("webhook_url"),
  eventsReceived: integer("events_received").notNull().default(0),
  lastEvent: timestamp("last_event"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertChannelConfigSchema = createInsertSchema(channelConfigsTable).omit({ createdAt: true });
export type InsertChannelConfig = z.infer<typeof insertChannelConfigSchema>;
export type ChannelConfig = typeof channelConfigsTable.$inferSelect;
