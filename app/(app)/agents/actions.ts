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
import type { User } from "@/lib/db/schema";
import { deleteAgentTopic, renameAgentTopic, syncAgentTopics } from "@/lib/telegram/topics";

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

/** Creates a specialist from a name and a job description; it gets its Telegram topic right away. */
export async function addAgent(formData: FormData) {
  const session = await requireActiveUser();
  const userId = session.user.id;
  const name = field(formData, "name");
  const description = field(formData, "description");
  const agents = await listAgents(userId);
  if (agents.filter((a) => a.role === "specialized").length >= MAX_SPECIALISTS) redirect(`${PATH}?error=limit`);
  checkFields(name, description, agents);

  const agent = await createAgent(userId, { name, description, soul: buildSpecialistSoul(name, description) });
  const telegram = await telegramContext(userId);
  if (telegram) await syncAgentTopics(telegram, [agent]);
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
  if (telegram && updated && updated.name !== agent.name) await renameAgentTopic(telegram, updated);
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

  await deleteAgent(userId, agent.id);
  const telegram = await telegramContext(userId);
  if (telegram) await deleteAgentTopic(telegram, agent.telegramTopicId);
  revalidatePath(PATH);
  redirect(`${PATH}?saved=deleted`);
}
