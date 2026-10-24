import { getJob } from "@/lib/db/queries";
import type { Agent, ScheduledJob } from "@/lib/db/schema";
import {
  createUserJob,
  deleteUserJob,
  listUserJobs,
  pauseUserJob,
  resumeUserJob,
  runUserJobNow,
} from "@/lib/heartbeat";
import {
  BRIEFING_PROMPT,
  briefingPrompt,
  DAY_PRESETS,
  dailyCron,
  describeCron,
  type DayPreset,
} from "@/lib/heartbeat/briefing";
import { answerCallback, editHtml, sendHtml } from "./api";
import { loadAgents, type BotContext } from "./context";
import { escapeHtml } from "./format";
import * as msg from "./messages";
import { clearFlow, getFlow, setFlow, type Flow } from "./state";
import { formatRunTime, parseTimeOfDay } from "./time";
import type { InlineKeyboard } from "./types";

/** Same cap as the web form (app/settings/schedules/actions.ts). */
const MAX_PROMPT_LENGTH = 2000;
const TITLE_LENGTH = 40;

const isDayPreset = (value: string): value is DayPreset => Object.hasOwn(DAY_PRESETS, value);
const isBriefing = (job: ScheduledJob) => job.prompt.startsWith(BRIEFING_PROMPT);

function taskTitle(job: ScheduledJob): string {
  if (isBriefing(job)) return "☀️ Morning briefing";
  const firstLine = job.prompt.split("\n")[0].trim();
  return firstLine.length > TITLE_LENGTH ? `${firstLine.slice(0, TITLE_LENGTH - 1)}…` : firstLine;
}

function taskStatus(job: ScheduledJob, timezone: string): string {
  if (!job.enabled) return "paused";
  return job.nextRunAt ? `next ${formatRunTime(job.nextRunAt, timezone)}` : "not scheduled";
}

// ─── Views ──────────────────────────────────────────────────────────────────

async function listView(c: BotContext): Promise<{ html: string; keyboard: InlineKeyboard }> {
  const jobs = await listUserJobs(c.user.id);
  const addRow = [
    { text: "➕ New task", callback_data: "nt" },
    { text: "☀️ Briefing", callback_data: "nb" },
  ];
  if (jobs.length === 0) return { html: msg.NO_TASKS, keyboard: { inline_keyboard: [addRow] } };

  const lines = jobs.map(
    (job, i) =>
      `${i + 1}. <b>${escapeHtml(taskTitle(job))}</b>\n    ${describeCron(job.cronExpression)} · ${taskStatus(job, c.user.timezone)}`,
  );
  return {
    html: ["<b>Scheduled tasks</b>", "", ...lines, "", "Tap a task to pause, run or delete it."].join("\n"),
    keyboard: {
      inline_keyboard: [
        ...jobs.map((job, i) => [{ text: `${i + 1}. ${taskTitle(job)}`, callback_data: `t:${job.id}` }]),
        addRow,
      ],
    },
  };
}

function cardView(c: BotContext, job: ScheduledJob, agents: Agent[]): { html: string; keyboard: InlineKeyboard } {
  const agent = agents.find((a) => a.id === job.agentId);
  const lines = [
    `<b>${escapeHtml(taskTitle(job))}</b>`,
    `${describeCron(job.cronExpression)} · ${taskStatus(job, c.user.timezone)}`,
  ];
  if (agents.length > 1 && agent) lines.push(`Done by <b>${escapeHtml(agent.name)}</b>`);
  if (!isBriefing(job)) lines.push("", escapeHtml(job.prompt));

  const id = job.id;
  return {
    html: lines.join("\n"),
    keyboard: {
      inline_keyboard: [
        [
          job.enabled
            ? { text: "⏸ Pause", callback_data: `tp:${id}` }
            : { text: "▶️ Resume", callback_data: `tr:${id}` },
          { text: "⚡ Run now", callback_data: `tn:${id}` },
        ],
        [{ text: "🗑 Delete", callback_data: `tx:${id}` }],
        [{ text: "« All tasks", callback_data: "tl" }],
      ],
    },
  };
}

