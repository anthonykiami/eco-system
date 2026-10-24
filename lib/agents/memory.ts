import { generateText, Output, tool, type ToolSet } from "ai";
import Supermemory from "supermemory";
import { z } from "zod";
import { env } from "@/lib/env";
import { telemetryFor } from "@/lib/tracing";
import { addUsage, type RunContext } from "./context";
import { utilityModel } from "./models";

let client: Supermemory | undefined;
const supermemory = () => (client ??= new Supermemory({ apiKey: env.SUPERMEMORY_API_KEY }));

/** Every Supermemory read and write is scoped to this tag. Never pass another user's id. */
export const memoryContainerTag = (userId: string) => `user-${userId}`;

/**
 * Memories relevant to `query`, from this user's container only. Returns [] if Supermemory fails.
 *
 * Reads from two places, because they become available at different times:
 * - `search.memories` returns facts Supermemory has distilled, which only exist once its
 *   asynchronous extraction ("dreaming") finishes — minutes later, or not at all on some plans.
 * - `search.documents` returns what we wrote, searchable within seconds.
 * Without the document fallback, anything the user said recently is invisible to the agent.
 */
export async function recallMemories(userId: string, query: string, limit = 5): Promise<string[]> {
  const containerTag = memoryContainerTag(userId);

  const [extracted, written] = await Promise.all([
    supermemory()
      .search.memories({ q: query, containerTag, limit })
      .then(({ results }) => results.flatMap((r) => (r.memory ?? r.chunk ? [r.memory ?? r.chunk!] : [])))
      .catch((err) => {
        console.error("[agents] memory recall failed", err);
        return [] as string[];
      }),
    supermemory()
      .search.documents({ q: query, containerTags: [containerTag], limit })
      .then(({ results }) =>
        results.flatMap((doc) => {
          const chunks = doc.chunks?.filter((c) => c.isRelevant).map((c) => c.content) ?? [];
          return chunks.length > 0 ? chunks : doc.title ? [doc.title] : [];
        }),
      )
      .catch((err) => {
        console.error("[agents] document recall failed", err);
        return [] as string[];
      }),
  ]);

  // Same fact can come back from both sources; keep first occurrence, cap at `limit`.
  return [...new Set([...extracted, ...written].map((t) => t.trim()).filter(Boolean))].slice(0, limit);
}

/** Lets the agent look up more of this user's memories mid-conversation. */
export function buildMemoryTools(userId: string): ToolSet {
  return {
    search_memory: tool({
      description:
        "Search your long-term memory of this user (preferences, people, past decisions). " +
        "Use it when the conversation needs something you might have learned before.",
      inputSchema: z.object({ query: z.string().describe("What to look for, in plain language.") }),
      execute: async ({ query }) => {
        const memories = await recallMemories(userId, query, 10);
        return memories.length > 0 ? memories : "No matching memories.";
      },
    }),
  };
}

const FACT_EXTRACTION_PROMPT = `You maintain long-term memory for a personal assistant.
From the exchange below, extract durable facts about the user worth remembering in future conversations:
preferences, personal details, relationships, goals, recurring commitments, decisions.
Skip small talk, one-off requests, and anything the assistant said about itself.
Write each fact as a short standalone sentence about "the user". Return an empty list if nothing is notable.`;

const factsSchema = z.object({ facts: z.array(z.string()).max(5) });

/**
 * Extracts notable facts from one exchange and writes them to the user's Supermemory container.
 * Best effort: failures are logged, never thrown. Token usage is added to `ctx.usage`.
 */
export async function rememberFacts(
  ctx: RunContext,
  exchange: { user: string; assistant: string },
): Promise<string[]> {
  try {
    const { output, totalUsage } = await generateText({
      model: utilityModel(ctx.plan),
      output: Output.object({ schema: factsSchema }),
      system: FACT_EXTRACTION_PROMPT,
      prompt: `User: ${exchange.user}\n\nAssistant: ${exchange.assistant}`,
      ...telemetryFor("remember-facts", ctx),
    });
    addUsage(ctx.usage, totalUsage);

    const containerTag = memoryContainerTag(ctx.userId);
    await Promise.all(
      output.facts.map((content) =>
        supermemory().add({ content, containerTag, metadata: { source: "chat", chatId: ctx.chatId } }),
      ),
    );
    return output.facts;
  } catch (err) {
    console.error("[agents] memory write failed", err);
    return [];
  }
}
