import { db } from "@workspace/db";
import {
  agentSessionsTable,
  channelConfigsTable,
  skillsTable,
  memoryLogsTable,
} from "@workspace/db";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";

const RUNTIME_TOOL_SKILLS = [
  {
    name: "get_current_time",
    description: "Returns the current server time as ISO-8601 in any IANA timezone.",
    category: "utility",
    executionPolicy: "auto" as const,
    tags: ["time", "utility", "runtime"],
  },
  {
    name: "calculate",
    description: "Safely evaluates math expressions (+, -, *, /, ^, parentheses).",
    category: "compute",
    executionPolicy: "auto" as const,
    tags: ["math", "compute", "runtime"],
  },
  {
    name: "web_lookup",
    description: "Looks up factual snippets from the curated ClawStudio knowledge base.",
    category: "retrieval",
    executionPolicy: "auto" as const,
    tags: ["search", "knowledge", "runtime"],
  },
  {
    name: "read_recent_logs",
    description: "Reads the agent's most recent memory/trace log entries.",
    category: "introspection",
    executionPolicy: "auto" as const,
    tags: ["memory", "introspection", "runtime"],
  },
  {
    name: "list_skills",
    description: "Lists all skills/tools registered in the gateway.",
    category: "introspection",
    executionPolicy: "auto" as const,
    tags: ["skills", "introspection", "runtime"],
  },
  {
    name: "send_notification",
    description: "Simulated notification sender for slack/whatsapp/email channels.",
    category: "communication",
    executionPolicy: "auto" as const,
    tags: ["notification", "outbound", "runtime"],
  },
];

export async function ensureRuntimeToolSkills() {
  for (const tool of RUNTIME_TOOL_SKILLS) {
    const [existing] = await db
      .select()
      .from(skillsTable)
      .where(eq(skillsTable.name, tool.name));
    if (existing) continue;
    await db.insert(skillsTable).values({
      id: randomUUID(),
      name: tool.name,
      description: tool.description,
      category: tool.category,
      enabled: true,
      executionPolicy: tool.executionPolicy,
      callCount: 0,
      lastCalled: null,
      avgLatencyMs: 0,
      tags: tool.tags,
    });
  }
}

