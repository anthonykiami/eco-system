import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  integrationCatalog,
  usage,
  users,
  type CatalogIntegration,
  type Usage,
  type User,
  type UserStatus,
} from "@/lib/db/schema";

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

/** Adds an app to everyone's Integrations page, or refreshes its details and tool lists. */
export async function adminAddIntegration(
  entry: Omit<CatalogIntegration, "addedAt">,
): Promise<CatalogIntegration> {
  const [row] = await db
    .insert(integrationCatalog)
    .values(entry)
    .onConflictDoUpdate({ target: integrationCatalog.slug, set: entry })
    .returning();
  return row;
}

/** Takes an app off the Integrations page; agents stop using it. Returns true if it was there. */
export async function adminRemoveIntegration(slug: string): Promise<boolean> {
  const rows = await db
    .delete(integrationCatalog)
    .where(eq(integrationCatalog.slug, slug))
    .returning({ slug: integrationCatalog.slug });
  return rows.length > 0;
}
