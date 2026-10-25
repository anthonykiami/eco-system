import {
  getUser,
  getUserByTelegramChatId,
  getUserByTelegramGroupChatId,
  setTelegramChatId,
  setTelegramGroupChatId,
} from "@/lib/db/queries";
import type { Agent, User } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { createRatelimit } from "@/lib/upstash";
import { showConnections, timezone, usage } from "./account-commands";
import { continueAgentFlow, handleAgentButton, showAgents, startNewAgent } from "./agent-commands";
import { MAIN_SLUG } from "@/lib/agents/naming";
import { answerCallback, sendHtml } from "./api";
import { ensureBotCommands } from "./bot-commands";
import { loadAgents, say, type BotContext } from "./context";
import { converse, startNewChat, talk } from "./conversation";
import { downloadImage, mediaOf, transcribe } from "./media";
import { normalizeLinkCode, redeemLinkCode } from "./linking";
import * as msg from "./messages";
import { clearFlow, getFlow } from "./state";
import { continueTaskFlow, handleTaskButton, showTasks, startBriefing, startNewTask } from "./task-commands";
import type { TelegramCallbackQuery, TelegramMessage, TelegramUpdate } from "./types";

/** Throttles code guessing: each chat gets a few /link attempts per window. */
const linkAttempts = createRatelimit("telegram-link", 5, "10 m");

type Command = { name: string; arg: string };

/**
 * Which bot received the update: the shared main bot (no agent), or an agent's own bot. Code
 * runs inside asBot() for agent bots, so replies come from the bot that was written to.
 */
export type Source = { agent?: Agent };

/** The username commands may be addressed to ("/tasks@this_bot"). */
const botUsername = (source: Source) => source.agent?.telegramBotUsername ?? env.TELEGRAM_BOT_USERNAME;

/** Parses "/cmd arg" and "/cmd@our_bot arg". Commands addressed to another bot are ignored. */
export function parseCommand(text: string, username = env.TELEGRAM_BOT_USERNAME): Command | undefined {
  const m = /^\/([a-zA-Z0-9_]+)(?:@(\S+))?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return undefined;
  const [, name, bot, arg = ""] = m;
  if (bot && bot.toLowerCase() !== username.toLowerCase()) return undefined;
  return { name: name.toLowerCase(), arg: arg.trim() };
}

const isGroup = (chat: { type: string }) => chat.type === "group" || chat.type === "supergroup";

/** Processes one webhook update. Never throws: failures are logged and the user gets a short error. */
export async function handleUpdate(update: TelegramUpdate, source: Source = {}): Promise<void> {
  const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
  if (chatId === undefined) {
    // A button on a message too old for Telegram to include; just stop the spinner.
    if (update.callback_query) await answerCallback(update.callback_query.id).catch(() => {});
    return;
  }
  // Agents' bots get their command menu when they're connected.
  if (!source.agent) await ensureBotCommands();
  const threadId = update.message?.message_thread_id ?? update.callback_query?.message?.message_thread_id;

  try {
    if (update.message) await handleMessage(update.message, source);
    else if (update.callback_query) await handleCallback(update.callback_query, chatId, source);
  } catch (err) {
    console.error(`[telegram] update ${update.update_id} failed`, err);
    await sendHtml(chatId, msg.GENERIC_ERROR, { threadId }).catch((sendErr) =>
      console.error("[telegram] failed to send error reply", sendErr),
    );
  }
}

/**
 * The linked, active user for a private chat, or undefined after telling the sender why not. An
 * agent's own bot only talks to the user who owns that agent.
 */
async function resolvePrivateUser(chatId: number, source: Source): Promise<User | undefined> {
  const user = await getUserByTelegramChatId(String(chatId));
  if (!user) {
    await sendHtml(chatId, source.agent ? msg.AGENT_BOT_UNLINKED() : msg.LINK_INSTRUCTIONS());
    return undefined;
  }
  if (user.status === "waitlist") {
    await sendHtml(chatId, msg.WAITLIST);
    return undefined;
  }
  if (source.agent && source.agent.userId !== user.id) {
    await sendHtml(chatId, msg.AGENT_BOT_NOT_YOURS);
    return undefined;
  }
  return user;
}

/**
 * In a group: the owner of a linked group, if the sender is that owner. Anyone else in the group,
 * and any group that isn't linked, gets silence, so bots never answer strangers.
 */