/** /tasks */
export async function showTasks(c: BotContext): Promise<void> {
  const { html, keyboard } = await listView(c);
  return sendHtml(c.chatId, html, { keyboard });
}

/**
 * Asks the user to turn on a task an agent just created (see lib/agents/schedule-tools.ts for why
 * agent-created tasks start off). The buttons are the ordinary resume and delete actions.
 */
export async function sendTaskConfirmation(c: BotContext, jobId: string): Promise<void> {
  const job = await getJob(c.user.id, jobId);
  if (!job || job.enabled) return;
  const agents = await loadAgents(c.user.id);
  const agent = agents.find((a) => a.id === job.agentId);
  const lines = [
    `🗓 <b>New scheduled task</b>${agents.length > 1 && agent ? ` for <b>${escapeHtml(agent.name)}</b>` : ""}`,
    `${describeCron(job.cronExpression)} (${escapeHtml(c.user.timezone)})`,
    "",
    isBriefing(job) ? "☀️ Morning briefing" : escapeHtml(job.prompt),
    "",
    "It's off until you turn it on.",
  ];
  return sendHtml(c.chatId, lines.join("\n"), {
    keyboard: {
      inline_keyboard: [
        [
          { text: "✅ Turn on", callback_data: `tr:${job.id}` },
          { text: "🗑 Discard", callback_data: `ty:${job.id}` },
        ],
      ],
    },
  });
}

// ─── Buttons ────────────────────────────────────────────────────────────────

/**
 * Handles task-related button taps. Returns false if `action` isn't one of them.
 * Answers the callback itself when it has a toast to show; returns "answered" then.
 */
export async function handleTaskButton(
  c: BotContext,
  callbackId: string,
  action: string,
  arg: string,
  messageId: number,
): Promise<boolean | "answered"> {
  switch (action) {
    case "tl": {
      const { html, keyboard } = await listView(c);
      await editHtml(c.chatId, messageId, html, { keyboard });
      return true;
    }
    case "nt":
      await startNewTask(c);
      return true;
    case "nb":
      await startBriefing(c);
      return true;
    case "fd":
      await chooseDays(c, arg);
      return true;
    case "fa":
      await chooseAgent(c, arg);
      return true;
  }
  if (!["t", "tp", "tr", "tn", "tx", "ty"].includes(action)) return false;

  const userId = c.user.id;
  // Every id from a button is re-checked against this user's jobs.
  const job = await getJob(userId, arg);
  if (!job) {
    await sendHtml(c.chatId, msg.STALE_BUTTON);
    return true;
  }

  let toast: string | undefined;
  let current: ScheduledJob | undefined = job;
  switch (action) {
    case "tp":
      current = await pauseUserJob(userId, job.id);
      break;
    case "tr":
      current = await resumeUserJob(userId, job.id);
      break;
    case "tn":
      toast = (await runUserJobNow(userId, job.id)) ? msg.TASK_QUEUED : msg.TASK_PAUSED_CANT_RUN;
      break;
    case "tx":
      await editHtml(c.chatId, messageId, `Delete <b>${escapeHtml(taskTitle(job))}</b>?`, {
        keyboard: {
          inline_keyboard: [
            [
              { text: "Yes, delete", callback_data: `ty:${job.id}` },
              { text: "Cancel", callback_data: `t:${job.id}` },
            ],
          ],
        },
      });
      return true;
    case "ty":
      await deleteUserJob(userId, job.id);
      await editHtml(c.chatId, messageId, `🗑 Deleted <b>${escapeHtml(taskTitle(job))}</b>.`);
      return true;
  }

  if (toast) await answerCallback(callbackId, toast);
  if (current) {
    const { html, keyboard } = cardView(c, current, await loadAgents(userId));
    await editHtml(c.chatId, messageId, html, { keyboard });
  }
  return toast ? "answered" : true;
}

// ─── Flows ──────────────────────────────────────────────────────────────────

