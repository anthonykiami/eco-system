import { sendHtml } from "@/lib/telegram/api";
import { markdownToTelegramHtml } from "@/lib/telegram/format";

/**
 * Sends scheduled-job output to Telegram through the shared client, so job replies are
 * formatted and split exactly like replies in a live chat.
 */
export async function sendTelegramMessage(chatId: string, text: string, threadId?: number): Promise<void> {
  await sendHtml(chatId, markdownToTelegramHtml(text), { threadId });
}
