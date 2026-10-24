import { generateText, stepCountIs, type ModelMessage, type ToolSet } from "ai";
import type { Agent, Message } from "@/lib/db/schema";
import { telemetryFor } from "@/lib/tracing";
import { addUsage, type RunContext } from "../context";
import { PLAN_LIMITS } from "../limits";
import { recallMemories } from "../memory";
import { agentModel } from "../models";

/** Routes calling runAgent allow 60s; leave headroom for saving messages and memory afterwards. */
const TURN_TIMEOUT_MS = 45_000;

/** The model has no clock, so the current moment in the user's timezone is stated explicitly. */
export function buildSituation(timezone: string, now: Date = new Date()): string {
  const stamp = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(now);
  return `<situation>
Right now it is ${stamp} in the user's timezone (${timezone}).
Use this for anything relative: "today", "tomorrow", "this week", scheduling, and deadlines.
</situation>`;
}

export function buildSystemPrompt(
  soul: string,
  memories: string[],
  { timezone, now }: { timezone: string; now?: Date },
): string {
  const parts = [soul, buildSituation(timezone, now)];
  if (memories.length > 0) {
    parts.push(`<memories>
Things you remember about the user from earlier conversations. Use them when relevant; don't recite them.
${memories.map((m) => `- ${m}`).join("\n")}
</memories>`);
  }
  return parts.join("\n\n");
}

/** Stored chat history as model messages. Only user/assistant turns are replayed. */
export function toModelMessages(history: Message[]): ModelMessage[] {
  return history.flatMap((m): ModelMessage[] =>
    m.role === "user" || m.role === "assistant" ? [{ role: m.role, content: m.content }] : [],
  );
}

/**
 * One turn of the top-level agent: its soul plus the user's memories as the system prompt,
 * the chat history, and the given tools.
 */
export async function runAgentTurn({
  ctx,
  agent,
  history,
  message,
  tools,
}: {
  ctx: RunContext;
  agent: Agent;
  history: Message[];
  message: string;
  tools: ToolSet;
}): Promise<string> {
  const memories = await recallMemories(ctx.userId, message);

  const result = await generateText({
    model: agentModel(ctx.plan),
    system: buildSystemPrompt(agent.soul, memories, { timezone: ctx.timezone }),
    messages: [...toModelMessages(history), { role: "user", content: message }],
    tools,
    stopWhen: stepCountIs(PLAN_LIMITS[ctx.plan].maxSteps),
    // Delegations receive this call's abortSignal, so they share the same budget.
    timeout: { totalMs: TURN_TIMEOUT_MS },
    ...telemetryFor(agent.role === "primary" ? "primary-agent" : `agent:${agent.name}`, ctx),
  });
  addUsage(ctx.usage, result.totalUsage);
  return result.text;
}
