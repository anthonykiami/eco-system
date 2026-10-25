import { updateAgent } from "@/lib/db/queries";
import type { Agent } from "@/lib/db/schema";
import { redis } from "@/lib/upstash";
import { callTelegram, createForumTopic, deleteForumTopic, renameForumTopic, sendHtml } from "./api";
import type { BotContext } from "./context";
import * as msg from "./messages";

/**
 * Topics in the user's private chat with the bot (Telegram's "Threaded Mode" for bots): the main
 * chat is the primary agent, each specialist gets a topic of its own, and a topic the user makes
 * is a fresh conversation with the primary agent. Without Threaded Mode, nothing here does anything
 * and the bot works as a single chat.
 */

const TOPICS_ENABLED_KEY = "tg:topics-enabled";
const TOPICS_ENABLED_TTL_SECONDS = 10 * 60;
const syncLockKey = (userId: string) => `tg:topic-sync:${userId}`;

/** Whether the bot has Threaded Mode on in BotFather. Cached briefly; false if Telegram can't say. */
export async function topicsEnabled(): Promise<boolean> {
  const cached = await redis.get<boolean>(TOPICS_ENABLED_KEY);
  if (cached !== null && cached !== undefined) return cached;
  let enabled = false;
  try {
    enabled = Boolean((await callTelegram<{ has_topics_enabled?: boolean }>("getMe", {})).has_topics_enabled);
  } catch (err) {
    console.error("[telegram] couldn't check whether topics are enabled", err);
    return false;
  }
  await redis.set(TOPICS_ENABLED_KEY, enabled, { ex: TOPICS_ENABLED_TTL_SECONDS });
  return enabled;
}

/** Who answers in this topic: the agent it belongs to, or the primary agent in a user's own topic. */
export function topicOwner(agents: Agent[], threadId: number): { agent: Agent; agentTopic: boolean } {
  const owner = agents.find((a) => a.telegramTopicId === threadId);
  return owner ? { agent: owner, agentTopic: true } : { agent: agents[0], agentTopic: false };
}

/**
 * Gives every specialist without one its own topic, and says so in the main chat. Safe to call on
 * every update: it does nothing when all have topics, and a short lock stops two updates arriving
 * together from both creating one. `agents` are the user's own, primary first; they're updated in place.
 */
export async function syncAgentTopics(c: BotContext, agents: Agent[]): Promise<void> {
  const missing = agents.filter((a) => a.role === "specialized" && a.telegramTopicId === null);
  if (missing.length === 0 || !(await topicsEnabled())) return;
  if ((await redis.set(syncLockKey(c.user.id), 1, { nx: true, ex: 30 })) === null) return;
  try {
    for (const agent of missing) {
      const threadId = await createForumTopic(c.chatId, agent.name);
      await updateAgent(c.user.id, agent.id, { telegramTopicId: threadId });
      agent.telegramTopicId = threadId;
      await sendHtml(c.chatId, msg.topicCreated(agent));
    }
  } catch (err) {
    console.error(`[telegram] couldn't create agent topics for user ${c.user.id}`, err);
  } finally {
    await redis.del(syncLockKey(c.user.id));
  }
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
