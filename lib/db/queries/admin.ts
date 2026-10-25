import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { usage, users, type Usage, type User, type UserStatus } from "@/lib/db/schema";

/**
 * ADMIN ONLY — cross-user queries. Callers must verify the session belongs to an
 * ADMIN_EMAILS user (see lib/auth/admin.ts) before calling anything in this file.
 */

export async function adminListUsers(): Promise<User[]> {
  return db.select().from(users).orderBy(desc(users.createdAt));
}

export async function adminSetUserStatus(
  targetUserId: string,
  status: UserStatus,
): Promise<User | undefined> {
  const [row] = await db
    .update(users)
    .set({ status })
    .where(eq(users.id, targetUserId))
    .returning();
  return row;
}

/** `plan` must be a key of PLAN_LIMITS (lib/agents/limits.ts); the caller validates it. */
export async function adminSetUserPlan(targetUserId: string, plan: string): Promise<User | undefined> {
  const [row] = await db.update(users).set({ plan }).where(eq(users.id, targetUserId)).returning();
  return row;
}

/** Every user's usage row for a month ("YYYY-MM"); users with no activity have none. */
export async function adminListUsage(month: string): Promise<Usage[]> {
  return db.select().from(usage).where(eq(usage.month, month));
}
