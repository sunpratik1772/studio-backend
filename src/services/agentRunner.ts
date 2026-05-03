import { GoogleGenAI, type Content } from "@google/genai";
import { randomUUID } from "node:crypto";
import { db, agentSessionsTable, memoryLogsTable, skillsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getToolDeclarations, getToolImpl } from "./tools";

const apiKey = process.env["GOOGLE_API_KEY"];
let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!apiKey) {
    throw new Error(
      "GOOGLE_API_KEY environment variable is not set — cannot run Gemini agent.",
    );
  }
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

export interface AgentRunStep {
  step: number;
  type: "model" | "tool_call" | "tool_result" | "final";
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
  text?: string;
  durationMs: number;
  promptTokens?: number;
  completionTokens?: number;
}

export interface AgentRunResult {
  agentId: string;
  prompt: string;
  finalAnswer: string;
  steps: AgentRunStep[];
  totalTokens: number;
  loops: number;
  durationMs: number;
  status: "completed" | "failed";
  error?: string;
}

const SYSTEM_INSTRUCTION = `You are an agent inside ClawStudio, an enterprise AI orchestration platform.
You have access to function-calling tools. Always:
- Prefer calling a tool over guessing when a tool is appropriate.
- For arithmetic, ALWAYS use the calculate tool — never compute in your head.
- For current time/date, ALWAYS call get_current_time.
- After tool calls, synthesize a concise final answer in plain text.
- Be brief and factual. Do not invent tool results.`;

async function logTrace(
  agentId: string,
  type: string,
  message: string,
  payload: Record<string, unknown> | null,
  toolName: string | null,
  durationMs: number | null,
  level: "info" | "warn" | "error" = "info",
): Promise<void> {
  try {
    await db.insert(memoryLogsTable).values({
      id: randomUUID(),
      agentId,
      type,
      level,
      message,
      payload,
      toolName,
      durationMs,
      timestamp: new Date(),
    });
  } catch (err) {
    logger.error({ err }, "Failed to write memory log");
  }
}

async function bumpSkillUsage(toolName: string, durationMs: number) {
  try {
    // Atomic update: incremental running average computed in SQL so concurrent
    // tool invocations cannot lose updates.
    //   newAvg = (prevAvg * prevCount + duration) / (prevCount + 1)
    await db
      .update(skillsTable)
      .set({
        callCount: sql`${skillsTable.callCount} + 1`,
        avgLatencyMs: sql`(coalesce(${skillsTable.avgLatencyMs}, 0) * ${skillsTable.callCount} + ${durationMs}) / (${skillsTable.callCount} + 1)`,
        lastCalled: new Date(),
      })
      .where(eq(skillsTable.name, toolName));
  } catch (err) {
    logger.warn({ err, toolName }, "Failed to bump skill usage");
  }
}

export interface RunAgentOptions {
  agentId: string;
  prompt: string;
  model?: string;
  maxSteps?: number;
  systemInstruction?: string;
}

