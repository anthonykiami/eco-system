import { generateText, stepCountIs, tool, type ToolSet } from "ai";
import { z } from "zod";
import type { Agent } from "@/lib/db/schema";
import { telemetryFor } from "@/lib/tracing";
import { addUsage, type RunContext } from "../context";
import { PLAN_LIMITS } from "../limits";
import { agentModel } from "../models";
import { buildIntegrationLimits } from "../primary";

/** Tool-name-safe slug; Anthropic allows [a-zA-Z0-9_-]{1,64}. */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "agent"
  );
}

/**
 * One `delegate_to_<name>` tool per specialized agent. Each runs with its own soul as the system
 * prompt and the user's Composio tools, but cannot delegate further.
 * `agents` must already be scoped to ctx.userId.
 */
export function buildDelegationTools(ctx: RunContext, agents: Agent[], tools: ToolSet): ToolSet {
  const delegationTools: ToolSet = {};
  for (const agent of agents) {
    let name = `delegate_to_${slugify(agent.name)}`;
    if (name in delegationTools) name = `${name}_${agent.id.slice(0, 8)}`;

    delegationTools[name] = tool({
      description: [`Delegate a task to ${agent.name}, a specialized agent.`, agent.description]
        .filter(Boolean)
        .join(" "),
      inputSchema: z.object({
        task: z
          .string()
          .describe("A complete, self-contained description of what the agent should do, with any context it needs."),
      }),
      execute: ({ task }, { abortSignal }) => runSpecializedAgent(ctx, agent, task, tools, abortSignal),
    });
  }
  return delegationTools;
}

export async function runSpecializedAgent(
  ctx: RunContext,
  agent: Agent,
  task: string,
  tools: ToolSet,
  abortSignal?: AbortSignal,
): Promise<string> {
  const result = await generateText({
    model: agentModel(ctx.plan),
    system: [agent.soul, buildIntegrationLimits(ctx.integrationNotes)].filter(Boolean).join("\n\n"),
    prompt: task,
    tools,
    stopWhen: stepCountIs(PLAN_LIMITS[ctx.plan].maxSteps),
    abortSignal,
    ...telemetryFor(`specialized-agent:${agent.name}`, ctx),
  });
  addUsage(ctx.usage, result.totalUsage);
  return result.text;
}
