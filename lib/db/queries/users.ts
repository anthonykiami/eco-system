import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type User } from "@/lib/db/schema";

export type UserPatch = Partial<Pick<User, "name" | "image" | "timezone">>;

export async function getUser(userId: string): Promise<User | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return row;
}

export async function updateUser(userId: string, patch: UserPatch): Promise<User | undefined> {
  const [row] = await db.update(users).set(patch).where(eq(users.id, userId)).returning();
  return row;
}

export async function setTelegramChatId(
  userId: string,
  telegramChatId: string,
): Promise<User | undefined> {
  const [row] = await db
    .update(users)
    .set({ telegramChatId, telegramLinkedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  return row;
}

export async function clearTelegramChatId(userId: string): Promise<User | undefined> {
  const [row] = await db
    .update(users)
    .set({ telegramChatId: null, telegramLinkedAt: null })
    .where(eq(users.id, userId))
    .returning();
  return row;
}

/**
 * The one lookup that is not keyed by userId: the Telegram webhook only knows the chat id
 * and must resolve it to a user. Everything after this must go through userId-scoped helpers.
 */
export async function getUserByTelegramChatId(telegramChatId: string): Promise<User | undefined> {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.telegramChatId, telegramChatId))
    .limit(1);
  return row;
}

/** Links (or with null, unlinks) the Telegram group where the user talks to all their agents. */
export async function setTelegramGroupChatId(
  userId: string,
  telegramGroupChatId: string | null,
): Promise<User | undefined> {
  const [row] = await db.update(users).set({ telegramGroupChatId }).where(eq(users.id, userId)).returning();
  return row;
}

/** Like getUserByTelegramChatId, for the user's linked group: the webhook only knows the chat id. */
export async function getUserByTelegramGroupChatId(telegramGroupChatId: string): Promise<User | undefined> {
  const [row] = await db.select().from(users).where(eq(users.telegramGroupChatId, telegramGroupChatId)).limit(1);
  return row;
}
