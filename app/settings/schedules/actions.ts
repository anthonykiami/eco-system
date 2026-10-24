"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/auth/session";
import { ensurePrimaryAgent } from "@/lib/db/queries";
import {
  createUserJob,
  deleteUserJob,
  pauseUserJob,
  resumeUserJob,
  runUserJobNow,
} from "@/lib/heartbeat";
import { briefingPrompt, DAY_PRESETS, dailyCron, type DayPreset } from "@/lib/heartbeat/briefing";

const SETTINGS_PATH = "/settings/schedules";
const MAX_PROMPT_LENGTH = 2000;

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "");
const isDayPreset = (value: string): value is DayPreset => Object.hasOwn(DAY_PRESETS, value);

/** Creates a job on the user's primary agent; bad input redirects back with an error code. */
async function addJob(formData: FormData, prompt: string) {
  const session = await requireActiveUser();
  const days = field(formData, "days");
  const cron = isDayPreset(days) ? dailyCron(field(formData, "time"), days) : undefined;
  if (!cron) redirect(`${SETTINGS_PATH}?error=time`);
  if (!prompt.trim() || prompt.length > MAX_PROMPT_LENGTH) redirect(`${SETTINGS_PATH}?error=prompt`);

  const agent = await ensurePrimaryAgent(session.user.id);
  await createUserJob(session.user.id, { agentId: agent.id, cronExpression: cron, prompt });
  revalidatePath(SETTINGS_PATH);
}

export async function addBriefing(formData: FormData) {
  await addJob(formData, briefingPrompt(field(formData, "extra")));
}

export async function addTask(formData: FormData) {
  await addJob(formData, field(formData, "prompt").trim());
}

/** Pause, resume, run now or delete. Each helper is scoped to the signed-in user. */
export async function changeJob(formData: FormData) {
  const session = await requireActiveUser();
  const jobId = field(formData, "jobId");
  const userId = session.user.id;

  switch (field(formData, "action")) {
    case "pause":
      await pauseUserJob(userId, jobId);
      break;
    case "resume":
      await resumeUserJob(userId, jobId);
      break;
    case "run":
      await runUserJobNow(userId, jobId);
      break;
    case "delete":
      await deleteUserJob(userId, jobId);
      break;
  }
  revalidatePath(SETTINGS_PATH);
}
