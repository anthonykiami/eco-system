import { generateText, stepCountIs, streamText, type ModelMessage, type ToolSet, type UserContent } from "ai";
import type { Agent, Message } from "@/lib/db/schema";
import { telemetryFor } from "@/lib/tracing";
import { addUsage, type RunContext } from "../context";
import { PLAN_LIMITS } from "../limits";
import { recallMemories } from "../memory";
import type { AgentImage } from "../types";
import { agentModel } from "../models";

/**
 * The web chat route waits for the reply within 60s. Telegram turns run in the background
 * (after()) and the scheduled-job worker in its own request, both allowed 300s, so they can
 * research far more (a news brief runs many searches). Leave headroom for saving afterwards.
 */
const WEB_TURN_TIMEOUT_MS = 45_000;
const BACKGROUND_TURN_TIMEOUT_MS = 240_000;

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

/** Which accounts are connected and what the user's settings don't allow, so the agent explains rather than retries. */
export function buildIntegrationLimits(notes: string[]): string | undefined {
  if (notes.length === 0) return undefined;
  return `<integration_limits>
About the user's connected accounts. Respect any limits the user chose, and never try to work around them.
${notes.map((n) => `- ${n}`).join("\n")}
</integration_limits>`;
}

export function buildSystemPrompt(
  soul: string,
  memories: string[],
  { timezone, now, integrationNotes = [] }: { timezone: string; now?: Date; integrationNotes?: string[] },
): string {
  const parts = [soul, buildSituation(timezone, now)];
  const limits = buildIntegrationLimits(integrationNotes);
  if (limits) parts.push(limits);
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

/** The user's turn: plain text, or the photos followed by the text (a caption, or nothing). */
export function userContent(message: string, images: AgentImage[]): UserContent {
  if (images.length === 0) return message;
  return [
    ...images.map((image) => ({ type: "image" as const, image: image.data, mediaType: image.mediaType })),
    ...(message ? [{ type: "text" as const, text: message }] : []),
  ];
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
  images = [],
  tools,
}: {
  ctx: RunContext;
  agent: Agent;
  history: Message[];
  message: string;
  images?: AgentImage[];
  tools: ToolSet;
}): Promise<string> {
  const memories = await recallMemories(ctx.userId, message);

  const options = {
    model: agentModel(ctx.plan),
    system: buildSystemPrompt(agent.soul, memories, {
      timezone: ctx.timezone,
      integrationNotes: ctx.integrationNotes,
    }),
    messages: [...toModelMessages(history), { role: "user" as const, content: userContent(message, images) }],
    tools,
    stopWhen: stepCountIs(PLAN_LIMITS[ctx.plan].maxSteps),
    // Delegations receive this call's abortSignal, so they share the same budget.
    timeout: { totalMs: ctx.channel === "web" ? WEB_TURN_TIMEOUT_MS : BACKGROUND_TURN_TIMEOUT_MS },
    ...telemetryFor(agent.role === "primary" ? "primary-agent" : `agent:${agent.name}`, ctx),
  };

  if (!ctx.onPartialText) {
    const result = await generateText(options);
    addUsage(ctx.usage, result.totalUsage);
    return result.text;
  }

  const result = streamText(options);
  let partial = "";
  for await (const part of result.stream) {
    if (part.type === "start-step") partial = "";
    else if (part.type === "error") throw part.error;
    else if (part.type === "text-delta") {
      partial += part.text;
      try {
        ctx.onPartialText(partial);
      } catch (err) {
        console.error("[agents] onPartialText listener failed", err);
      }
    }
  }
  addUsage(ctx.usage, await result.totalUsage);
  return result.text;
}
