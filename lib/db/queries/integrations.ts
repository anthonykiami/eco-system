import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { integrationAccess, type IntegrationAccess } from "@/lib/db/schema";

export async function listIntegrationAccess(userId: string): Promise<IntegrationAccess[]> {
  return db.select().from(integrationAccess).where(eq(integrationAccess.userId, userId));
}

/** Upserts the user's access level for one toolkit. */
export async function setIntegrationAccess(
  userId: string,
  toolkit: string,
  access: string,
): Promise<IntegrationAccess> {
  const [row] = await db
    .insert(integrationAccess)
    .values({ userId, toolkit, access })
    .onConflictDoUpdate({
      target: [integrationAccess.userId, integrationAccess.toolkit],
      set: { access, updatedAt: sql`now()` },
    })
    .returning();
  return row;
}
