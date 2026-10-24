import { agentSlug, MAIN_SLUG } from "@/lib/agents/naming";
import type { Agent } from "@/lib/db/schema";

/** "@researcher find X" → { handle: "researcher", rest: "find X" }. Only a leading mention counts. */
export function parseMention(text: string): { handle: string; rest: string } | undefined {
  const m = /^@([\p{L}\p{N}_-]+)[\s,:]*([\s\S]*)$/u.exec(text.trim());
  return m ? { handle: m[1], rest: m[2].trim() } : undefined;
}

export type AgentMatch =
  | { status: "found"; agent: Agent }
  | { status: "ambiguous"; agents: Agent[] }
  | { status: "none" };

/**
 * Resolves what the user typed ("researcher", "Travel Planner", "@travel", "main") to one agent.
 * An exact handle wins; otherwise a unique prefix does.
 */
export function findAgent(agents: Agent[], query: string): AgentMatch {
  const handle = agentSlug(query.replace(/^@/, ""));
  if (handle === MAIN_SLUG) {
    const primary = agents.find((a) => a.role === "primary");
    return primary ? { status: "found", agent: primary } : { status: "none" };
  }

  const exact = agents.filter((a) => agentSlug(a.name) === handle);
  if (exact.length === 1) return { status: "found", agent: exact[0] };
  if (exact.length > 1) return { status: "ambiguous", agents: exact };

  const prefixed = agents.filter((a) => agentSlug(a.name).startsWith(handle));
  if (prefixed.length === 1) return { status: "found", agent: prefixed[0] };
  if (prefixed.length > 1) return { status: "ambiguous", agents: prefixed };
  return { status: "none" };
}

/** The handle shown to the user for an agent: "main" for the primary one. */
export const displayHandle = (agent: Agent) =>
  agent.role === "primary" ? MAIN_SLUG : agentSlug(agent.name);
