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

const fileSchema = z.object({ file_id: z.string(), file_size: z.number().optional() });
const timedFileSchema = fileSchema.extend({ duration: z.number(), mime_type: z.string().optional() });

export const telegramMessageSchema = z.object({
  message_id: z.number(),
  chat: telegramChatSchema,
  text: z.string().optional(),
  /** Text sent with a photo or file. */
  caption: z.string().optional(),
  /** One photo in several sizes, smallest first. */
  photo: z.array(fileSchema.extend({ width: z.number(), height: z.number() })).optional(),
  voice: timedFileSchema.optional(),
  audio: timedFileSchema.extend({ file_name: z.string().optional() }).optional(),
  /** A round video message. */
  video_note: timedFileSchema.optional(),
  video: timedFileSchema.optional(),
  document: fileSchema.extend({ mime_type: z.string().optional(), file_name: z.string().optional() }).optional(),
  /** The topic the message was sent in; absent in the main chat. */
  message_thread_id: z.number().optional(),
  /** Telegram's notices that a topic was created or renamed; the bot ignores them. */
  forum_topic_created: z.object({}).passthrough().optional(),
  forum_topic_edited: z.object({}).passthrough().optional(),
  /** Set when the user replies to an earlier message; only its id is read. */
  reply_to_message: z.object({ message_id: z.number() }).optional(),
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
