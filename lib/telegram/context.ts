import { ensurePrimaryAgent, listAgents } from "@/lib/db/queries";
import type { Agent, User } from "@/lib/db/schema";
import { sendHtml, type SendOptions } from "./api";
import { getActiveAgentId } from "./state";

/**
 * Who the bot is talking to: a linked, active user in their private chat, and the topic the
 * update came from (undefined for the main chat).
 */
export type BotContext = { user: User; chatId: number; threadId?: number };

/** Replies where the user wrote: in the same topic, or the main chat. */
export function say(c: BotContext, html: string, options: Omit<SendOptions, "threadId"> = {}): Promise<void> {
  return sendHtml(c.chatId, html, { ...options, threadId: c.threadId });
}

/** The user's agents, primary first. Creates the primary agent on first use. */
export async function loadAgents(userId: string): Promise<Agent[]> {
  const primary = await ensurePrimaryAgent(userId);
  const agents = await listAgents(userId);
  return [primary, ...agents.filter((a) => a.id !== primary.id)];
}

/** The agent plain messages go to: the one picked with /talk, else the primary agent. */
export async function activeAgent(userId: string, agents: Agent[]): Promise<Agent> {
  const activeId = await getActiveAgentId(userId);
  return agents.find((a) => a.id === activeId) ?? agents[0];
}
