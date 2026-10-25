"use server";

import { requireActiveUser } from "@/lib/auth/session";
import { createChat, ensurePrimaryAgent } from "@/lib/db/queries";

/** Starts a fresh web conversation and returns its id. */
export async function startNewChat(): Promise<string> {
  const session = await requireActiveUser();
  const agent = await ensurePrimaryAgent(session.user.id);
  const chat = await createChat(session.user.id, { agentId: agent.id, channel: "web" });
  return chat.id;
}
