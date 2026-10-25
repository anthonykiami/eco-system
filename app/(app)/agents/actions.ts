"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  buildSpecialistSoul,
  checkAgentName,
  MAX_AGENT_DESCRIPTION_LENGTH,
  MAX_SPECIALISTS,
} from "@/lib/agents/naming";
import { requireActiveUser } from "@/lib/auth/session";
import { createAgent, deleteAgent, getUser, listAgents, updateAgent } from "@/lib/db/queries";
import { pauseAgentTasks, resumeAgentTasks } from "@/lib/heartbeat";
import type { User } from "@/lib/db/schema";
import { BotSetupError, connectAgentBot, disconnectAgentBot, renameAgentBot } from "@/lib/telegram/agent-bots";
import { deleteAgentTopic, renameAgentTopic } from "@/lib/telegram/topics";

const PATH = "/agents";

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "").trim();

/** The user's Telegram chat, for keeping agent topics in step; undefined if they haven't linked it. */
async function telegramContext(userId: string): Promise<{ user: User; chatId: number } | undefined> {
  const user = await getUser(userId);
  return user?.telegramChatId ? { user, chatId: Number(user.telegramChatId) } : undefined;
}

function checkFields(name: string, description: string, agents: Awaited<ReturnType<typeof listAgents>>, renamingId?: string) {
  const check = checkAgentName(name, agents, renamingId);
  if (!check.ok) redirect(`${PATH}?error=${check.reason}`);
  if (!description || description.length > MAX_AGENT_DESCRIPTION_LENGTH) redirect(`${PATH}?error=description`);
}

/** Creates a specialist from a name and a job description. It can be given its own bot afterwards. */
export async function addAgent(formData: FormData) {
  const session = await requireActiveUser();
  const userId = session.user.id;
  const name = field(formData, "name");
  const description = field(formData, "description");
  const agents = await listAgents(userId);
  if (agents.filter((a) => a.role === "specialized").length >= MAX_SPECIALISTS) redirect(`${PATH}?error=limit`);
  checkFields(name, description, agents);

  await createAgent(userId, { name, description, soul: buildSpecialistSoul(name, description) });
  revalidatePath(PATH);
  redirect(`${PATH}?saved=created`);
}

/** Renames a specialist or changes its job. Instructions built from the old name and job are rebuilt. */
export async function editAgent(formData: FormData) {
  const session = await requireActiveUser();
  const userId = session.user.id;
  const agents = await listAgents(userId);
  // Only the user's own specialists can be edited; anything else reads as not found.
  const agent = agents.find((a) => a.id === field(formData, "agentId") && a.role === "specialized");
  if (!agent) redirect(`${PATH}?error=missing`);
  const name = field(formData, "name");
  const description = field(formData, "description");
  checkFields(name, description, agents, agent.id);

  const generated = agent.description !== null && agent.soul === buildSpecialistSoul(agent.name, agent.description);
  const updated = await updateAgent(userId, agent.id, {
    name,
    description,
    ...(generated ? { soul: buildSpecialistSoul(name, description) } : {}),
  });
  const telegram = await telegramContext(userId);
  if (updated && (updated.name !== agent.name || updated.description !== agent.description)) {
    await renameAgentBot(updated);
    if (telegram) await renameAgentTopic(telegram, updated);
  }
  revalidatePath(PATH);
  redirect(`${PATH}?saved=updated`);
}

/** Deletes a specialist with its conversations, scheduled tasks and Telegram topic. */
export async function removeAgent(formData: FormData) {
  const session = await requireActiveUser();
  const userId = session.user.id;
  const agent = (await listAgents(userId)).find(
    (a) => a.id === field(formData, "agentId") && a.role === "specialized",
  );
  if (!agent) redirect(`${PATH}?error=missing`);

  await disconnectAgentBot(userId, agent);
  await deleteAgent(userId, agent.id);
  const telegram = await telegramContext(userId);
  if (telegram) await deleteAgentTopic(telegram, agent.telegramTopicId);
  revalidatePath(PATH);
  redirect(`${PATH}?saved=deleted`);
}

/** The user's own specialist with this id, or a redirect back with an error. */
async function ownSpecialist(userId: string, agentId: string) {
  const agent = (await listAgents(userId)).find((a) => a.id === agentId && a.role === "specialized");
  if (!agent) redirect(`${PATH}?error=missing`);
  return agent;
}

/** Gives a specialist its own Telegram bot, from a token the user made in @BotFather. */
export async function connectBot(formData: FormData) {
  const session = await requireActiveUser();
  const agent = await ownSpecialist(session.user.id, field(formData, "agentId"));
  try {
    await connectAgentBot(session.user.id, agent, field(formData, "token"));
  } catch (err) {
    if (err instanceof BotSetupError) redirect(`${PATH}?error=bot-${err.reason}`);
    console.error("[agents] couldn't connect a bot", err);
    redirect(`${PATH}?error=bot-failed`);
  }
  revalidatePath(PATH);
  redirect(`${PATH}?saved=bot`);
}

/** Takes a specialist's bot away; the agent stays, reachable through the main bot. */
export async function disconnectBot(formData: FormData) {
  const session = await requireActiveUser();
  const agent = await ownSpecialist(session.user.id, field(formData, "agentId"));
  await disconnectAgentBot(session.user.id, agent);
  revalidatePath(PATH);
  redirect(`${PATH}?saved=unbot`);
}

/** Pauses or resumes all of one of the user's agents' scheduled tasks. */
export async function setTasksPaused(formData: FormData) {
  const session = await requireActiveUser();
  const agentId = field(formData, "agentId");
  const paused = field(formData, "paused") === "true";
  const ok = paused ? await pauseAgentTasks(session.user.id, agentId) : await resumeAgentTasks(session.user.id, agentId);
  if (!ok) redirect(`${PATH}?error=missing`);
  revalidatePath(PATH);
  revalidatePath("/settings/schedules");
  redirect(`${PATH}?saved=${paused ? "paused" : "resumed"}`);
}