async function resolveGroupUser(chatId: number, fromId: number | undefined, source: Source): Promise<User | undefined> {
  const user = await getUserByTelegramGroupChatId(String(chatId));
  if (!user || user.status !== "active" || fromId === undefined || user.telegramChatId !== String(fromId)) {
    return undefined;
  }
  if (source.agent && source.agent.userId !== user.id) return undefined;
  return user;
}

/** The bot usernames of this user's agents that have their own bot, lowercased, without "@". */
const agentBotUsernames = (agents: Agent[]) =>
  new Map(agents.flatMap((a) => (a.telegramBotUsername ? [[a.telegramBotUsername.toLowerCase(), a] as const] : [])));

/**
 * In a group, a message for one of the user's agent bots (an @mention of it, or a reply to it)
 * reaches that bot directly; the main bot leaves it alone instead of answering too.
 */
function addressedToAgentBot(message: TelegramMessage, agents: Agent[]): boolean {
  const bots = agentBotUsernames(agents);
  if (message.reply_to_message?.from?.username && bots.has(message.reply_to_message.from.username.toLowerCase())) {
    return true;
  }
  const text = message.text ?? message.caption ?? "";
  return (message.entities ?? message.caption_entities ?? []).some(
    (e) => e.type === "mention" && bots.has(text.slice(e.offset + 1, e.offset + e.length).toLowerCase()),
  );
}

/** Removes "@this_bot" from a group message, so the agent sees just what was said to it. */
const withoutMention = (text: string, username: string | null | undefined) =>
  username ? text.replace(new RegExp(`@${username}\\b`, "gi"), "").replace(/\s{2,}/g, " ").trim() : text;

async function handleMessage(message: TelegramMessage, source: Source): Promise<void> {
  const chatId = message.chat.id;
  const group = isGroup(message.chat);
  const rawText = message.text?.trim();
  const command = rawText ? parseCommand(rawText, botUsername(source)) : undefined;

  if ((command?.name === "start" || command?.name === "link") && command.arg) {
    if (group) return sendHtml(chatId, msg.LINK_PRIVATE_ONLY);
    if (!source.agent) return linkChat(message, command.arg);
  }
  if (group && !source.agent && command?.name === "linkgroup") return linkGroup(message);

  // Telegram announces topics being created or renamed as messages; there's nothing to answer.
  if (message.forum_topic_created || message.forum_topic_edited) return;

  const user = group ? await resolveGroupUser(chatId, message.from?.id, source) : await resolvePrivateUser(chatId, source);
  if (!user) return;
  const agents = group ? await loadAgents(user.id) : undefined;
  if (group && !source.agent && !command && addressedToAgentBot(message, agents!)) return;

  const c: BotContext = { user, chatId, threadId: message.message_thread_id, agent: source.agent, group };
  const text = group ? withoutMention(rawText ?? "", source.agent?.telegramBotUsername) : rawText;

  if (command) {
    // Any command abandons a half-finished flow, so the user is never stuck in one.
    const flow = await getFlow(user.id);
    if (flow) await clearFlow(user.id);
    return runCommand(c, command, Boolean(flow));
  }

  const replyTo = message.reply_to_message?.message_id;
  const media = mediaOf(message);
  if (media?.kind === "video") return say(c, msg.VIDEO_UNSUPPORTED);
  if (media?.kind === "file") return say(c, msg.FILE_UNSUPPORTED);
  if (media?.kind === "photo") {
    // A photo isn't an answer to a setup question, so it ends any flow and goes to an agent.
    await clearFlow(user.id);
    const caption = group ? withoutMention(message.caption ?? "", source.agent?.telegramBotUsername) : message.caption?.trim();
    return converse(c, caption ?? "", replyTo, { images: [await downloadImage(media)] });
  }

  // A voice message is handled exactly like the text it contains.
  let input = text;
  if (media?.kind === "voice") {
    const heard = await transcribe(user.id, media);
    if (!heard.ok) return say(c, msg.voiceProblem(heard.reason));
    input = heard.text;
  }
  if (!input) return say(c, msg.TEXT_ONLY);

  const flow = await getFlow(user.id);
  if (flow?.kind === "new_task") return continueTaskFlow(c, flow, input);
  if (flow) return continueAgentFlow(c, flow, input);
  return converse(c, input, replyTo, { voice: media?.kind === "voice" });
}

