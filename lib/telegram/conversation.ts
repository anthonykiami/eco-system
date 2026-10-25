import { isAgentError, runAgent, type AgentImage } from "@/lib/agents";
import { createChat, getOrCreateChat } from "@/lib/db/queries";
import type { Agent } from "@/lib/db/schema";
import { findAgent, parseMention } from "./agent-handles";
import { agentBotToken } from "./agent-bots";
import { asBot, sendHtml, sendHtmlMessages, startTyping } from "./api";
import { startDraft, type Draft } from "./draft";
import { activeAgent, loadAgents, say, type BotContext } from "./context";
import { escapeHtml, markdownToTelegramHtml } from "./format";
import * as msg from "./messages";
import { getReplyAgentId, rememberReplyAgent, setActiveAgentId } from "./state";
import { sendTaskConfirmation } from "./task-commands";
import { topicOwner, topicsEnabled } from "./topics";
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

/** A turn that ran out of time (the AI SDK aborts it with a TimeoutError). */
const isTimeout = (err: unknown) => err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");

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
  // In an agent's own bot, everything goes to that agent.
  if (c.agent) {
    const agent = agents.find((a) => a.id === c.agent!.id) ?? c.agent;
    return replyAs(c, agent, agents, text, extras);
  }
  // In a topic everything goes to the topic's agent, in that topic's own conversation.
  if (c.threadId !== undefined) {
    const { agent } = topicOwner(agents, c.threadId);
    const chat = await getOrCreateChat(c.user.id, { agentId: agent.id, channel: "telegram", telegramTopicId: c.threadId });
    return replyAs(c, agent, agents, text, extras, chat.id);
  }
  const mention = agents.length > 1 ? parseMention(text) : undefined;
  const match = mention && findAgent(agents, mention.handle);

  // No @, or not one of their agents (an email handle, a username…): an ordinary message.
  if (!mention || !match || match.status === "none") {
    return replyAs(c, await defaultAgent(c, agents, replyToMessageId), agents, text, extras);
  }
  if (match.status === "ambiguous") return say(c, msg.ambiguousAgent(match.agents));
  if (!mention.rest && !extras.images?.length) {
    // In the group everyone sees who answers, so there's nothing to switch: just ask for the message.
    return c.group ? say(c, msg.mentionWithoutMessage(match.agent)) : switchTo(c, match.agent);
  }
  return replyAs(c, match.agent, agents, mention.rest, extras);
}

/** /talk [name]: switch who plain messages go to. Without a name, offers buttons. */
export async function talk(c: BotContext, query: string): Promise<void> {
  const agents = await loadAgents(c.user.id);
  if (!query) {
    const current = await activeAgent(c.user.id, agents);
    return say(c, msg.pickAgent(current), { keyboard: talkKeyboard(agents, current.id) });
  }
  const match = findAgent(agents, query);
  if (match.status === "none") return say(c, msg.noSuchAgent(query, agents));
  if (match.status === "ambiguous") return say(c, msg.ambiguousAgent(match.agents));
  return switchTo(c, match.agent);
}

export async function switchTo(c: BotContext, agent: Agent): Promise<void> {
  await setActiveAgentId(c.user.id, agent.role === "primary" ? undefined : agent.id);
  return say(c, msg.switchedTo(agent));
}

/**
 * /new: a fresh conversation with whichever agent the user is talking to (in an agent's bot or
 * topic: that agent; in the group: the main agent).
 */
export async function startNewChat(c: BotContext): Promise<void> {
  const agents = await loadAgents(c.user.id);
  const agent =
    c.agent ??
    (c.threadId !== undefined
      ? topicOwner(agents, c.threadId).agent
      : c.group
        ? agents[0]
        : await activeAgent(c.user.id, agents));
  await createChat(c.user.id, { agentId: agent.id, channel: "telegram", telegramTopicId: c.threadId ?? null });
  return say(c, agents.length > 1 ? msg.newChatWith(agent) : msg.NEW_CHAT);
}

