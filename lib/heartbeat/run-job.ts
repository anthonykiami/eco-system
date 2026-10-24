import { runAgent } from "@/lib/agents";
import { BudgetExceededError, RateLimitError, type AgentError } from "@/lib/agents/errors";
import * as q from "@/lib/db/queries";
import { redis } from "@/lib/upstash";
import type { JobMessage } from "./fanout";
import { sendTelegramMessage } from "./telegram";

/** Longer than any agent run, so a crashed worker's lock eventually frees itself. */
export const JOB_LOCK_TTL_SECONDS = 15 * 60;
const NOTICE_TTL_SECONDS = 24 * 60 * 60;

export type RunJobResult =
  | { status: "ran"; chatId: string }
  | { status: "locked" }
  | { status: "skipped"; reason: "not_found" | "disabled" | "already_ran" }
  | { status: "skipped"; reason: "budget_exceeded" | "rate_limited"; notified: boolean };

// Delete the lock only if we still own it.
const RELEASE_LOCK = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export const jobLockKey = (jobId: string) => `heartbeat:lock:job:${jobId}`;
export const noticeKey = (userId: string) => `heartbeat:notice:${userId}`;

/**
 * Runs one scheduled job. Anything other than a thrown error is a final outcome that
 * QStash shouldn't retry. Unexpected errors propagate so QStash does retry.
 */
export async function runScheduledJob({ jobId, userId, scheduledFor }: JobMessage): Promise<RunJobResult> {
  const token = crypto.randomUUID();
  const acquired = await redis.set(jobLockKey(jobId), token, { nx: true, ex: JOB_LOCK_TTL_SECONDS });
  if (acquired !== "OK") return { status: "locked" };

  try {
    const job = await q.getJob(userId, jobId);
    if (!job) return { status: "skipped", reason: "not_found" };
    if (!job.enabled) return { status: "skipped", reason: "disabled" };
    // A redelivered message for a run that already finished.
    if (job.lastRunAt && job.lastRunAt >= new Date(scheduledFor)) {
      return { status: "skipped", reason: "already_ran" };
    }

    const user = await q.getUser(userId);
    let result: { text: string; chatId: string };
    try {
      result = await runAgent({
        userId,
        agentId: job.agentId,
        message: job.prompt,
        channel: "scheduled",
      });
    } catch (err) {
      if (err instanceof BudgetExceededError || err instanceof RateLimitError) {
        const notified = await notifyOncePerDay(userId, user?.telegramChatId ?? null, err);
        return {
          status: "skipped",
          reason: err instanceof BudgetExceededError ? "budget_exceeded" : "rate_limited",
          notified,
        };
      }
      throw err;
    }

    // Record the run before delivery so a Telegram failure never triggers a re-run.
    await q.markJobRun(userId, jobId, { lastRunAt: new Date(), nextRunAt: job.nextRunAt });
    if (user?.telegramChatId) {
      try {
        // Like replies in a live chat, a specialist's result says who it's from.
        const agent = await q.getAgent(userId, job.agentId);
        const text = agent?.role === "specialized" ? `**${agent.name}**\n${result.text}` : result.text;
        await sendTelegramMessage(user.telegramChatId, text);
      } catch (err) {
        console.error(`[jobs/run] failed to deliver job ${jobId} to Telegram`, err);
      }
    }
    return { status: "ran", chatId: result.chatId };
  } finally {
    await redis.eval(RELEASE_LOCK, [jobLockKey(jobId)], [token]).catch((err: unknown) => {
      console.error(`[jobs/run] failed to release lock for job ${jobId}`, err);
    });
  }
}

async function notifyOncePerDay(
  userId: string,
  telegramChatId: string | null,
  err: AgentError,
): Promise<boolean> {
  if (!telegramChatId) return false;
  const first = await redis.set(noticeKey(userId), err.code, { nx: true, ex: NOTICE_TTL_SECONDS });
  if (first !== "OK") return false;
  try {
    await sendTelegramMessage(telegramChatId, `A scheduled task was skipped. ${err.userMessage}`);
    return true;
  } catch (sendErr) {
    // Free the slot so a later run can try again.
    await redis.del(noticeKey(userId));
    console.error(`[jobs/run] failed to send skip notice to user ${userId}`, sendErr);
    return false;
  }
}
