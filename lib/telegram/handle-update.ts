import { getUser, getUserByTelegramChatId, setTelegramChatId } from "@/lib/db/queries";
import type { User } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { createRatelimit } from "@/lib/upstash";
import { showConnections, timezone, usage } from "./account-commands";
import { continueAgentFlow, handleAgentButton, showAgents, startNewAgent } from "./agent-commands";
import { MAIN_HANDLE } from "./agent-handles";
import { answerCallback, sendHtml } from "./api";
import { ensureBotCommands } from "./bot-commands";
import { converse, startNewChat, talk, type BotContext } from "./conversation";
import { normalizeLinkCode, redeemLinkCode } from "./linking";
import * as msg from "./messages";
import { clearFlow, getFlow } from "./state";
import { continueTaskFlow, handleTaskButton, showTasks, startBriefing, startNewTask } from "./task-commands";
import type { TelegramCallbackQuery, TelegramMessage, TelegramUpdate } from "./types";

/** Throttles code guessing: each chat gets a few /link attempts per window. */
const linkAttempts = createRatelimit("telegram-link", 5, "10 m");

type Command = { name: string; arg: string };

/** Parses "/cmd arg" and "/cmd@our_bot arg". Commands addressed to another bot are ignored. */
export function parseCommand(text: string): Command | undefined {
  const m = /^\/([a-zA-Z0-9_]+)(?:@(\S+))?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!m) return undefined;
  const [, name, bot, arg = ""] = m;
  if (bot && bot.toLowerCase() !== env.TELEGRAM_BOT_USERNAME.toLowerCase()) return undefined;
  return { name: name.toLowerCase(), arg: arg.trim() };
}

/** Processes one webhook update. Never throws: failures are logged and the user gets a short error. */
export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
  if (chatId === undefined) {
    // A button on a message too old for Telegram to include; just stop the spinner.
    if (update.callback_query) await answerCallback(update.callback_query.id).catch(() => {});
    return;
  }
  await ensureBotCommands();

  try {
    if (update.message) await handleMessage(update.message);
    else if (update.callback_query) await handleCallback(update.callback_query, chatId);
  } catch (err) {
    console.error(`[telegram] update ${update.update_id} failed`, err);
    await sendHtml(chatId, msg.GENERIC_ERROR).catch((sendErr) =>
      console.error("[telegram] failed to send error reply", sendErr),
    );
  }
}

/** The linked, active user for this chat, or undefined after telling the sender why not. */
async function resolveUser(chatId: number): Promise<User | undefined> {
  const user = await getUserByTelegramChatId(String(chatId));
  if (!user) {
    await sendHtml(chatId, msg.LINK_INSTRUCTIONS());
    return undefined;
  }
  if (user.status === "waitlist") {
    await sendHtml(chatId, msg.WAITLIST);
    return undefined;
  }
  return user;
}

async function handleMessage(message: TelegramMessage): Promise<void> {
  const chatId = message.chat.id;
  const text = message.text?.trim();
  const command = text ? parseCommand(text) : undefined;

  if ((command?.name === "start" || command?.name === "link") && command.arg) {
    return linkChat(message, command.arg);
  }

  const user = await resolveUser(chatId);
  if (!user) return;
  const c: BotContext = { user, chatId };

  if (command) {
    // Any command abandons a half-finished flow, so the user is never stuck in one.
    const flow = await getFlow(user.id);
    if (flow) await clearFlow(user.id);
    return runCommand(c, command, Boolean(flow));
  }

  if (!text) return sendHtml(chatId, msg.TEXT_ONLY);

  const flow = await getFlow(user.id);
  if (flow?.kind === "new_task") return continueTaskFlow(c, flow, text);
  if (flow) return continueAgentFlow(c, flow, text);
  return converse(c, text);
}

async function runCommand(c: BotContext, { name, arg }: Command, cancelledFlow: boolean): Promise<void> {
  switch (name) {
    case "start":
      return sendHtml(c.chatId, msg.LINK_SUCCESS);
    case "link":
      return sendHtml(c.chatId, msg.LINK_ALREADY_LINKED);
    case "help":
      return sendHtml(c.chatId, msg.HELP);
    case "cancel":
      return sendHtml(c.chatId, cancelledFlow ? msg.CANCELLED : msg.NOTHING_TO_CANCEL);
    case "new":
      return startNewChat(c);
    case "talk":
      return talk(c, arg);
    case "main":
      return talk(c, MAIN_HANDLE);
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
      return sendHtml(c.chatId, msg.HELP);
  }
}

/** Button taps. callback_data is "<action>" or "<action>:<id>"; ids are re-checked per user. */
async function handleCallback(query: TelegramCallbackQuery, chatId: number): Promise<void> {
  const user = await getUserByTelegramChatId(String(chatId));
  if (!user || user.status !== "active" || !query.message) {
    await answerCallback(query.id);
    return;
  }
  const c: BotContext = { user, chatId };
  const [action, arg = ""] = (query.data ?? "").split(":", 2);
  const messageId = query.message.message_id;

  // Answered after the action (which stops the button's spinner), unless the action showed its own toast.
  const task = await handleTaskButton(c, query.id, action, arg, messageId);
  if (task === "answered") return;
  if (!task && !(await handleAgentButton(c, action, arg, messageId))) {
    await sendHtml(chatId, msg.STALE_BUTTON);
  }
  await answerCallback(query.id);
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