async function runCommand(c: BotContext, { name, arg }: Command, cancelledFlow: boolean): Promise<void> {
  switch (name) {
    case "start":
      return say(c, c.agent ? msg.agentBotWelcome(c.agent) : msg.LINK_SUCCESS);
    case "linkgroup":
      return say(c, msg.LINKGROUP_IN_GROUP);
    case "unlinkgroup":
      await setTelegramGroupChatId(c.user.id, null);
      return say(c, msg.GROUP_UNLINKED);
    case "link":
      return say(c, msg.LINK_ALREADY_LINKED);
    case "help":
      return say(c, c.agent ? msg.agentBotHelp(c.agent) : msg.HELP);
    case "cancel":
      return say(c, cancelledFlow ? msg.CANCELLED : msg.NOTHING_TO_CANCEL);
    case "new":
      return startNewChat(c);
    case "talk":
      return talk(c, arg);
    case "main":
      return talk(c, MAIN_SLUG);
    case "agents":
      return showAgents(c);
    case "newagent":
    case "new_agent":
      return startNewAgent(c, arg);
    case "tasks":
      return showTasks(c);
    case "newtask":
    case "new_task":
      return startNewTask(c, arg);
    case "briefing":
      return startBriefing(c, arg);
    case "connections":
      return showConnections(c);
    case "timezone":
      return timezone(c, arg);
    case "usage":
      return usage(c);
    default:
      return say(c, msg.HELP);
  }
}

/** Button taps. callback_data is "<action>" or "<action>:<id>"; ids are re-checked per user. */
async function handleCallback(query: TelegramCallbackQuery, chatId: number, source: Source): Promise<void> {
  const group = query.message ? isGroup(query.message.chat) : false;
  let user = group
    ? await resolveGroupUser(chatId, query.from?.id, source)
    : await getUserByTelegramChatId(String(chatId));
  if (user && !group && source.agent && source.agent.userId !== user.id) user = undefined;
  if (!user || user.status !== "active" || !query.message) {
    await answerCallback(query.id);
    return;
  }
  const c: BotContext = { user, chatId, threadId: query.message.message_thread_id, agent: source.agent, group };
  const [action, arg = ""] = (query.data ?? "").split(":", 2);
  const messageId = query.message.message_id;

  // Answering stops the button's spinner. It's done even if the action throws, unless the
  // action already answered with its own toast.
  let answered = false;
  try {
    const task = await handleTaskButton(c, query.id, action, arg, messageId);
    answered = task === "answered";
    if (!task && !(await handleAgentButton(c, action, arg, messageId))) {
      await say(c, msg.STALE_BUTTON);
    }
  } finally {
    if (!answered) await answerCallback(query.id).catch(() => {});
  }
}

async function linkChat(message: TelegramMessage, rawCode: string): Promise<void> {
  const chatId = message.chat.id;
  if (message.chat.type !== "private") return sendHtml(chatId, msg.LINK_PRIVATE_ONLY);

  const { success } = await linkAttempts.limit(String(chatId));
  if (!success) return sendHtml(chatId, msg.LINK_TOO_MANY_ATTEMPTS);

  const code = normalizeLinkCode(rawCode);
  const userId = code && (await redeemLinkCode(code));
  const user = userId && (await getUser(userId));
  if (!user) return sendHtml(chatId, msg.LINK_INVALID_CODE);

  const current = await getUserByTelegramChatId(String(chatId));
  if (current?.id === user.id) return sendHtml(chatId, msg.LINK_ALREADY_LINKED);
  if (current) return sendHtml(chatId, msg.LINK_CHAT_TAKEN);

  await setTelegramChatId(user.id, String(chatId));
  return sendHtml(chatId, msg.LINK_SUCCESS);
}

/**
 * /linkgroup, sent in a group by a user whose private chat with the main bot is linked: from then
 * on, that group is where they talk to all their agents' bots at once.
 */
async function linkGroup(message: TelegramMessage): Promise<void> {
  const chatId = message.chat.id;
  const user = message.from && (await getUserByTelegramChatId(String(message.from.id)));
  if (!user || user.status !== "active") return sendHtml(chatId, msg.LINKGROUP_UNKNOWN_USER);
  const current = await getUserByTelegramGroupChatId(String(chatId));
  if (current && current.id !== user.id) return sendHtml(chatId, msg.LINK_CHAT_TAKEN);

  await setTelegramGroupChatId(user.id, String(chatId));
  return sendHtml(chatId, msg.groupLinked(await loadAgents(user.id)));
}
