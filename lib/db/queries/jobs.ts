import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { scheduledJobs, type ScheduledJob } from "@/lib/db/schema";
import { getAgent } from "./agents";
import { NotFoundError } from "./errors";

export type NewJobInput = Pick<ScheduledJob, "agentId" | "cronExpression" | "prompt"> &
  Partial<Pick<ScheduledJob, "kind" | "enabled" | "nextRunAt">>;
export type JobPatch = Partial<
  Pick<ScheduledJob, "agentId" | "cronExpression" | "prompt" | "enabled" | "nextRunAt">
>;

export async function listJobs(userId: string): Promise<ScheduledJob[]> {
  return db
    .select()
    .from(scheduledJobs)
    .where(eq(scheduledJobs.userId, userId))
    .orderBy(asc(scheduledJobs.createdAt));
}

export async function getJob(userId: string, jobId: string): Promise<ScheduledJob | undefined> {
  const [row] = await db
    .select()
    .from(scheduledJobs)
    .where(and(eq(scheduledJobs.userId, userId), eq(scheduledJobs.id, jobId)))
    .limit(1);
  return row;
}

/** Throws NotFoundError if the agent doesn't belong to the user. */
export async function createJob(userId: string, input: NewJobInput): Promise<ScheduledJob> {
  if (!(await getAgent(userId, input.agentId))) throw new NotFoundError("Agent", input.agentId);
  const [row] = await db
    .insert(scheduledJobs)
    .values({ ...input, userId })
    .returning();
  return row;
}

/** Throws NotFoundError if the patch moves the job to an agent the user doesn't own. */
export async function updateJob(
  userId: string,
  jobId: string,
  patch: JobPatch,
): Promise<ScheduledJob | undefined> {
  if (patch.agentId && !(await getAgent(userId, patch.agentId))) {
    throw new NotFoundError("Agent", patch.agentId);
  }
  const [row] = await db
    .update(scheduledJobs)
    .set(patch)
    .where(and(eq(scheduledJobs.userId, userId), eq(scheduledJobs.id, jobId)))
    .returning();
  return row;
}

export async function setJobEnabled(
  userId: string,
  jobId: string,
  enabled: boolean,
): Promise<ScheduledJob | undefined> {
  return updateJob(userId, jobId, { enabled });
}

/** Omit nextRunAt to record the run without touching the schedule. */
export async function markJobRun(
  userId: string,
  jobId: string,
  { lastRunAt, nextRunAt }: { lastRunAt: Date; nextRunAt?: Date | null },
): Promise<ScheduledJob | undefined> {
  const [row] = await db
    .update(scheduledJobs)
    .set(nextRunAt === undefined ? { lastRunAt } : { lastRunAt, nextRunAt })
    .where(and(eq(scheduledJobs.userId, userId), eq(scheduledJobs.id, jobId)))
    .returning();
  return row;
}

/**
 * Compare-and-set on next_run_at: advances the schedule only if it still holds
 * `expectedNextRunAt`. Returns false if another heartbeat already claimed this run,
 * so overlapping heartbeats can't both enqueue the same job.
 */
export async function claimJobSchedule(
  userId: string,
  jobId: string,
  { expectedNextRunAt, nextRunAt }: { expectedNextRunAt: Date | null; nextRunAt: Date | null },
): Promise<boolean> {
  const rows = await db
    .update(scheduledJobs)
    .set({ nextRunAt })
    .where(
      and(
        eq(scheduledJobs.userId, userId),
        eq(scheduledJobs.id, jobId),
        expectedNextRunAt ? eq(scheduledJobs.nextRunAt, expectedNextRunAt) : isNull(scheduledJobs.nextRunAt),
      ),
    )
    .returning({ id: scheduledJobs.id });
  return rows.length > 0;
}

/** Returns true if a row was deleted. */
export async function deleteJob(userId: string, jobId: string): Promise<boolean> {
  const rows = await db
    .delete(scheduledJobs)
    .where(and(eq(scheduledJobs.userId, userId), eq(scheduledJobs.id, jobId)))
    .returning({ id: scheduledJobs.id });
  return rows.length > 0;
}

/**
 * Cross-user by necessity: the heartbeat scans for due jobs across all users.
 * Returns only identifiers — load and run each job via the userId-scoped helpers above.
 */
export async function listDueJobs(
  now: Date,
  { limit = 500 }: { limit?: number } = {},
): Promise<{ id: string; userId: string }[]> {
  return db
    .select({ id: scheduledJobs.id, userId: scheduledJobs.userId })
    .from(scheduledJobs)
    .where(and(eq(scheduledJobs.enabled, true), lte(scheduledJobs.nextRunAt, now)))
    .orderBy(asc(scheduledJobs.nextRunAt))
    .limit(limit);
}
