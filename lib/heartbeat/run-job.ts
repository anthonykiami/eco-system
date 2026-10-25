import { runAgent } from "@/lib/agents";
import { BudgetExceededError, RateLimitError, ServiceUnavailableError, type AgentError } from "@/lib/agents/errors";
import * as q from "@/lib/db/queries";
import type { Agent } from "@/lib/db/schema";
import { agentBotToken } from "@/lib/telegram/agent-bots";
import { asBot, TelegramApiError } from "@/lib/telegram/api";
import { redis } from "@/lib/upstash";
import type { JobMessage } from "./fanout";
import { sendTelegramMessage } from "./telegram";

/** Longer than any agent run, so a crashed worker's lock eventually frees itself. */
export const JOB_LOCK_TTL_SECONDS = 15 * 60;
const NOTICE_TTL_SECONDS = 24 * 60 * 60;

export type RunJobResult =
  | { status: "ran"; chatId: string }
  | { status: "reminded" }
  | { status: "locked" }
  | { status: "skipped"; reason: "not_found" | "disabled" | "already_ran" | "agent_paused" }
  | {
      status: "skipped";
      reason: "budget_exceeded" | "rate_limited" | "service_unavailable";
      notified: boolean;
    };

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

    // Queued just before its agent was paused: a one-off goes back to waiting for the resume.
    const agent = await q.getAgent(userId, job.agentId);
    if (agent?.tasksPaused) {
      if (job.kind !== "recurring") await q.updateJob(userId, jobId, { nextRunAt: new Date(scheduledFor) });
      return { status: "skipped", reason: "agent_paused" };
    }

    const user = await q.getUser(userId);

    // A reminder is the user's own words sent back at the set time; no agent runs.
    if (job.kind === "reminder") {
      await q.markJobRun(userId, jobId, { lastRunAt: new Date() });
      if (user?.telegramChatId) await deliver(userId, jobId, user.telegramChatId, agent, `⏰ ${job.prompt}`);
      await q.deleteJob(userId, jobId);
      return { status: "reminded" };
    }

    let result: { text: string; chatId: string };
    try {
      result = await runAgent({
        userId,
        agentId: job.agentId,
        message: job.prompt,
        channel: "scheduled",
      });
    } catch (err) {
      // Retrying can't help with these, so the run is skipped and the user told (once a day).
      if (err instanceof BudgetExceededError || err instanceof RateLimitError || err instanceof ServiceUnavailableError) {
        const notified = await notifyOncePerDay(userId, user?.telegramChatId ?? null, err);
        return {
          status: "skipped",
          reason:
            err instanceof BudgetExceededError
              ? "budget_exceeded"
              : err instanceof RateLimitError
                ? "rate_limited"
                : "service_unavailable",
          notified,
        };
      }
      throw err;
    }

    // Record the run before delivery so a Telegram failure never triggers a re-run.
    await q.markJobRun(userId, jobId, { lastRunAt: new Date(), nextRunAt: job.nextRunAt });
    if (user?.telegramChatId) await deliver(userId, jobId, user.telegramChatId, agent, result.text);
    if (job.kind === "once") await q.deleteJob(userId, jobId);
    return { status: "ran", chatId: result.chatId };
  } finally {
    await redis.eval(RELEASE_LOCK, [jobLockKey(jobId)], [token]).catch((err: unknown) => {
      console.error(`[jobs/run] failed to release lock for job ${jobId}`, err);
    });
  }
}

/**
 * Sends a job's output to Telegram: through the agent's own bot if it has one, else into its
 * topic if it has one (agents made before they got bots), otherwise the main chat, where a
 * specialist's result says who it's from. If the agent's bot can't reach the user (they never
 * tapped Start) or the topic is gone, it falls back to the main chat. A failed send is logged,
 * never retried, so the job can't run twice.
 */
async function deliver(
  userId: string,
  jobId: string,
  telegramChatId: string,
  agent: Agent | undefined,
  text: string,
): Promise<void> {
  const labeled = agent?.role === "specialized" ? `**${agent.name}**\n${text}` : text;
  try {
    const ownBot = agent && agentBotToken(agent);
    if (ownBot) {
      try {
        return await asBot(ownBot, () => sendTelegramMessage(telegramChatId, text));
      } catch (err) {
        console.error(`[jobs/run] agent ${agent.id}'s own bot couldn't deliver job ${jobId}; using the main bot`, err);
        return await sendTelegramMessage(telegramChatId, labeled);
      }
    }
    if (agent?.telegramTopicId == null) return await sendTelegramMessage(telegramChatId, labeled);
    try {
      await sendTelegramMessage(telegramChatId, text, agent.telegramTopicId);
    } catch (err) {
      if (!(err instanceof TelegramApiError && /thread not found/i.test(err.description))) throw err;
      await q.updateAgent(userId, agent.id, { telegramTopicId: null });
      await sendTelegramMessage(telegramChatId, labeled);
    }
  } catch (err) {
    console.error(`[jobs/run] failed to deliver job ${jobId} to Telegram`, err);
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
