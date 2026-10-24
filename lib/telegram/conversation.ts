import { isAgentError, runAgent } from "@/lib/agents";
import { createChat, ensurePrimaryAgent, getOrCreateChat, listAgents } from "@/lib/db/queries";
import type { Agent, User } from "@/lib/db/schema";
import { findAgent, parseMention } from "./agent-handles";
import { sendHtml, startTyping } from "./api";
import { escapeHtml, markdownToTelegramHtml } from "./format";
import * as msg from "./messages";
import { getActiveAgentId, setActiveAgentId } from "./state";
import type { InlineKeyboard } from "./types";

/** Who the bot is talking to: a linked, active user in their private chat. */
export type BotContext = { user: User; chatId: number };

/** The user's agents, primary first. Creates the primary agent on first use. */
export async function loadAgents(userId: string): Promise<Agent[]> {
  const primary = await ensurePrimaryAgent(userId);
  const agents = await listAgents(userId);
  return [primary, ...agents.filter((a) => a.id !== primary.id)];
}

/** The agent plain messages go to: the one picked with /talk, else the primary agent. */
export async function activeAgent(userId: string, agents: Agent[]): Promise<Agent> {
  const activeId = await getActiveAgentId(userId);
  return agents.find((a) => a.id === activeId) ?? agents[0];
}

/** Bold name above each reply once the user has more than one agent, so the chat reads like a group. */
export const replyLabel = (agent: Agent, agents: Agent[]) =>
  agents.length > 1 ? `<b>${escapeHtml(agent.name)}</b>\n` : "";

/** One button per agent; tapping it switches the conversation to that agent. */
export function talkKeyboard(agents: Agent[], activeId: string): InlineKeyboard {
  return {
    inline_keyboard: agents.map((a) => [
      { text: `${a.id === activeId ? "✓ " : ""}${a.name}`, callback_data: `at:${a.id}` },
    ]),
  };
}

/**
 * A plain message. "@name ..." sends just this message to that agent; otherwise it goes to the
 * active agent. A bare "@name" switches to that agent, like /talk.
 */
export async function converse(c: BotContext, text: string): Promise<void> {
  const agents = await loadAgents(c.user.id);
  const mention = agents.length > 1 ? parseMention(text) : undefined;
  if (!mention) return replyAs(c, await activeAgent(c.user.id, agents), agents, text);

  const match = findAgent(agents, mention.handle);
  if (match.status === "none") {
    // Not one of their agents (an email handle, a username…): treat it as an ordinary message.
    return replyAs(c, await activeAgent(c.user.id, agents), agents, text);
  }
  if (match.status === "ambiguous") return sendHtml(c.chatId, msg.ambiguousAgent(match.agents));
  if (!mention.rest) return switchTo(c, match.agent);
  return replyAs(c, match.agent, agents, mention.rest);
}

/** /talk [name]: switch who plain messages go to. Without a name, offers buttons. */
export async function talk(c: BotContext, query: string): Promise<void> {
  const agents = await loadAgents(c.user.id);
  if (!query) {
    const current = await activeAgent(c.user.id, agents);
    return sendHtml(c.chatId, msg.pickAgent(current), { keyboard: talkKeyboard(agents, current.id) });
  }
  const match = findAgent(agents, query);
  if (match.status === "none") return sendHtml(c.chatId, msg.noSuchAgent(query, agents));
  if (match.status === "ambiguous") return sendHtml(c.chatId, msg.ambiguousAgent(match.agents));
  return switchTo(c, match.agent);
}

export async function switchTo(c: BotContext, agent: Agent): Promise<void> {
  await setActiveAgentId(c.user.id, agent.role === "primary" ? undefined : agent.id);
  return sendHtml(c.chatId, msg.switchedTo(agent));
}

/** /new: a fresh conversation with whichever agent the user is talking to. */
export async function startNewChat(c: BotContext): Promise<void> {
  const agents = await loadAgents(c.user.id);
  const agent = await activeAgent(c.user.id, agents);
  await createChat(c.user.id, { agentId: agent.id, channel: "telegram" });
  return sendHtml(c.chatId, agents.length > 1 ? msg.newChatWith(agent) : msg.NEW_CHAT);
}

async function replyAs(c: BotContext, agent: Agent, agents: Agent[], text: string): Promise<void> {
  const stopTyping = startTyping(c.chatId);
  // Notices go out while the agent is still working; the reply waits for them so order is kept.
  const notices: Promise<void>[] = [];
  const announced = new Set<string>();
  let reply: string;
  try {
    // Each agent has one ongoing Telegram chat: its latest one. /new starts another.
    const chat = await getOrCreateChat(c.user.id, { agentId: agent.id, channel: "telegram" });
    const result = await runAgent({
      userId: c.user.id,
      chatId: chat.id,
      message: text,
      channel: "telegram",
      onDelegate: (specialist) => {
        if (announced.has(specialist.id)) return;
        announced.add(specialist.id);
        notices.push(
          sendHtml(c.chatId, msg.delegating(agent.name, specialist.name)).catch((err: unknown) =>
            console.error("[telegram] failed to send delegation notice", err),
          ),
        );
      },
    });
    reply = replyLabel(agent, agents) + markdownToTelegramHtml(result.text);
  } catch (err) {
    if (!isAgentError(err)) throw err;
    reply = escapeHtml(err.userMessage);
  } finally {
    stopTyping();
  }
  await Promise.all(notices);
  await sendHtml(c.chatId, reply);
}
