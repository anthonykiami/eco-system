import { z } from "zod";

/**
 * The subset of the Telegram Bot API update shape this bot reads.
 * Schemas are the source of truth; the types are inferred from them so the webhook
 * can validate an untrusted payload with safeParse and still get exact types.
 */

export const telegramChatSchema = z.object({
  id: z.number(),
  type: z.enum(["private", "group", "supergroup", "channel"]),
});

export const telegramMessageSchema = z.object({
  message_id: z.number(),
  chat: telegramChatSchema,
  text: z.string().optional(),
});

/** A tap on an inline keyboard button. `message` is absent for very old messages. */
export const telegramCallbackQuerySchema = z.object({
  id: z.string(),
  message: telegramMessageSchema.optional(),
  data: z.string().optional(),
});

export const telegramUpdateSchema = z.object({
  update_id: z.number(),
  message: telegramMessageSchema.optional(),
  callback_query: telegramCallbackQuerySchema.optional(),
});

export type TelegramChat = z.infer<typeof telegramChatSchema>;
export type TelegramMessage = z.infer<typeof telegramMessageSchema>;
export type TelegramCallbackQuery = z.infer<typeof telegramCallbackQuerySchema>;
export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;

/** Outgoing: https://core.telegram.org/bots/api#inlinekeyboardmarkup */
export type InlineButton = { text: string; callback_data: string } | { text: string; url: string };
export type InlineKeyboard = { inline_keyboard: InlineButton[][] };
