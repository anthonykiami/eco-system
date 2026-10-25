import { and, asc, eq } from "drizzle-orm";
import { DEFAULT_PRIMARY_AGENT } from "@/lib/agents/defaults";
import { db } from "@/lib/db";
import { agents, type Agent } from "@/lib/db/schema";

export type NewAgentInput = Pick<Agent, "name" | "soul"> &
  Partial<Pick<Agent, "role" | "description">>;
export type AgentPatch = Partial<
  Pick<
    Agent,
    | "name"
    | "description"
    | "soul"
    | "telegramTopicId"
    | "telegramBotId"
    | "telegramBotUsername"
    | "telegramBotToken"
    | "tasksPaused"
  >
>;

export async function listAgents(userId: string): Promise<Agent[]> {
  return db.select().from(agents).where(eq(agents.userId, userId)).orderBy(asc(agents.createdAt));
}

export async function getAgent(userId: string, agentId: string): Promise<Agent | undefined> {
  const [row] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.userId, userId), eq(agents.id, agentId)))
    .limit(1);
  return row;
}

export async function getPrimaryAgent(userId: string): Promise<Agent | undefined> {
  const [row] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.userId, userId), eq(agents.role, "primary")))
    .limit(1);
  return row;
}

/** Idempotent: returns the user's primary agent, creating the default one if missing. */
export async function ensurePrimaryAgent(userId: string): Promise<Agent> {
  const existing = await getPrimaryAgent(userId);
  if (existing) return existing;

  await db
    .insert(agents)
    .values({ userId, role: "primary", ...DEFAULT_PRIMARY_AGENT })
    .onConflictDoNothing();

  const created = await getPrimaryAgent(userId);
  if (!created) throw new Error(`Failed to create primary agent for user ${userId}`);
  return created;
}

export async function createAgent(userId: string, input: NewAgentInput): Promise<Agent> {
  const [row] = await db
    .insert(agents)
    .values({ role: "specialized", ...input, userId })
    .returning();
  return row;
}

export async function updateAgent(
  userId: string,
  agentId: string,
  patch: AgentPatch,
): Promise<Agent | undefined> {
  const [row] = await db
    .update(agents)
    .set(patch)
    .where(and(eq(agents.userId, userId), eq(agents.id, agentId)))
    .returning();
  return row;
}

/** Returns true if a row was deleted. */
export async function deleteAgent(userId: string, agentId: string): Promise<boolean> {
  const rows = await db
    .delete(agents)
    .where(and(eq(agents.userId, userId), eq(agents.id, agentId)))
    .returning({ id: agents.id });
  return rows.length > 0;
}

/**
 * Not keyed by userId: an agent's bot webhook only knows the bot's id and must resolve it to the
 * agent (and through agent.userId, its owner). Everything after this goes through userId-scoped helpers.
 */
export async function getAgentByTelegramBotId(telegramBotId: string): Promise<Agent | undefined> {
  const [row] = await db.select().from(agents).where(eq(agents.telegramBotId, telegramBotId)).limit(1);
  return row;
}
