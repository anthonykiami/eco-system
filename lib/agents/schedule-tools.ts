import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { getJob } from "@/lib/db/queries";
import type { Agent, ScheduledJob } from "@/lib/db/schema";
import {
  createOneOffJob,
  createUserJob,
  deleteUserJob,
  InvalidScheduleError,
  listUserJobs,
  pauseUserJob,
  PastTimeError,
} from "@/lib/heartbeat";
import { briefingPrompt, dailyCron, describeJob, WEEKDAYS, weeklyCron } from "@/lib/heartbeat/briefing";
import type { RunContext } from "./context";

/** Same cap as the web form and the Telegram flow. */
const MAX_TASK_LENGTH = 2000;

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).describe("24-hour HH:MM, e.g. 07:30");
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("The user's local date, YYYY-MM-DD. Work it out from today's date for words like 'tomorrow' or 'Friday'.");

function formatWhen(date: Date | null, timezone: string): string | null {
  if (!date) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/**
 * Lets the agent the user is talking to create and manage scheduled tasks in conversation
 * ("every weekday at 7, check my inbox"). `agents` must already be scoped to ctx.userId.
 * Not given to scheduled runs, so a task can't schedule more tasks.
 *
 * Tasks the agent creates start switched off and only the user can turn them on (a Telegram
 * button, /tasks, or the web). Otherwise instructions hidden in an email or web page the agent
 * read could plant a recurring job that keeps running with the user's integrations. For the
 * same reason there's no resume tool. Reminders are the exception: they only send their text
 * back to the user, so they're on from the start.
 */
export function buildScheduleTools(ctx: RunContext, self: Agent, agents: Agent[]): ToolSet {
  const userId = ctx.userId;
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? "unknown";
  const describe = (job: ScheduledJob) => ({
    id: job.id,
    task: job.prompt.length > 300 ? `${job.prompt.slice(0, 300)}…` : job.prompt,
    kind: job.kind,
    schedule: describeJob(job, ctx.timezone),
    agent: agentName(job.agentId),
    status: job.enabled ? "active" : "paused",
    nextRun: job.enabled ? formatWhen(job.nextRunAt, ctx.timezone) : null,
  });

  return {
    list_scheduled_tasks: tool({
      description:
        "List the user's scheduled tasks and reminders: jobs that run on their own and send the result to the user's Telegram.",
      inputSchema: z.object({}),
      execute: async () => ({ tasks: (await listUserJobs(userId)).map(describe), timezone: ctx.timezone }),
    }),

    schedule_task: tool({
      description: [
        "Schedule a task. At each run an agent carries out `task` on its own and the result is sent to the user's Telegram.",
        "Give `days` for a recurring task, or `date` for one that runs once.",
        "To simply remind the user of something, use set_reminder instead.",
        `Times are in the user's timezone (${ctx.timezone}).`,
        "Confirm the time and days with the user if they're unclear.",
      ].join(" "),
      inputSchema: z.object({
        task: z
          .string()
          .max(MAX_TASK_LENGTH)
          .describe(
            "Complete, self-contained instructions for the future run, which won't see this conversation. E.g. 'Summarize my unread email from the last 24 hours that needs a reply.'",
          ),
        time: timeSchema,
        days: z
          .union([z.enum(["every_day", "weekdays"]), z.array(z.enum(WEEKDAYS)).min(1)])
          .optional()
          .describe('Recurring: "every_day", "weekdays", or specific days like ["mon", "thu"]'),
        date: dateSchema.optional().describe("Runs once on this local date (YYYY-MM-DD) instead of repeating."),
        morning_briefing: z
          .boolean()
          .optional()
          .describe(
            "True for a morning briefing (calendar, email, reminders, weather). `task` is then only the user's extra requests, or empty.",
          ),
        agent: z
          .string()
          .optional()
          .describe(`Name of the agent that should do it. Defaults to you (${self.name}).`),
      }),
      execute: async ({ task, time, days, date, morning_briefing, agent }) => {
        const owner = agent ? agents.find((a) => a.name.toLowerCase() === agent.trim().toLowerCase()) : self;
        if (!owner) return { error: `No agent named "${agent}". Agents: ${agents.map((a) => a.name).join(", ")}.` };
        if (!days === !date) return { error: "Give either `days` (recurring) or `date` (once), not both." };
        if (!morning_briefing && !task.trim()) return { error: "Say what the task should do." };
        const prompt = morning_briefing ? briefingPrompt(task) : task;

        let job: ScheduledJob;
        if (date) {
          try {
            job = await createOneOffJob(
              userId,
              { agentId: owner.id, kind: "once", prompt, date, time },
              { enabled: false },
            );
          } catch (err) {
            if (err instanceof PastTimeError) return { error: "That time has already passed." };
            if (err instanceof InvalidScheduleError) return { error: "Invalid date or time." };
            throw err;
          }
        } else {
          const cronExpression =
            days === "every_day"
              ? dailyCron(time, "daily")
              : days === "weekdays"
                ? dailyCron(time, "weekdays")
                : weeklyCron(time, days!);
          if (!cronExpression) return { error: "Invalid time or days." };
          job = await createUserJob(userId, { agentId: owner.id, cronExpression, prompt }, { enabled: false });
        }
        try {
          ctx.onTaskScheduled?.({ id: job.id });
        } catch (err) {
          console.error(`[agents] onTaskScheduled listener failed for job ${job.id}`, err);
        }
        return {
          scheduled: describe(job),
          note:
            ctx.channel === "telegram"
              ? "Created switched off. The user turns it on with the button shown under your reply. Tell them."
              : "Created switched off. The user turns it on in Settings → Scheduled tasks or with /tasks in Telegram. Tell them.",
        };
      },
    }),

    set_reminder: tool({
      description: [
        "Remind the user of something at a specific time: at that moment your `text` is sent to their Telegram word for word.",
        "No agent runs then, so use schedule_task instead if something needs doing at that time (checking, summarizing, looking up).",
        `Times are in the user's timezone (${ctx.timezone}).`,
      ].join(" "),
      inputSchema: z.object({
        text: z
          .string()
          .min(1)
          .max(MAX_TASK_LENGTH)
          .describe("What to say, written to the user, e.g. 'Call mom about Sunday dinner.'"),
        date: dateSchema,
        time: timeSchema,
      }),
      execute: async ({ text, date, time }) => {
        try {
          const job = await createOneOffJob(userId, { agentId: self.id, kind: "reminder", prompt: text, date, time });
          return { reminder: describe(job), note: "It's set. Tell the user when you'll remind them." };
        } catch (err) {
          if (err instanceof PastTimeError) return { error: "That time has already passed." };
          if (err instanceof InvalidScheduleError) return { error: "Invalid date or time." };
          throw err;
        }
      },
    }),

    pause_scheduled_task: tool({
      description: "Pause a scheduled task by id (from list_scheduled_tasks). The user can turn it back on with /tasks or in settings.",
      inputSchema: z.object({ id: z.string() }),
      // Every helper is scoped to userId, so another user's id reads as not found.
      execute: async ({ id }) => {
        const job = await pauseUserJob(userId, id);
        return job ? { paused: describe(job) } : { error: "No such task." };
      },
    }),

    delete_scheduled_task: tool({
      description:
        "Permanently delete a scheduled task by id. Confirm with the user first unless they clearly asked to delete it.",
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => {
        const job = await getJob(userId, id);
        if (!job || !(await deleteUserJob(userId, id))) return { error: "No such task." };
        return { deleted: describe(job) };
      },
    }),
  };
}
