import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { createAgent } from "@/lib/db/queries";
import type { Agent } from "@/lib/db/schema";
import {
  agentSlug,
  buildSpecialistSoul,
  checkAgentName,
  MAX_AGENT_DESCRIPTION_LENGTH,
  MAX_AGENT_NAME_LENGTH,
  MAX_SPECIALISTS,
} from "./naming";

/**
 * Lets the primary agent create a specialist when the user asks for one in conversation
 * ("make me a fitness coach"). `agents` must already be scoped to `userId`.
 */
export function buildAgentTools(userId: string, agents: Agent[]): ToolSet {
  return {
    create_agent: tool({
      description: [
        "Create a new specialized agent for the user. Only do this when the user asks for a new agent.",
        "Afterwards you can hand it tasks (from the next message on), and the user can talk to it directly in Telegram with @handle.",
      ].join(" "),
      inputSchema: z.object({
        name: z.string().describe(`Short name, e.g. "Coach" or "Travel Planner" (max ${MAX_AGENT_NAME_LENGTH} characters).`),
        job: z
          .string()
          .min(1)
          .max(MAX_AGENT_DESCRIPTION_LENGTH)
          .describe("What the agent is for, in a sentence or two, written to the agent: e.g. 'Plans trips and finds flights and hotels within budget.'"),
      }),
      execute: async ({ name, job }) => {
        const trimmed = name.trim();
        if (agents.filter((a) => a.role === "specialized").length >= MAX_SPECIALISTS) {
          return { error: `The user already has the maximum of ${MAX_SPECIALISTS} specialized agents.` };
        }
        const check = checkAgentName(trimmed, agents);
        if (!check.ok) {
          return {
            error:
              check.reason === "taken"
                ? `An agent called ${check.agent.name} already exists.`
                : check.reason === "reserved"
                  ? '"main" is reserved for the main agent.'
                  : `Names need 1 to ${MAX_AGENT_NAME_LENGTH} characters with at least one letter or number.`,
          };
        }
        const agent = await createAgent(userId, {
          name: trimmed,
          description: job,
          soul: buildSpecialistSoul(trimmed, job),
        });
        // Later calls in the same turn see it, so a name can't be taken twice.
        agents.push(agent);
        return { created: { name: agent.name, handle: `@${agentSlug(agent.name)}` } };
      },
    }),
  };
}
