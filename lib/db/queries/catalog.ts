import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { integrationCatalog, type CatalogIntegration } from "@/lib/db/schema";

/**
 * The apps the owner added (see admin.ts). Not user data: the same list for every user, so it
 * takes no userId.
 */
export async function listIntegrationCatalog(): Promise<CatalogIntegration[]> {
  return db.select().from(integrationCatalog).orderBy(asc(integrationCatalog.name));
}
