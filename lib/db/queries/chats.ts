import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { chats, type Chat, type ChatChannel } from "@/lib/db/schema";
import { getAgent } from "./agents";
import { NotFoundError } from "./errors";

export type NewChatInput = {
  agentId: string;
  channel: ChatChannel;
  telegramTopicId?: number | null;
  fromTask?: boolean;
};

/** `telegramTopicId: null` means chats outside any Telegram topic; omitted means any. */
export async function listChats(
  userId: string,
  filter: { agentId?: string; channel?: ChatChannel; telegramTopicId?: number | null; fromTask?: boolean } = {},
): Promise<Chat[]> {
  return db
    .select()
    .from(chats)
    .where(
      and(
        eq(chats.userId, userId),
        filter.agentId ? eq(chats.agentId, filter.agentId) : undefined,
        filter.channel ? eq(chats.channel, filter.channel) : undefined,
        filter.telegramTopicId === null
          ? isNull(chats.telegramTopicId)
          : filter.telegramTopicId !== undefined
            ? eq(chats.telegramTopicId, filter.telegramTopicId)
            : undefined,
        filter.fromTask !== undefined ? eq(chats.fromTask, filter.fromTask) : undefined,
      ),
    )
    .orderBy(desc(chats.createdAt));
}

export async function getChat(userId: string, chatId: string): Promise<Chat | undefined> {
  const [row] = await db
    .select()
    .from(chats)
    .where(and(eq(chats.userId, userId), eq(chats.id, chatId)))
    .limit(1);
  return row;
}

/** Throws NotFoundError if the agent doesn't belong to the user. */
export async function createChat(userId: string, input: NewChatInput): Promise<Chat> {
  if (!(await getAgent(userId, input.agentId))) throw new NotFoundError("Agent", input.agentId);
  const [row] = await db
    .insert(chats)
    .values({ ...input, userId })
    .returning();
  return row;
}

/**
 * Returns the most recent conversation for this agent + channel (+ Telegram topic, none if
 * omitted), creating one if none exists. Chats made by task runs are never picked.
 */
export async function getOrCreateChat(userId: string, input: NewChatInput): Promise<Chat> {
  const scoped = { ...input, telegramTopicId: input.telegramTopicId ?? null, fromTask: false };
  const [latest] = await listChats(userId, scoped);
  return latest ?? createChat(userId, scoped);
}

/** The latest conversation in a Telegram topic, whichever agent it's with. */
export async function getLatestTopicChat(userId: string, telegramTopicId: number): Promise<Chat | undefined> {
  const [latest] = await listChats(userId, { telegramTopicId });
  return latest;
}

/** Returns true if a row was deleted. */
export async function deleteChat(userId: string, chatId: string): Promise<boolean> {
  const rows = await db
    .delete(chats)
    .where(and(eq(chats.userId, userId), eq(chats.id, chatId)))
    .returning({ id: chats.id });
  return rows.length > 0;
}