/** /newtask [what to do] */
export async function startNewTask(c: BotContext, prompt = ""): Promise<void> {
  const flow: Flow = { kind: "new_task", step: "prompt" };
  await setFlow(c.user.id, flow);
  if (prompt) return continueTaskFlow(c, flow, prompt);
  return sendHtml(c.chatId, msg.ASK_TASK_PROMPT);
}

/** /briefing [time] */
export async function startBriefing(c: BotContext, time = ""): Promise<void> {
  const flow: Flow = { kind: "new_task", step: "time", prompt: briefingPrompt(""), briefing: true };
  await setFlow(c.user.id, flow);
  if (time) return continueTaskFlow(c, flow, time);
  return sendHtml(c.chatId, `☀️ ${msg.ASK_TASK_TIME}`);
}

type TaskFlow = Extract<Flow, { kind: "new_task" }>;

const daysKeyboard: InlineKeyboard = {
  inline_keyboard: [
    Object.entries(DAY_PRESETS).map(([key, { label }]) => ({ text: label, callback_data: `fd:${key}` })),
  ],
};

export async function continueTaskFlow(c: BotContext, flow: TaskFlow, text: string): Promise<void> {
  const userId = c.user.id;
  switch (flow.step) {
    case "prompt":
      if (text.length > MAX_PROMPT_LENGTH) return sendHtml(c.chatId, msg.PROMPT_INVALID);
      await setFlow(userId, { kind: "new_task", step: "time", prompt: text, briefing: false });
      return sendHtml(c.chatId, msg.ASK_TASK_TIME);
    case "time": {
      const time = parseTimeOfDay(text);
      if (!time) return sendHtml(c.chatId, msg.TIME_INVALID);
      await setFlow(userId, { ...flow, step: "days", time });
      return sendHtml(c.chatId, msg.ASK_TASK_DAYS, { keyboard: daysKeyboard });
    }
    default:
      return sendHtml(c.chatId, msg.USE_BUTTONS);
  }
}

async function chooseDays(c: BotContext, days: string): Promise<void> {
  const flow = await getFlow(c.user.id);
  if (flow?.kind !== "new_task" || flow.step !== "days" || !isDayPreset(days)) {
    return sendHtml(c.chatId, msg.STALE_BUTTON);
  }
  const agents = await loadAgents(c.user.id);
  // Briefings belong to the main agent, which can delegate parts of them.
  if (flow.briefing || agents.length === 1) return createTask(c, { ...flow, days }, agents[0]);

  await setFlow(c.user.id, { ...flow, step: "agent", days });
  return sendHtml(c.chatId, msg.ASK_TASK_AGENT, {
    keyboard: { inline_keyboard: agents.map((a) => [{ text: a.name, callback_data: `fa:${a.id}` }]) },
  });
}

async function chooseAgent(c: BotContext, agentId: string): Promise<void> {
  const flow = await getFlow(c.user.id);
  const agent = (await loadAgents(c.user.id)).find((a) => a.id === agentId);
  if (flow?.kind !== "new_task" || flow.step !== "agent" || !agent) {
    return sendHtml(c.chatId, msg.STALE_BUTTON);
  }
  return createTask(c, flow, agent);
}

async function createTask(
  c: BotContext,
  flow: { prompt: string; time: string; days: DayPreset; briefing: boolean },
  agent: Agent,
): Promise<void> {
  const cronExpression = dailyCron(flow.time, flow.days)!;
  const job = await createUserJob(c.user.id, { agentId: agent.id, cronExpression, prompt: flow.prompt });
  await clearFlow(c.user.id);
  const what = flow.briefing ? "your morning briefing" : `<b>${escapeHtml(taskTitle(job))}</b>`;
  const when = `${describeCron(cronExpression).toLowerCase()} (${escapeHtml(c.user.timezone)})`;
  const first = job.nextRunAt ? ` First one: ${formatRunTime(job.nextRunAt, c.user.timezone)}.` : "";
  return sendHtml(c.chatId, `✅ Scheduled ${what} ${when}.${first} Manage it with /tasks.`);
}
