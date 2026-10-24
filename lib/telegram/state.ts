import type { DayPreset } from "@/lib/heartbeat/briefing";
import { redis } from "@/lib/upstash";

/**
 * Per-user bot state kept in Redis, keyed by our userId: which agent the user is talking to,
 * and the multi-step flow (e.g. creating an agent) they're partway through, if any.
 */

const activeAgentKey = (userId: string) => `tg:active-agent:${userId}`;
const flowKey = (userId: string) => `tg:flow:${userId}`;
const replyAgentKey = (userId: string, messageId: number) => `tg:reply-agent:${userId}:${messageId}`;

/** How long a reply to an agent's message still reaches that agent. */
export const REPLY_AGENT_TTL_SECONDS = 30 * 24 * 60 * 60;

/** An unfinished flow is forgotten after this long, so a stray message later isn't misread as an answer. */
export const FLOW_TTL_SECONDS = 15 * 60;

export type Flow =
  | { kind: "new_agent"; step: "name" }
  | { kind: "new_agent"; step: "description"; name: string }
  | { kind: "rename_agent"; agentId: string }
  | { kind: "describe_agent"; agentId: string }
  | { kind: "new_task"; step: "prompt" }
  | { kind: "new_task"; step: "time"; prompt: string; briefing: boolean }
  | { kind: "new_task"; step: "days"; prompt: string; briefing: boolean; time: string }
  | { kind: "new_task"; step: "agent"; prompt: string; briefing: boolean; time: string; days: DayPreset };

/** Undefined means the primary agent. */
export async function getActiveAgentId(userId: string): Promise<string | undefined> {
  return (await redis.get<string>(activeAgentKey(userId))) ?? undefined;
}

export async function setActiveAgentId(userId: string, agentId: string | undefined): Promise<void> {
  if (agentId) await redis.set(activeAgentKey(userId), agentId);
  else await redis.del(activeAgentKey(userId));
}

export async function getFlow(userId: string): Promise<Flow | undefined> {
  return (await redis.get<Flow>(flowKey(userId))) ?? undefined;
}

export async function setFlow(userId: string, flow: Flow): Promise<void> {
  await redis.set(flowKey(userId), flow, { ex: FLOW_TTL_SECONDS });
}

export async function clearFlow(userId: string): Promise<void> {
  await redis.del(flowKey(userId));
}

/** Remembers which agent wrote these bot messages, so a reply to one goes back to that agent. */
export async function rememberReplyAgent(userId: string, messageIds: number[], agentId: string): Promise<void> {
  await Promise.all(
    messageIds.map((id) => redis.set(replyAgentKey(userId, id), agentId, { ex: REPLY_AGENT_TTL_SECONDS })),
  );
}

export async function getReplyAgentId(userId: string, messageId: number): Promise<string | undefined> {
  return (await redis.get<string>(replyAgentKey(userId, messageId))) ?? undefined;
}