/**
 * The agent that wrote the message being replied to, if known; else the active agent (in the
 * group: the main agent, since /talk is for the private chat).
 */
async function defaultAgent(c: BotContext, agents: Agent[], replyToMessageId?: number): Promise<Agent> {
  if (replyToMessageId !== undefined && agents.length > 1) {
    const agentId = await getReplyAgentId(c.user.id, c.chatId, replyToMessageId);
    const author = agents.find((a) => a.id === agentId);
    if (author) return author;
  }
  return c.group ? agents[0] : activeAgent(c.user.id, agents);
}

/** Whether a reply needs the agent's name on top, because the bot sending it isn't obviously that agent. */
function needsLabel(c: BotContext, agent: Agent, agents: Agent[]): boolean {
  if (agents.length < 2) return false;
  if (c.agent) return c.agent.id !== agent.id;
  // In the group the main bot is the main agent; in the private chat, every reply is labeled.
  if (c.group) return agent.role !== "primary";
  return c.threadId === undefined;
}

async function replyAs(
  c: BotContext,
  agent: Agent,
  agents: Agent[],
  text: string,
  extras: Extras = {},
  chatId?: string,
): Promise<void> {
  // In the group, a specialist with its own bot answers as itself.
  const ownBot = c.group && !c.agent && agent.role !== "primary" ? agentBotToken(agent) : undefined;
  if (ownBot) return asBot(ownBot, () => replyAs({ ...c, agent }, agent, agents, text, extras, chatId));

  const { images, voice } = extras;
  const stopTyping = startTyping(c.chatId, c.threadId);
  const label = needsLabel(c, agent, agents) ? replyLabel(agent, agents) : "";
  // Live previews only exist in private chats, for bots with Threaded Mode on.
  const draft: Draft | undefined = !c.group && (await topicsEnabled()) ? startDraft(c, label) : undefined;
  // Notices go out while the agent is still working; the reply waits for them so order is kept.
  const notices: Promise<void>[] = [];
  const announced = new Set<string>();
  const scheduledTaskIds: string[] = [];
  let reply: string;
  try {
    // Each agent has one ongoing chat in the main chat: its latest one. /new starts another.
    const chat = chatId ? { id: chatId } : await getOrCreateChat(c.user.id, { agentId: agent.id, channel: "telegram" });
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
        // In the group, a specialist with its own bot speaks up itself.
        const token = c.group ? agentBotToken(agents.find((a) => a.id === specialist.id) ?? { id: specialist.id, telegramBotToken: null }) : undefined;
        const notice = token
          ? asBot(token, () => sendHtml(c.chatId, msg.delegatedHere(agent.name)))
          : say(c, msg.delegating(agent.name, specialist.name));
        notices.push(notice.catch((err: unknown) => console.error("[telegram] failed to send delegation notice", err)));
      },
      onTaskScheduled: ({ id }) => scheduledTaskIds.push(id),
      onPartialText: draft?.update,
    });
    reply = label + markdownToTelegramHtml(result.text);
  } catch (err) {
    if (isTimeout(err)) reply = msg.TOO_SLOW;
    else if (isAgentError(err)) reply = escapeHtml(err.userMessage);
    else throw err;
  } finally {
    stopTyping();
    await draft?.stop();
  }
  await Promise.all(notices);
  if (voice) {
    const heard = text.length > HEARD_ECHO_LENGTH ? `${text.slice(0, HEARD_ECHO_LENGTH - 1)}…` : text;
    reply = `🎙 <i>${escapeHtml(heard)}</i>\n\n${reply}`;
  }
  const messageIds = await sendHtmlMessages(c.chatId, reply, { threadId: c.threadId });
  if (agents.length > 1) {
    await rememberReplyAgent(c.user.id, c.chatId, messageIds, agent.id).catch((err: unknown) =>
      console.error("[telegram] failed to remember reply agent", err),
    );
  }
  // Tasks the agent created are off until the user turns them on here.
  for (const id of scheduledTaskIds) await sendTaskConfirmation(c, id);
}
