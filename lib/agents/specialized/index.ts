import { generateText, stepCountIs, tool, type ToolSet } from "ai";
import { z } from "zod";
import type { Agent } from "@/lib/db/schema";
import { telemetryFor } from "@/lib/tracing";
import { addUsage, type RunContext } from "../context";
import { PLAN_LIMITS } from "../limits";
import { agentModel } from "../models";
import { asciiAgentSlug } from "../naming";
import { buildIntegrationLimits } from "../primary";

/**
 * One `delegate_to_<name>` tool per specialized agent. Each runs with its own soul as the system
 * prompt and the user's Composio tools, but cannot delegate further.
 * `agents` must already be scoped to ctx.userId.
 */
export function buildDelegationTools(ctx: RunContext, agents: Agent[], tools: ToolSet): ToolSet {
  const delegationTools: ToolSet = {};
  for (const agent of agents) {
    let name = `delegate_to_${asciiAgentSlug(agent.name)}`;
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
      execute: ({ task }, { abortSignal }) => {
        notifyDelegation(ctx, agent);
        return runSpecializedAgent(ctx, agent, task, tools, abortSignal);
      },
    });
  }
  return delegationTools;
}

/** A failing listener (e.g. a chat notice that couldn't be sent) must never break the delegation. */
function notifyDelegation(ctx: RunContext, agent: Agent): void {
  try {
    ctx.onDelegate?.({ id: agent.id, name: agent.name });
  } catch (err) {
    console.error(`[agents] onDelegate listener failed for agent ${agent.id}`, err);
  }
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