export async function seedIfEmpty() {
  const existing = await db.select().from(agentSessionsTable);
  if (existing.length > 0) {
    await ensureRuntimeToolSkills();
    return;
  }

  const agentIds = [randomUUID(), randomUUID(), randomUUID()];

  await db.insert(agentSessionsTable).values([
    {
      id: agentIds[0],
      name: "slack-triage-v2",
      model: "gpt-4o",
      status: "running",
      channel: "slack",
      tokensUsed: 14320,
      tokensLimit: 100000,
      loopCount: 8,
      lastActivity: new Date(Date.now() - 30000),
      metadata: { priority: "high", workspace: "engineering" },
    },
    {
      id: agentIds[1],
      name: "whatsapp-support",
      model: "gpt-4o-mini",
      status: "idle",
      channel: "whatsapp",
      tokensUsed: 5890,
      tokensLimit: 50000,
      loopCount: 3,
      lastActivity: new Date(Date.now() - 300000),
      metadata: { region: "us-east" },
    },
    {
      id: agentIds[2],
      name: "email-classifier",
      model: "claude-3-5-sonnet",
      status: "failed",
      channel: "email",
      tokensUsed: 2100,
      tokensLimit: 75000,
      loopCount: 1,
      lastActivity: new Date(Date.now() - 600000),
      metadata: { error: "rate_limit_exceeded" },
    },
  ]);

  await db.insert(channelConfigsTable).values([
    {
      id: randomUUID(),
      channel: "slack",
      enabled: true,
      webhookUrl: "https://hooks.slack.com/services/mock/webhook",
      eventsReceived: 142,
      lastEvent: new Date(Date.now() - 30000),
    },
    {
      id: randomUUID(),
      channel: "whatsapp",
      enabled: true,
      webhookUrl: "https://api.whatsapp.com/mock/webhook",
      eventsReceived: 67,
      lastEvent: new Date(Date.now() - 300000),
    },
    {
      id: randomUUID(),
      channel: "email",
      enabled: false,
      webhookUrl: null,
      eventsReceived: 23,
      lastEvent: new Date(Date.now() - 3600000),
    },
    {
      id: randomUUID(),
      channel: "generic",
      enabled: true,
      webhookUrl: null,
      eventsReceived: 5,
      lastEvent: null,
    },
  ]);

  await db.insert(skillsTable).values([
    {
      id: randomUUID(),
      name: "web_search",
      description: "Search the web for up-to-date information using Bing or Google APIs",
      category: "retrieval",
      enabled: true,
      executionPolicy: "auto",
      callCount: 892,
      lastCalled: new Date(Date.now() - 60000),
      avgLatencyMs: 340,
      tags: ["search", "web", "external"],
    },
    {
      id: randomUUID(),
      name: "code_interpreter",
      description: "Execute Python code in a sandboxed environment for data analysis",
      category: "compute",
      enabled: true,
      executionPolicy: "manual",
      callCount: 234,
      lastCalled: new Date(Date.now() - 900000),
      avgLatencyMs: 1200,
      tags: ["python", "code", "sandbox"],
    },
    {
      id: randomUUID(),
      name: "send_slack_message",
      description: "Send a message to a Slack channel or DM",
      category: "communication",
      enabled: true,
      executionPolicy: "restricted",
      callCount: 567,
      lastCalled: new Date(Date.now() - 30000),
      avgLatencyMs: 180,
      tags: ["slack", "messaging", "outbound"],
    },
    {
      id: randomUUID(),
      name: "database_query",
      description: "Execute read-only SQL queries against the production database",
      category: "data",
      enabled: true,
      executionPolicy: "manual",
      callCount: 1203,
      lastCalled: new Date(Date.now() - 120000),
      avgLatencyMs: 85,
      tags: ["sql", "database", "readonly"],
    },
    {
      id: randomUUID(),
      name: "email_sender",
      description: "Compose and send emails via SMTP or SendGrid",
      category: "communication",
      enabled: false,
      executionPolicy: "disabled",
      callCount: 0,
      lastCalled: null,
      avgLatencyMs: 0,
      tags: ["email", "outbound", "smtp"],
    },
    {
      id: randomUUID(),
      name: "vector_search",
      description: "Semantic similarity search over document embeddings in Pinecone",
      category: "retrieval",
      enabled: true,
      executionPolicy: "auto",
      callCount: 3401,
      lastCalled: new Date(Date.now() - 15000),
      avgLatencyMs: 62,
      tags: ["embeddings", "pinecone", "semantic"],
    },
    {
      id: randomUUID(),
      name: "image_analysis",
      description: "Analyze and describe images using vision models",
      category: "vision",
      enabled: true,
      executionPolicy: "auto",
      callCount: 127,
      lastCalled: new Date(Date.now() - 1800000),
      avgLatencyMs: 2100,
      tags: ["vision", "gpt-4v", "image"],
    },
    {
      id: randomUUID(),
      name: "github_pr_review",
      description: "Fetch and analyze GitHub pull requests for code review",
      category: "devtools",
      enabled: true,
      executionPolicy: "restricted",
      callCount: 45,
      lastCalled: new Date(Date.now() - 7200000),
      avgLatencyMs: 620,
      tags: ["github", "pr", "code-review"],
    },
  ]);

  await db.insert(memoryLogsTable).values([
    {
      id: randomUUID(),
      agentId: agentIds[0],
      type: "trace",
      level: "info",
      message: "User: Can you summarize the latest incident in #ops-alerts?",
      payload: null,
      toolName: null,
      durationMs: null,
      timestamp: new Date(Date.now() - 120000),
    },
    {
      id: randomUUID(),
      agentId: agentIds[0],
      type: "trace",
      level: "info",
      message: "Assistant: I will search for recent messages in #ops-alerts and summarize the incident.",
      payload: null,
      toolName: null,
      durationMs: null,
      timestamp: new Date(Date.now() - 119000),
    },
    {
      id: randomUUID(),
      agentId: agentIds[0],
      type: "tool_call",
      level: "info",
      message: "Executed web_search for ops-alerts incident",
      payload: {
        input: { query: "site:slack ops-alerts incident", channel: "#ops-alerts" },
        output: { results: 3, topResult: "Database latency spike at 14:23 UTC" },
      },
      toolName: "web_search",
      durationMs: 312,
      timestamp: new Date(Date.now() - 118000),
    },
    {
      id: randomUUID(),
      agentId: agentIds[0],
      type: "memory",
      level: "info",
      message: "Stored incident summary in working memory",
      payload: { key: "ops_incident_summary", value: "DB latency spike" },
      toolName: null,
      durationMs: 12,
      timestamp: new Date(Date.now() - 90000),
    },
    {
      id: randomUUID(),
      agentId: agentIds[1],
      type: "webhook",
      level: "info",
      message: "Received WhatsApp message from +1-555-0123",
      payload: { from: "+1-555-0123", body: "What are your business hours?", channel: "whatsapp" },
      toolName: null,
      durationMs: 45,
      timestamp: new Date(Date.now() - 300000),
    },
    {
      id: randomUUID(),
      agentId: agentIds[2],
      type: "trace",
      level: "error",
      message: "Rate limit exceeded for OpenAI API — retrying in 60s",
      payload: { error: "RateLimitError", retryAfter: 60 },
      toolName: null,
      durationMs: null,
      timestamp: new Date(Date.now() - 600000),
    },
  ]);

  await ensureRuntimeToolSkills();
}