export async function runAgent(opts: RunAgentOptions): Promise<AgentRunResult> {
  const t0 = Date.now();
  const model = opts.model || "gemini-2.5-flash";
  const maxSteps = Math.min(Math.max(opts.maxSteps ?? 8, 1), 12);
  const steps: AgentRunStep[] = [];
  let totalTokens = 0;
  let loops = 0;

  // Look up the session so we can enforce its tokensLimit.
  const [existingSession] = await db
    .select()
    .from(agentSessionsTable)
    .where(eq(agentSessionsTable.id, opts.agentId));
  const tokensLimit = existingSession?.tokensLimit ?? 100_000;
  const tokensAlreadyUsed = existingSession?.tokensUsed ?? 0;

  await db
    .update(agentSessionsTable)
    .set({ status: "running", lastActivity: new Date() })
    .where(eq(agentSessionsTable.id, opts.agentId));

  await logTrace(
    opts.agentId,
    "trace",
    `Run started — model=${model}, prompt="${opts.prompt.slice(0, 120)}"`,
    { model, maxSteps },
    null,
    null,
  );

  const contents: Content[] = [
    { role: "user", parts: [{ text: opts.prompt }] },
  ];

  let finalAnswer = "";
  let status: "completed" | "failed" = "completed";
  let error: string | undefined;

  try {
    const ai = getClient();
    const tools = [{ functionDeclarations: getToolDeclarations() }];

    for (let step = 1; step <= maxSteps; step++) {
      loops = step;
      const stepStart = Date.now();

      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: opts.systemInstruction || SYSTEM_INSTRUCTION,
          tools,
          temperature: 0.2,
        },
      });

      const usage = response.usageMetadata;
      const promptTokens = usage?.promptTokenCount ?? 0;
      const completionTokens = usage?.candidatesTokenCount ?? 0;
      totalTokens += promptTokens + completionTokens;

      const candidate = response.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      const functionCalls = parts.filter((p) => p.functionCall);
      const textParts = parts.filter((p) => p.text);
      const modelDuration = Date.now() - stepStart;

      steps.push({
        step,
        type: "model",
        text: textParts.map((p) => p.text).join("") || undefined,
        durationMs: modelDuration,
        promptTokens,
        completionTokens,
      });

      await logTrace(
        opts.agentId,
        "trace",
        `Step ${step}: model returned ${functionCalls.length} tool call(s), ${textParts.length} text part(s)`,
        {
          step,
          functionCallCount: functionCalls.length,
          promptTokens,
          completionTokens,
        },
        null,
        modelDuration,
      );

      // Persist whatever the model returned so the next turn has full context.
      contents.push({
        role: "model",
        parts: parts.map((p) => {
          if (p.functionCall) return { functionCall: p.functionCall };
          if (p.text) return { text: p.text };
          return p;
        }),
      });

      if (tokensAlreadyUsed + totalTokens > tokensLimit) {
        status = "failed";
        error = `tokens_limit_exceeded (used ${tokensAlreadyUsed + totalTokens} of ${tokensLimit})`;
        finalAnswer = `(Agent halted: token budget of ${tokensLimit} exceeded.)`;
        await logTrace(
          opts.agentId,
          "trace",
          error,
          { tokensLimit, totalTokens, tokensAlreadyUsed },
          null,
          null,
          "error",
        );
        break;
      }

      if (functionCalls.length === 0) {
        finalAnswer = textParts.map((p) => p.text).join("").trim();
        steps.push({
          step,
          type: "final",
          text: finalAnswer,
          durationMs: 0,
        });
        break;
      }

      const responseParts: Content["parts"] = [];
      for (const fc of functionCalls) {
        const call = fc.functionCall!;
        const name = call.name ?? "";
        const args = (call.args ?? {}) as Record<string, unknown>;
        const callStart = Date.now();

        steps.push({
          step,
          type: "tool_call",
          toolName: name,
          toolArgs: args,
          durationMs: 0,
        });

        const impl = getToolImpl(name);
        let result: unknown;
        let level: "info" | "error" = "info";
        if (!impl) {
          result = { error: `Unknown tool: ${name}` };
          level = "error";
        } else {
          try {
            result = await impl(args, { agentId: opts.agentId });
          } catch (err) {
            result = {
              error: err instanceof Error ? err.message : String(err),
            };
            level = "error";
          }
        }
        const callDuration = Date.now() - callStart;

        steps.push({
          step,
          type: "tool_result",
          toolName: name,
          toolResult: result,
          durationMs: callDuration,
        });

        await logTrace(
          opts.agentId,
          "tool_call",
          `Tool ${name} executed (${callDuration}ms)`,
          { args, result },
          name,
          callDuration,
          level,
        );

        await bumpSkillUsage(name, callDuration);

        responseParts.push({
          functionResponse: {
            name,
            response: { result },
          },
        });
      }

      contents.push({ role: "user", parts: responseParts });
    }

    if (!finalAnswer) {
      finalAnswer =
        "(Agent reached max step limit without producing a final answer.)";
      status = "failed";
      error = "max_steps_reached";
    }
  } catch (err) {
    status = "failed";
    error = err instanceof Error ? err.message : String(err);
    logger.error({ err, agentId: opts.agentId }, "Agent run failed");
    await logTrace(
      opts.agentId,
      "trace",
      `Run failed: ${error}`,
      null,
      null,
      null,
      "error",
    );
  }

  const durationMs = Date.now() - t0;

  await db
    .update(agentSessionsTable)
    .set({
      status: status === "completed" ? "completed" : "failed",
      tokensUsed: sql`${agentSessionsTable.tokensUsed} + ${totalTokens}`,
      loopCount: sql`${agentSessionsTable.loopCount} + ${loops}`,
      lastActivity: new Date(),
    })
    .where(eq(agentSessionsTable.id, opts.agentId));

  await logTrace(
    opts.agentId,
    "trace",
    `Run finished — status=${status}, loops=${loops}, tokens=${totalTokens}, duration=${durationMs}ms`,
    { status, loops, totalTokens, durationMs },
    null,
    durationMs,
    status === "completed" ? "info" : "error",
  );

  return {
    agentId: opts.agentId,
    prompt: opts.prompt,
    finalAnswer,
    steps,
    totalTokens,
    loops,
    durationMs,
    status,
    error,
  };
}
