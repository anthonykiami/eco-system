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

/** Who sent a message or tapped a button. In a group, the bots only answer their owner. */
export const telegramUserSchema = z.object({
  id: z.number(),
  is_bot: z.boolean().optional(),
  username: z.string().optional(),
});

/** Parts of a message's text, e.g. an @mention of a bot. */
const entitySchema = z.object({ type: z.string(), offset: z.number(), length: z.number() });
const timedFileSchema = fileSchema.extend({ duration: z.number(), mime_type: z.string().optional() });

export const telegramMessageSchema = z.object({
  message_id: z.number(),
  chat: telegramChatSchema,
  from: telegramUserSchema.optional(),
  text: z.string().optional(),
  entities: z.array(entitySchema).optional(),
  /** Text sent with a photo or file. */
  caption: z.string().optional(),
  caption_entities: z.array(entitySchema).optional(),
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
  reply_to_message: z.object({ message_id: z.number(), from: telegramUserSchema.optional() }).optional(),
});

/** A tap on an inline keyboard button. `message` is absent for very old messages. */
export const telegramCallbackQuerySchema = z.object({
  id: z.string(),
  from: telegramUserSchema.optional(),
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
