import * as q from "@/lib/db/queries";
import type { ScheduledJob } from "@/lib/db/schema";
import { onceCron } from "./briefing";
import { computeNextRunAt, InvalidScheduleError, oneOffRunAt } from "./schedule";

/** User-facing job management. Every call is scoped to the signed-in user's id. */

async function timezoneFor(userId: string): Promise<string> {
  const user = await q.getUser(userId);
  if (!user) throw new q.NotFoundError("User", userId);
  return user.timezone;
}

/**
 * Throws InvalidScheduleError for a bad cron expression, NotFoundError if the agent
 * doesn't belong to the user. With `enabled: false` the job waits for resumeUserJob.
 */
export async function createUserJob(
  userId: string,
  input: { agentId: string; cronExpression: string; prompt: string },
  { enabled = true }: { enabled?: boolean } = {},
): Promise<ScheduledJob> {
  // Validates the schedule either way; a disabled job gets its first run when it's resumed.
  const nextRunAt = computeNextRunAt(input.cronExpression, await timezoneFor(userId));
  return q.createJob(userId, { ...input, enabled, nextRunAt: enabled ? nextRunAt : null });
}

/**
 * A job that happens once: a reminder (sent verbatim) or a one-off agent task. `date` is the
 * user's local YYYY-MM-DD and `time` HH:MM. Throws PastTimeError if that moment has passed,
 * InvalidScheduleError for a malformed date or time, NotFoundError for someone else's agent.
 * Unlike a recurring job, a switched-off one-off keeps its time, so turning it on later
 * doesn't move it.
 */
export async function createOneOffJob(
  userId: string,
  input: { agentId: string; kind: "once" | "reminder"; prompt: string; date: string; time: string },
  { enabled = true }: { enabled?: boolean } = {},
): Promise<ScheduledJob> {
  const timezone = await timezoneFor(userId);
  const cronExpression = onceCron(input.date, input.time);
  if (!cronExpression) throw new InvalidScheduleError(`${input.date} ${input.time}`, timezone);
  const nextRunAt = oneOffRunAt(cronExpression, input.date, input.time, timezone);
  return q.createJob(userId, {
    agentId: input.agentId,
    kind: input.kind,
    prompt: input.prompt,
    cronExpression,
    enabled,
    nextRunAt,
  });
}

export async function listUserJobs(userId: string): Promise<ScheduledJob[]> {
  return q.listJobs(userId);
}

export async function pauseUserJob(userId: string, jobId: string): Promise<ScheduledJob | undefined> {
  return q.updateJob(userId, jobId, { enabled: false });
}

/**
 * Recomputes next_run_at from now, so runs missed while paused are not replayed. A one-off keeps
 * its time; one whose time has passed can't be turned on and returns undefined.
 */
export async function resumeUserJob(userId: string, jobId: string): Promise<ScheduledJob | undefined> {
  const job = await q.getJob(userId, jobId);
  if (!job) return undefined;
  if (job.kind !== "recurring") {
    if (!job.nextRunAt || job.nextRunAt <= new Date()) return undefined;
    return q.updateJob(userId, jobId, { enabled: true });
  }
  const nextRunAt = computeNextRunAt(job.cronExpression, await timezoneFor(userId));
  return q.updateJob(userId, jobId, { enabled: true, nextRunAt });
}

/** Makes an enabled job due now, so the next heartbeat runs it once; its schedule then continues as normal. */
export async function runUserJobNow(userId: string, jobId: string): Promise<ScheduledJob | undefined> {
  const job = await q.getJob(userId, jobId);
  if (!job?.enabled) return undefined;
  return q.updateJob(userId, jobId, { nextRunAt: new Date() });
}

/**
 * After a timezone change, moves every enabled recurring job to its next run in the new timezone.
 * One-offs keep the moment they were set for.
 */
export async function rescheduleUserJobs(userId: string): Promise<void> {
  const [jobs, timezone] = await Promise.all([q.listJobs(userId), timezoneFor(userId)]);
  await Promise.all(
    jobs
      .filter((job) => job.enabled && job.kind === "recurring")
      .map((job) =>
        q.updateJob(userId, job.id, { nextRunAt: computeNextRunAt(job.cronExpression, timezone) }),
      ),
  );
}

/** Returns true if the job existed and was deleted. */
export async function deleteUserJob(userId: string, jobId: string): Promise<boolean> {
  return q.deleteJob(userId, jobId);
}

/** Stops all of an agent's tasks from running, without changing which ones are on. */
export async function pauseAgentTasks(userId: string, agentId: string): Promise<boolean> {
  return Boolean(await q.updateAgent(userId, agentId, { tasksPaused: true }));
}

/**
 * Lets an agent's tasks run again. Repeating tasks continue from their next time after now, so
 * runs missed while paused aren't replayed; a one-off whose time passed while paused runs now.
 */
export async function resumeAgentTasks(userId: string, agentId: string): Promise<boolean> {
  const agent = await q.updateAgent(userId, agentId, { tasksPaused: false });
  if (!agent) return false;
  const [jobs, timezone] = await Promise.all([q.listJobs(userId), timezoneFor(userId)]);
  await Promise.all(
    jobs
      .filter((job) => job.agentId === agentId && job.enabled && job.kind === "recurring")
      .map((job) => q.updateJob(userId, job.id, { nextRunAt: computeNextRunAt(job.cronExpression, timezone) })),
  );
  return true;
}
