import { isAgentError, runAgent, type AgentImage } from "@/lib/agents";
import { createChat, getOrCreateChat } from "@/lib/db/queries";
import type { Agent } from "@/lib/db/schema";
import { findAgent, parseMention } from "./agent-handles";
import { sendHtml, sendHtmlMessages, startTyping } from "./api";
import { activeAgent, loadAgents, type BotContext } from "./context";
import { escapeHtml, markdownToTelegramHtml } from "./format";
import * as msg from "./messages";
import { getReplyAgentId, rememberReplyAgent, setActiveAgentId } from "./state";
import { sendTaskConfirmation } from "./task-commands";
import type { InlineKeyboard } from "./types";

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

/** What came with the text: photos, or that the text is a transcribed voice message. */
export type Extras = { images?: AgentImage[]; voice?: boolean };

/** How much of a transcript is echoed back, so the user can tell they were heard right. */
const HEARD_ECHO_LENGTH = 300;

/**
 * A plain message. "@name ..." sends just this message to that agent, and so does replying to one
 * of an agent's messages; otherwise it goes to the active agent. A bare "@name" switches to that
 * agent, like /talk (unless it's the caption of a photo, which then goes to that agent).
 */
export async function converse(
  c: BotContext,
  text: string,
  replyToMessageId?: number,
  extras: Extras = {},
): Promise<void> {
  const agents = await loadAgents(c.user.id);
  const mention = agents.length > 1 ? parseMention(text) : undefined;
  const match = mention && findAgent(agents, mention.handle);

  // No @, or not one of their agents (an email handle, a username…): an ordinary message.
  if (!mention || !match || match.status === "none") {
    return replyAs(c, await defaultAgent(c.user.id, agents, replyToMessageId), agents, text, extras);
  }
  if (match.status === "ambiguous") return sendHtml(c.chatId, msg.ambiguousAgent(match.agents));
  if (!mention.rest && !extras.images?.length) return switchTo(c, match.agent);
  return replyAs(c, match.agent, agents, mention.rest, extras);
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

/** The agent that wrote the message being replied to, if known; else the active agent. */
async function defaultAgent(userId: string, agents: Agent[], replyToMessageId?: number): Promise<Agent> {
  if (replyToMessageId !== undefined && agents.length > 1) {
    const agentId = await getReplyAgentId(userId, replyToMessageId);
    const author = agents.find((a) => a.id === agentId);
    if (author) return author;
  }
  return activeAgent(userId, agents);
}

async function replyAs(
  c: BotContext,
  agent: Agent,
  agents: Agent[],
  text: string,
  { images, voice }: Extras = {},
): Promise<void> {
  const stopTyping = startTyping(c.chatId);
  // Notices go out while the agent is still working; the reply waits for them so order is kept.
  const notices: Promise<void>[] = [];
  const announced = new Set<string>();
  const scheduledTaskIds: string[] = [];
  let reply: string;
  try {
    // Each agent has one ongoing Telegram chat: its latest one. /new starts another.
    const chat = await getOrCreateChat(c.user.id, { agentId: agent.id, channel: "telegram" });
    const result = await runAgent({
      userId: c.user.id,
      chatId: chat.id,
      // The agent should know a transcript may have misheard words.
      message: voice ? `[Voice message, transcribed] ${text}` : text,
      images,
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
      onTaskScheduled: ({ id }) => scheduledTaskIds.push(id),
    });
    reply = replyLabel(agent, agents) + markdownToTelegramHtml(result.text);
  } catch (err) {
    if (!isAgentError(err)) throw err;
    reply = escapeHtml(err.userMessage);
  } finally {
    stopTyping();
  }
  await Promise.all(notices);
  if (voice) {
    const heard = text.length > HEARD_ECHO_LENGTH ? `${text.slice(0, HEARD_ECHO_LENGTH - 1)}…` : text;
    reply = `🎙 <i>${escapeHtml(heard)}</i>\n\n${reply}`;
  }
  const messageIds = await sendHtmlMessages(c.chatId, reply);
  if (agents.length > 1) {
    await rememberReplyAgent(c.user.id, messageIds, agent.id).catch((err: unknown) =>
      console.error("[telegram] failed to remember reply agent", err),
    );
  }
  // Tasks the agent created are off until the user turns them on here.
  for (const id of scheduledTaskIds) await sendTaskConfirmation(c, id);
}
