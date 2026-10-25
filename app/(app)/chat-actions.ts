"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/auth/session";
import { deleteUserJob, resumeUserJob } from "@/lib/heartbeat";

/** Turns on a task an agent created in chat (they start switched off). */
export async function turnOnTask(jobId: string): Promise<boolean> {
  const session = await requireActiveUser();
  const job = await resumeUserJob(session.user.id, jobId);
  revalidatePath("/settings/schedules");
  return Boolean(job?.enabled);
}

/** Throws away a task an agent created in chat. */
export async function discardTask(jobId: string): Promise<void> {
  const session = await requireActiveUser();
  await deleteUserJob(session.user.id, jobId);
  revalidatePath("/settings/schedules");
}
