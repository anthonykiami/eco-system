import { AsyncLocalStorage } from "node:async_hooks";
import { env } from "@/lib/env";
import { htmlToPlainText } from "./format";
import { splitTelegramHtml, TELEGRAM_MESSAGE_LIMIT } from "./split";
import type { InlineKeyboard } from "./types";

type TelegramResponse<T> =
  | { ok: true; result: T }
  | { ok: false; error_code: number; description: string };

export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly status: number,
    readonly description: string,
  ) {
    super(`Telegram ${method} failed (${status}): ${description}`);
    this.name = "TelegramApiError";
  }
}

/**
 * Which bot the code is speaking as. The shared main bot by default; an update for an agent's own
 * bot runs inside asBot(that token), so every reply, button and download goes through that bot.
 */
const currentBot = new AsyncLocalStorage<string>();

export const asBot = <T>(token: string, fn: () => T): T => currentBot.run(token, fn);

const botToken = () => currentBot.getStore() ?? env.TELEGRAM_BOT_TOKEN;

/** The numeric id of the bot the code is speaking as (the part of its token before the colon). */
export const currentBotId = () => botToken().split(":")[0];

export async function callTelegram<T = unknown>(
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${botToken()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as TelegramResponse<T> | null;
  if (!data?.ok) {
    throw new TelegramApiError(method, res.status, data?.description ?? res.statusText);
  }
  return data.result;
}

const isParseError = (err: unknown) =>
  err instanceof TelegramApiError && /can't parse entities/i.test(err.description);

/**
 * Sends HTML, split into as many messages as needed. If Telegram rejects a chunk's markup,
 * that chunk is re-sent as plain text so the user still gets the reply.
 * A keyboard is attached to the last chunk, so its buttons sit under the end of the text.
 */
export type SendOptions = {
  keyboard?: InlineKeyboard;
  /** The topic to post in; omitted means the main chat. */
  threadId?: number;
};

export async function sendHtml(chatId: number | string, html: string, options: SendOptions = {}): Promise<void> {
  await sendHtmlMessages(chatId, html, options);
}

/** Like sendHtml, but returns the id of every message sent. */
export async function sendHtmlMessages(
  chatId: number | string,
  html: string,
  { keyboard, threadId }: SendOptions = {},
): Promise<number[]> {
  const chunks = splitTelegramHtml(html);
  const ids: number[] = [];
  const thread = threadId ? { message_thread_id: threadId } : {};
  for (const [i, chunk] of chunks.entries()) {
    const markup = { ...thread, ...(keyboard && i === chunks.length - 1 ? { reply_markup: keyboard } : {}) };
    let sent: { message_id?: number };
    try {
      sent = await callTelegram("sendMessage", {
        chat_id: chatId,
        text: chunk,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...markup,
      });
    } catch (err) {
      if (!isParseError(err)) throw err;
      sent = await callTelegram("sendMessage", { chat_id: chatId, text: htmlToPlainText(chunk), ...markup });
    }
    if (typeof sent?.message_id === "number") ids.push(sent.message_id);
  }
  return ids;
}

/**
 * Replaces a message the bot sent earlier (e.g. a card after one of its buttons is tapped).
 * Text too long for one message is sent as new messages instead, since an edit can't split.
 * "Message is not modified" is not an error: the card is already current.
 */
export async function editHtml(
  chatId: number | string,
  messageId: number,
  html: string,
  { keyboard }: { keyboard?: InlineKeyboard } = {},
): Promise<void> {
  if (html.length > TELEGRAM_MESSAGE_LIMIT) return sendHtml(chatId, html, { keyboard });
  try {
    await callTelegram("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: html,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: keyboard ?? { inline_keyboard: [] },
    });
  } catch (err) {
    if (err instanceof TelegramApiError && /message is not modified/i.test(err.description)) return;
    throw err;
  }
}

/** Stops the button's loading spinner; `text` shows as a brief toast. */
export async function answerCallback(callbackQueryId: string, text?: string): Promise<void> {
  await callTelegram("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
}

/**
 * Shows "typing…" until the returned stop function is called. Telegram clears the action
 * after about 5 seconds, so it's refreshed every 4.
 */
export function startTyping(chatId: number, threadId?: number): () => void {
  const send = () =>
    callTelegram("sendChatAction", {
      chat_id: chatId,
      action: "typing",
      ...(threadId ? { message_thread_id: threadId } : {}),
    }).catch(() => {});
  void send();
  const timer = setInterval(send, 4_000);
  return () => clearInterval(timer);
}

/** Telegram only lets bots download files up to 20 MB. */
export const TELEGRAM_DOWNLOAD_LIMIT = 20 * 1024 * 1024;

/** Downloads a file the user sent. Throws TelegramApiError if Telegram won't hand it over. */
export async function downloadFile(fileId: string): Promise<Uint8Array> {
  const file = await callTelegram<{ file_path?: string }>("getFile", { file_id: fileId });
  if (!file.file_path) throw new TelegramApiError("getFile", 400, "file has no path (too big?)");
  const res = await fetch(`https://api.telegram.org/file/bot${botToken()}/${file.file_path}`);
  if (!res.ok) throw new TelegramApiError("downloadFile", res.status, res.statusText);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Shows `html` as a live preview of a reply that's still being written (bots with Threaded Mode).
 * Updates with the same draftId replace each other; the preview disappears unless followed by a
 * real message.
 */
export async function sendMessageDraft(
  chatId: number,
  draftId: number,
  html: string,
  threadId?: number,
): Promise<void> {
  await callTelegram("sendMessageDraft", {
    chat_id: chatId,
    draft_id: draftId,
    text: html,
    parse_mode: "HTML",
    ...(threadId ? { message_thread_id: threadId } : {}),
  });
}

/** Creates a topic in the chat and returns its thread id. */
export async function createForumTopic(chatId: number | string, name: string): Promise<number> {
  const topic = await callTelegram<{ message_thread_id: number }>("createForumTopic", { chat_id: chatId, name });
  return topic.message_thread_id;
}

export async function renameForumTopic(chatId: number | string, threadId: number, name: string): Promise<void> {
  await callTelegram("editForumTopic", { chat_id: chatId, message_thread_id: threadId, name });
}

export async function deleteForumTopic(chatId: number | string, threadId: number): Promise<void> {
  await callTelegram("deleteForumTopic", { chat_id: chatId, message_thread_id: threadId });
}
