"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/auth/session";
import { updateUser } from "@/lib/db/queries";
import { rescheduleUserJobs } from "@/lib/heartbeat";

// The picker lists canonical zones, but aliases like "UTC" are valid too; Intl is the arbiter.
function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value.length > 0;
  } catch {
    return false;
  }
}

/** Saves the timezone, then moves scheduled tasks so "07:00" stays 07:00 local time. */
export async function setTimezone(formData: FormData) {
  const session = await requireActiveUser();
  const timezone = String(formData.get("timezone") ?? "");
  if (!isTimezone(timezone)) return;

  await updateUser(session.user.id, { timezone });
  await rescheduleUserJobs(session.user.id);
  revalidatePath("/settings", "layout");
}
