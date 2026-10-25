"use server";

import { revalidatePath } from "next/cache";
import { clearTodayCache } from "@/lib/agents/today";
import { requireActiveUser } from "@/lib/auth/session";

/** Re-reads calendar and email now instead of waiting for the short cache to expire. */
export async function refreshToday() {
  const session = await requireActiveUser();
  await clearTodayCache(session.user.id);
  revalidatePath("/");
}
