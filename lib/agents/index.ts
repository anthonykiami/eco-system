import {
  addMessage,
  createChat,
  currentMonth,
  ensurePrimaryAgent,
  getAgent,
  getChat,
  getOrCreateChat,
  incrementUsage,
  listAgents,
  listMessages,
  NotFoundError,
} from "@/lib/db/queries";
import type { Agent, Chat, ChatChannel } from "@/lib/db/schema";
import { ensureTracing, flushTracing, withAgentTrace } from "@/lib/tracing";
import { loadComposioTools } from "./composio";
import type { RunContext } from "./context";
import { enforceLimits, resolvePlan } from "./limits";
import { buildMemoryTools, rememberFacts } from "./memory";
import { webTools } from "./models";
import { runAgentTurn } from "./primary";
import { buildDelegationTools } from "./specialized";
import type { AgentChannel, RunAgent } from "./types";

export type { AgentChannel, RunAgent, RunAgentInput, RunAgentResult } from "./types";
export { AgentError, BudgetExceededError, RateLimitError, isAgentError } from "./errors";

const HISTORY_LIMIT = 30;
const EMPTY_REPLY = "Sorry, I wasn't able to finish that. Could you try rephrasing?";

// Scheduled runs are persisted as web chats (the chats.channel enum is web | telegram).
const toChatChannel = (channel: AgentChannel): ChatChannel =>
  channel === "telegram" ? "telegram" : "web";

export const runAgent: RunAgent = async ({ userId, chatId, agentId, message, channel }) => {
  ensureTracing();
  const user = await enforceLimits(userId);

  const { chat, agent } = await resolveChatAndAgent(userId, { chatId, agentId, channel });
  const ctx: RunContext = {
    userId,
    chatId: chat.id,
    channel,
    timezone: user.timezone,
    plan: resolvePlan(user.plan),
    integrationNotes: [],
    usage: { inputTokens: 0, outputTokens: 0 },
  };

  try {
    return await withAgentTrace("agent-run", ctx, async () => {
      // Load history before saving this turn so the new message isn't duplicated in the prompt.
      const history = await listMessages(userId, chat.id, { limit: HISTORY_LIMIT });
      await addMessage(userId, { chatId: chat.id, role: "user", content: message });

      const [composio, specialists] = await Promise.all([
        loadComposioTools(userId),
        agent.role === "primary"
          ? listAgents(userId).then((agents) => agents.filter((a) => a.role === "specialized"))
          : [],
      ]);
      ctx.integrationNotes = composio.notes;
      // Specialists get the user's integrations and the plan's web tools, but not memory or delegation.
      const workTools = { ...composio.tools, ...webTools(ctx.plan, ctx.timezone) };
      const tools = {
        ...workTools,
        ...buildMemoryTools(userId),
        ...buildDelegationTools(ctx, specialists, workTools),
      };

      const text = (await runAgentTurn({ ctx, agent, history, message, tools })).trim() || EMPTY_REPLY;

      await Promise.all([
        addMessage(userId, { chatId: chat.id, role: "assistant", content: text }),
        rememberFacts(ctx, { user: message, assistant: text }),
      ]);
      return { text, chatId: chat.id };
    });
  } finally {
    // Record usage even when the run fails partway, so tokens already spent are billed.
    await recordUsage(ctx);
    flushTracing();
  }
};

async function recordUsage({ userId, usage }: RunContext): Promise<void> {
  try {
    await incrementUsage(userId, currentMonth(), usage);
  } catch (err) {
    console.error(`[agents] failed to record usage for user ${userId}`, usage, err);
  }
}

/**
 * With a chatId, continues that chat with its own agent (agentId is ignored).
 * Without one, uses the latest chat for the agent + channel; scheduled runs always start a new chat.
 */
async function resolveChatAndAgent(
  userId: string,
  { chatId, agentId, channel }: { chatId?: string; agentId?: string; channel: AgentChannel },
): Promise<{ chat: Chat; agent: Agent }> {
  if (chatId) {
    const chat = await getChat(userId, chatId);
    if (!chat) throw new NotFoundError("Chat", chatId);
    const agent = await getAgent(userId, chat.agentId);
    if (!agent) throw new NotFoundError("Agent", chat.agentId);
    return { chat, agent };
  }

  const agent = agentId ? await getAgent(userId, agentId) : await ensurePrimaryAgent(userId);
  if (!agent) throw new NotFoundError("Agent", agentId!);

  const input = { agentId: agent.id, channel: toChatChannel(channel) };
  const chat = channel === "scheduled" ? await createChat(userId, input) : await getOrCreateChat(userId, input);
  return { chat, agent };
}
