import { sendMessageDraft, TelegramApiError } from "./api";
import type { BotContext } from "./context";
import { escapeHtml, markdownToTelegramHtml } from "./format";

/** How often the preview is refreshed while a reply is written. */
export const DRAFT_INTERVAL_MS = 600;
/** The preview shows the start of a reply; the full reply arrives as normal messages at the end. */
const PREVIEW_LENGTH = 3500;

export type Draft = { update: (text: string) => void; stop: () => Promise<void> };

/**
 * A live preview of a reply being written (Telegram's message drafts, for bots in Threaded Mode).
 * Updates are throttled; if Telegram refuses one, the preview stops and the reply arrives as usual.
 * `prefix` is HTML shown above the text, e.g. the agent's name.
 */
export function startDraft(c: BotContext, prefix = ""): Draft {
  const draftId = 1 + Math.floor(Math.random() * 2_000_000_000);
  let latest = "";
  let shown = "";
  let plain = false;
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sending: Promise<void> = Promise.resolve();

  const render = (text: string) => {
    const cut = text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}…` : text;
    return prefix + (plain ? escapeHtml(cut) : markdownToTelegramHtml(cut));
  };

  const send = async (text: string) => {
    try {
      await sendMessageDraft(c.chatId, draftId, render(text), c.threadId);
    } catch (err) {
      // Half-written markdown can make HTML Telegram rejects; fall back to plain text once.
      if (!plain && err instanceof TelegramApiError && /can't parse entities/i.test(err.description)) {
        plain = true;
        return send(text);
      }
      done = true;
      console.error("[telegram] draft preview failed; the reply will arrive without one", err);
    }
  };

  const flush = () => {
    timer = undefined;
    if (done || latest === shown) return;
    shown = latest;
    sending = sending.then(() => send(shown));
  };

  return {
    update(text) {
      latest = text;
      if (!timer && !done) timer = setTimeout(flush, DRAFT_INTERVAL_MS);
    },
    async stop() {
      done = true;
      clearTimeout(timer);
      await sending;
    },
  };
}
