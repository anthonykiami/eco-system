import * as q from "@/lib/db/queries";
import type { ScheduledJob } from "@/lib/db/schema";
import { computeNextRunAt } from "./schedule";

/** User-facing job management. Every call is scoped to the signed-in user's id. */

async function timezoneFor(userId: string): Promise<string> {
  const user = await q.getUser(userId);
  if (!user) throw new q.NotFoundError("User", userId);
  return user.timezone;
}

/**
 * Throws InvalidScheduleError for a bad cron expression, NotFoundError if the agent
 * doesn't belong to the user.
 */
export async function createUserJob(
  userId: string,
  input: { agentId: string; cronExpression: string; prompt: string },
): Promise<ScheduledJob> {
  const nextRunAt = computeNextRunAt(input.cronExpression, await timezoneFor(userId));
  return q.createJob(userId, { ...input, enabled: true, nextRunAt });
}

export async function listUserJobs(userId: string): Promise<ScheduledJob[]> {
  return q.listJobs(userId);
}

export async function pauseUserJob(userId: string, jobId: string): Promise<ScheduledJob | undefined> {
  return q.updateJob(userId, jobId, { enabled: false });
}

/** Recomputes next_run_at from now, so runs missed while paused are not replayed. */
export async function resumeUserJob(userId: string, jobId: string): Promise<ScheduledJob | undefined> {
  const job = await q.getJob(userId, jobId);
  if (!job) return undefined;
  const nextRunAt = computeNextRunAt(job.cronExpression, await timezoneFor(userId));
  return q.updateJob(userId, jobId, { enabled: true, nextRunAt });
}

/** Makes an enabled job due now, so the next heartbeat runs it once; its schedule then continues as normal. */
export async function runUserJobNow(userId: string, jobId: string): Promise<ScheduledJob | undefined> {
  const job = await q.getJob(userId, jobId);
  if (!job?.enabled) return undefined;
  return q.updateJob(userId, jobId, { nextRunAt: new Date() });
}

/** After a timezone change, moves every enabled job to its next run in the new timezone. */
export async function rescheduleUserJobs(userId: string): Promise<void> {
  const [jobs, timezone] = await Promise.all([q.listJobs(userId), timezoneFor(userId)]);
  await Promise.all(
    jobs
      .filter((job) => job.enabled)
      .map((job) =>
        q.updateJob(userId, job.id, { nextRunAt: computeNextRunAt(job.cronExpression, timezone) }),
      ),
  );
}

/** Returns true if the job existed and was deleted. */
export async function deleteUserJob(userId: string, jobId: string): Promise<boolean> {
  return q.deleteJob(userId, jobId);
}
