import { Type, type FunctionDeclaration } from "@google/genai";
import { db, memoryLogsTable, skillsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

export type ToolImpl = (
  args: Record<string, unknown>,
  ctx: { agentId: string },
) => Promise<unknown>;

export interface ToolDefinition {
  declaration: FunctionDeclaration;
  impl: ToolImpl;
}

function safeMathEval(expr: string): number {
  if (!/^[\d\s+\-*/().,%^]+$/.test(expr)) {
    throw new Error(
      `Expression contains unsupported characters. Only numbers and + - * / ( ) % ^ are allowed.`,
    );
  }
  const normalized = expr.replace(/\^/g, "**");
  // eslint-disable-next-line no-new-func
  const value = Function(`"use strict"; return (${normalized});`)();
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expression did not evaluate to a finite number.`);
  }
  return value;
}

export const TOOLS: Record<string, ToolDefinition> = {
  get_current_time: {
    declaration: {
      name: "get_current_time",
      description:
        "Returns the current server time as an ISO-8601 timestamp and a Unix epoch in milliseconds. Use this whenever the user asks for the current date or time.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          timezone: {
            type: Type.STRING,
            description:
              "IANA timezone name (e.g. 'UTC', 'America/New_York'). Defaults to 'UTC'.",
          },
        },
      },
    },
    impl: async (args) => {
      const tz = (args["timezone"] as string) || "UTC";
      const now = new Date();
      let local: string;
      try {
        local = now.toLocaleString("en-US", { timeZone: tz });
      } catch {
        local = now.toUTCString();
      }
      return {
        iso: now.toISOString(),
        epochMs: now.getTime(),
        timezone: tz,
        local,
      };
    },
  },

  calculate: {
    declaration: {
      name: "calculate",
      description:
        "Evaluates a mathematical expression with operators + - * / ( ) % ^. Use this any time the user asks for arithmetic, percentages, powers, or square roots (rewrite sqrt(x) as x^0.5).",
      parameters: {
        type: Type.OBJECT,
        properties: {
          expression: {
            type: Type.STRING,
            description:
              "A pure math expression, e.g. '2 + 2', '(140 * 0.18)', '144^0.5'.",
          },
        },
        required: ["expression"],
      },
    },
    impl: async (args) => {
      const expr = String(args["expression"] ?? "");
      const result = safeMathEval(expr);
      return { expression: expr, result };
    },
  },

  web_lookup: {
    declaration: {
      name: "web_lookup",
      description:
        "Looks up factual information from a curated knowledge base of common topics (companies, programming languages, science facts). Returns a short factual snippet.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          query: {
            type: Type.STRING,
            description: "The topic or question to look up.",
          },
        },
        required: ["query"],
      },
    },
    impl: async (args) => {
      const q = String(args["query"] ?? "").toLowerCase();
      const KB: Array<{ match: RegExp; snippet: string }> = [
        {
          match: /typescript/,
          snippet:
            "TypeScript is a strongly typed superset of JavaScript developed by Microsoft, first released in 2012. It compiles to plain JavaScript.",
        },
        {
          match: /react\b/,
          snippet:
            "React is an open-source JavaScript library for building user interfaces, originally developed by Meta (Facebook) and released in 2013.",
        },
        {
          match: /gemini/,
          snippet:
            "Gemini is Google DeepMind's family of multimodal large language models, supporting text, image, audio and video inputs with native function-calling.",
        },
        {
          match: /replit/,
          snippet:
            "Replit is a browser-based development platform offering AI-assisted coding, instant deployments, and collaborative editing.",
        },
        {
          match: /speed of light/,
          snippet:
            "The speed of light in a vacuum is exactly 299,792,458 metres per second.",
        },
        {
          match: /(pi\b|π)/,
          snippet:
            "Pi (π) is the ratio of a circle's circumference to its diameter, approximately 3.14159265358979.",
        },
      ];
      const hit = KB.find((e) => e.match.test(q));
      return {
        query: q,
        found: Boolean(hit),
        snippet:
          hit?.snippet ??
          `No curated entry for "${q}". The agent should answer from its own knowledge.`,
        source: "clawstudio.kb.v1",
      };
    },
  },

  read_recent_logs: {
    declaration: {
      name: "read_recent_logs",
      description:
        "Reads the most recent memory/trace log entries for the current agent. Use this when the user asks 'what did you do', 'show your steps', or wants to inspect the agent's own recent activity.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          limit: {
            type: Type.INTEGER,
            description: "Max entries to return (1-20). Defaults to 5.",
          },
        },
      },
    },
    impl: async (args, ctx) => {
      const limit = Math.min(
        Math.max(Number(args["limit"] ?? 5) || 5, 1),
        20,
      );
      const rows = await db
        .select()
        .from(memoryLogsTable)
        .where(eq(memoryLogsTable.agentId, ctx.agentId))
        .orderBy(desc(memoryLogsTable.timestamp))
        .limit(limit);
      return {
        count: rows.length,
        entries: rows.map((r) => ({
          timestamp: r.timestamp,
          type: r.type,
          message: r.message,
          toolName: r.toolName,
          durationMs: r.durationMs,
        })),
      };
    },
  },

  list_skills: {
    declaration: {
      name: "list_skills",
      description:
        "Lists all skills/tools registered in the ClawStudio gateway, including which are enabled. Useful when the user asks 'what can you do' or 'what tools are available'.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          enabledOnly: {
            type: Type.BOOLEAN,
            description: "If true, returns only enabled skills.",
          },
        },
      },
    },
    impl: async (args) => {
      const rows = await db.select().from(skillsTable);
      const filtered = args["enabledOnly"]
        ? rows.filter((r) => r.enabled)
        : rows;
      return {
        count: filtered.length,
        skills: filtered.map((r) => ({
          name: r.name,
          description: r.description,
          category: r.category,
          enabled: r.enabled,
        })),
      };
    },
  },

  send_notification: {
    declaration: {
      name: "send_notification",
      description:
        "Sends a notification message to a channel (slack, whatsapp, email). This is a simulated send — it records the dispatch in the trace and returns a delivery receipt.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          channel: {
            type: Type.STRING,
            description: "Target channel: 'slack', 'whatsapp', or 'email'.",
          },
          recipient: {
            type: Type.STRING,
            description: "Channel-specific recipient (e.g. '#general' or 'user@x.com').",
          },
          message: {
            type: Type.STRING,
            description: "Plain-text message body to deliver.",
          },
        },
        required: ["channel", "recipient", "message"],
      },
    },
    impl: async (args) => {
      return {
        delivered: true,
        channel: args["channel"],
        recipient: args["recipient"],
        messagePreview: String(args["message"] ?? "").slice(0, 80),
        deliveryId: `sim_${Date.now().toString(36)}`,
      };
    },
  },
};

export function getToolDeclarations(): FunctionDeclaration[] {
  return Object.values(TOOLS).map((t) => t.declaration);
}

export function getToolImpl(name: string): ToolImpl | undefined {
  return TOOLS[name]?.impl;
}
