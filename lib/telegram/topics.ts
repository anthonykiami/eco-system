import type { Agent } from "@/lib/db/schema";
import { redis } from "@/lib/upstash";
import { callTelegram, currentBotId, deleteForumTopic, renameForumTopic } from "./api";
import type { BotContext } from "./context";

/**
 * Telegram's "Threaded Mode" for bots. It lets a bot stream replies as a live preview. Agents used
 * to get a topic each in the main bot's chat; they now get their own bots instead
 * (agent-bots.ts), but agents that already have a topic still answer in it.
 */

const topicsEnabledKey = () => `tg:topics-enabled:${currentBotId()}`;
const TOPICS_ENABLED_TTL_SECONDS = 10 * 60;

/** Whether the current bot has Threaded Mode on in BotFather. Cached briefly; false if Telegram can't say. */
export async function topicsEnabled(): Promise<boolean> {
  const cached = await redis.get<boolean>(topicsEnabledKey());
  if (cached !== null && cached !== undefined) return cached;
  let enabled = false;
  try {
    enabled = Boolean((await callTelegram<{ has_topics_enabled?: boolean }>("getMe", {})).has_topics_enabled);
  } catch (err) {
    console.error("[telegram] couldn't check whether topics are enabled", err);
    return false;
  }
  await redis.set(topicsEnabledKey(), enabled, { ex: TOPICS_ENABLED_TTL_SECONDS });
  return enabled;
}

/** Who answers in this topic: the agent it belongs to, or the primary agent in a user's own topic. */
export function topicOwner(agents: Agent[], threadId: number): { agent: Agent; agentTopic: boolean } {
  const owner = agents.find((a) => a.telegramTopicId === threadId);
  return owner ? { agent: owner, agentTopic: true } : { agent: agents[0], agentTopic: false };
}

/** Keeps an agent's topic named after it. Failures are logged; the topic just keeps its old name. */
export async function renameAgentTopic(c: BotContext, agent: Agent): Promise<void> {
  if (agent.telegramTopicId === null) return;
  await renameForumTopic(c.chatId, agent.telegramTopicId, agent.name).catch((err: unknown) =>
    console.error(`[telegram] couldn't rename the topic of agent ${agent.id}`, err),
  );
}

/** Removes a deleted agent's topic, history included. */
export async function deleteAgentTopic(c: BotContext, threadId: number | null): Promise<void> {
  if (threadId === null) return;
  await deleteForumTopic(c.chatId, threadId).catch((err: unknown) =>
    console.error(`[telegram] couldn't delete topic ${threadId}`, err),
  );
}
