import type { LanguageModelUsage } from "ai";
import type { TraceContext } from "@/lib/tracing";
import type { Plan } from "./limits";
import type { AgentChannel } from "./types";

export type TokenUsage = { inputTokens: number; outputTokens: number };

/** Per-run state shared by the primary agent, delegations and memory writes. */
export type RunContext = TraceContext & {
  channel: AgentChannel;
  /** The user's IANA timezone, so the agent can resolve "today", "tomorrow" and schedules. */
  timezone: string;
  /** Picks the models, tools and step budget for every call in the run. */
  plan: Plan;
  /** Limits on the user's connected integrations, stated to every agent in the run. Set once tools load. */
  integrationNotes: string[];
  /** Accumulates tokens across every model call in the run; recorded to the usage table at the end. */
  usage: TokenUsage;
  /** From RunAgentInput; fired by each delegation tool before the specialist runs. */
  onDelegate?: (agent: { id: string; name: string }) => void;
  /** From RunAgentInput; fired after schedule_task creates a (switched-off) task. */
  onTaskScheduled?: (task: { id: string }) => void;
};

export function addUsage(total: TokenUsage, usage: LanguageModelUsage): void {
  total.inputTokens += usage.inputTokens ?? 0;
  total.outputTokens += usage.outputTokens ?? 0;
}
