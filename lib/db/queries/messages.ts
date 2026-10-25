import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages, type Chat, type Message, type MessageRole } from "@/lib/db/schema";
import { getChat } from "./chats";
import { NotFoundError } from "./errors";

export type NewMessageInput = { chatId: string; role: MessageRole; content: string };

/** Most recent `limit` messages in the chat, returned oldest-first. */
export async function listMessages(
  userId: string,
  chatId: string,
  { limit = 50 }: { limit?: number } = {},
): Promise<Message[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.userId, userId), eq(messages.chatId, chatId)))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  return rows.reverse();
}

export async function getMessage(userId: string, messageId: string): Promise<Message | undefined> {
  const [row] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.userId, userId), eq(messages.id, messageId)))
    .limit(1);
  return row;
}

/** Throws NotFoundError if the chat doesn't belong to the user. */
export async function addMessage(userId: string, input: NewMessageInput): Promise<Message> {
  if (!(await getChat(userId, input.chatId))) throw new NotFoundError("Chat", input.chatId);
  const [row] = await db
    .insert(messages)
    .values({ ...input, userId })
    .returning();
  return row;
}

/** Returns true if a row was deleted. */
export async function deleteMessage(userId: string, messageId: string): Promise<boolean> {
  const rows = await db
    .delete(messages)
    .where(and(eq(messages.userId, userId), eq(messages.id, messageId)))
    .returning({ id: messages.id });
  return rows.length > 0;
}

/** How many recent messages listRecentConversations looks through to find distinct chats. */
const RECENT_SCAN = 300;

/** The user's chats with the newest activity, each with its latest message, newest first. */
export async function listRecentConversations(
  userId: string,
  { limit = 5 }: { limit?: number } = {},
): Promise<{ chat: Chat; lastMessage: Message }[]> {
  const recent = await db
    .select()
    .from(messages)
    .where(eq(messages.userId, userId))
    .orderBy(desc(messages.createdAt))
    .limit(RECENT_SCAN);
  const latestByChat = new Map<string, Message>();
  for (const message of recent) {
    if (!latestByChat.has(message.chatId)) latestByChat.set(message.chatId, message);
    if (latestByChat.size === limit) break;
  }
  const found = await Promise.all(
    [...latestByChat.values()].map(async (lastMessage) => ({ chat: await getChat(userId, lastMessage.chatId), lastMessage })),
  );
  return found.flatMap(({ chat, lastMessage }) => (chat ? [{ chat, lastMessage }] : []));
}
