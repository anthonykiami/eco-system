import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel, ToolSet } from "ai";
import { env } from "@/lib/env";
import type { Plan } from "./limits";

type PlanModels = {
  /** Runs the primary agent and every specialized agent. */
  agent: string;
  /** Background work such as extracting facts to remember. */
  utility: string;
  /** Claude's own web search and web fetch, executed by Anthropic. Billed per use. */
  webTools: boolean;
};

export const PLAN_MODELS = {
  free: { agent: "claude-sonnet-5-5", utility: "claude-haiku-5-5", webTools: false },
  max: { agent: "claude-opus-5-5", utility: "claude-sonnet-5-5", webTools: true },
} as const satisfies Record<Plan, PlanModels>;

let provider: ReturnType<typeof createAnthropic> | undefined;
const anthropic = () => (provider ??= createAnthropic({ apiKey: env.ANTHROPIC_API_KEY }));

export const agentModel = (plan: Plan): LanguageModel => anthropic()(PLAN_MODELS[plan].agent);
export const utilityModel = (plan: Plan): LanguageModel => anthropic()(PLAN_MODELS[plan].utility);

/** Web search and fetch for plans that include them; {} otherwise. Searches are localized to the user's timezone. */
export function webTools(plan: Plan, timezone: string): ToolSet {
  if (!PLAN_MODELS[plan].webTools) return {};
  const { tools } = anthropic();
  return {
    web_search: tools.webSearch_20260318({
      maxUses: 5,
      userLocation: { type: "approximate", timezone },
      responseInclusion: "excluded",
    }),
    web_fetch: tools.webFetch_20260318({ maxUses: 5, responseInclusion: "excluded" }),
  };
}
