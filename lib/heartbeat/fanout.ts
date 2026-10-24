import { z } from "zod";
import * as q from "@/lib/db/queries";
import { env } from "@/lib/env";
import { qstash } from "@/lib/upstash";
import { computeNextRunAt, InvalidScheduleError } from "./schedule";

export const HEARTBEAT_PATH = "/api/cron/heartbeat";
export const JOB_RUN_PATH = "/api/jobs/run";

export const jobMessageSchema = z.object({
  jobId: z.string().min(1),
  userId: z.string().min(1),
  /** ISO timestamp of the next_run_at that made this job due. */
  scheduledFor: z.iso.datetime(),
});
export type JobMessage = z.infer<typeof jobMessageSchema>;

export type FanOutResult = { published: number; disabled: number; failed: number };

const CONCURRENCY = 20;

/**
 * Publishes one QStash message per due job, then advances its next_run_at so the next
 * heartbeat doesn't queue it again. If publishing fails the job stays due and is retried
 * next tick. If the update fails after publishing, the deduplicationId and the worker's
 * last_run_at check keep the job from running twice.
 */
export async function fanOutDueJobs(now: Date = new Date()): Promise<FanOutResult> {
  const due = await q.listDueJobs(now);
  const result: FanOutResult = { published: 0, disabled: 0, failed: 0 };

  for (let i = 0; i < due.length; i += CONCURRENCY) {
    const outcomes = await Promise.allSettled(
      due.slice(i, i + CONCURRENCY).map(({ id, userId }) => enqueueJob(userId, id, now)),
    );
    for (const o of outcomes) {
      if (o.status === "fulfilled") {
        if (o.value) result[o.value] += 1;
      } else {
        result.failed += 1;
        console.error("[heartbeat] failed to enqueue job", o.reason);
      }
    }
  }
  return result;
}

async function enqueueJob(
  userId: string,
  jobId: string,
  now: Date,
): Promise<"published" | "disabled" | null> {
  const [job, user] = await Promise.all([q.getJob(userId, jobId), q.getUser(userId)]);
  if (!job || !user || !job.enabled || !job.nextRunAt) return null;

  // A one-off runs once: claiming it clears next_run_at so it never comes due again.
  let nextRunAt: Date | null = null;
  try {
    if (job.kind === "recurring") nextRunAt = computeNextRunAt(job.cronExpression, user.timezone, now);
  } catch (err) {
    if (!(err instanceof InvalidScheduleError)) throw err;
    console.error(`[heartbeat] disabling job ${jobId}: ${err.message}`);
    await q.updateJob(userId, jobId, { enabled: false, nextRunAt: null });
    return "disabled";
  }

  const scheduledFor = job.nextRunAt;

  // Claim the run first: whoever moves next_run_at off scheduledFor owns it, so two
  // overlapping heartbeats can't both publish the same job.
  const claimed = await q.claimJobSchedule(userId, jobId, {
    expectedNextRunAt: scheduledFor,
    nextRunAt,
  });
  if (!claimed) return null;

  const body: JobMessage = { jobId, userId, scheduledFor: scheduledFor.toISOString() };
  try {
    await qstash.publishJSON({
      url: new URL(JOB_RUN_PATH, env.APP_URL).toString(),
      body,
      deduplicationId: `job-${jobId}-${scheduledFor.getTime()}`,
    });
  } catch (err) {
    // Hand the run back so the next heartbeat retries it instead of skipping it.
    await q
      .claimJobSchedule(userId, jobId, { expectedNextRunAt: nextRunAt, nextRunAt: scheduledFor })
      .catch(() => {});
    throw err;
  }
  return "published";
}
