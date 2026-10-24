import {
  buildSpecialistSoul,
  checkAgentName,
  MAX_AGENT_DESCRIPTION_LENGTH,
  MAX_SPECIALISTS,
} from "@/lib/agents/naming";
import { createAgent, deleteAgent, getAgent, updateAgent } from "@/lib/db/queries";
import type { Agent } from "@/lib/db/schema";
import { editHtml, sendHtml } from "./api";
import { activeAgent, loadAgents, type BotContext } from "./context";
import { switchTo } from "./conversation";
import * as msg from "./messages";
import { clearFlow, getActiveAgentId, setActiveAgentId, setFlow, type Flow } from "./state";
import type { InlineKeyboard } from "./types";

const NEW_AGENT_BUTTON = { text: "➕ New agent", callback_data: "na" };

// ─── Views ──────────────────────────────────────────────────────────────────

async function listView(userId: string): Promise<{ html: string; keyboard: InlineKeyboard }> {
  const agents = await loadAgents(userId);
  const current = await activeAgent(userId, agents);
  const rows = agents.length > 1 ? agents.map((a) => [{ text: a.name, callback_data: `a:${a.id}` }]) : [];
  return {
    html: msg.agentList(agents, current.id),
    keyboard: { inline_keyboard: [...rows, [NEW_AGENT_BUTTON]] },
  };
}

function cardKeyboard(agent: Agent): InlineKeyboard {
  const id = agent.id;
  return {
    inline_keyboard: [
      [{ text: "💬 Talk to it", callback_data: `at:${id}` }],
      agent.role === "primary"
        ? [{ text: "✏️ Rename", callback_data: `ar:${id}` }]
        : [
            { text: "✏️ Rename", callback_data: `ar:${id}` },
            { text: "📝 Change its job", callback_data: `ad:${id}` },
          ],
      ...(agent.role === "primary" ? [] : [[{ text: "🗑 Delete", callback_data: `ax:${id}` }]]),
      [{ text: "« All agents", callback_data: "al" }],
    ],
  };
}

/** /agents */
export async function showAgents(c: BotContext): Promise<void> {
  const { html, keyboard } = await listView(c.user.id);
  return sendHtml(c.chatId, html, { keyboard });
}

// ─── Buttons ────────────────────────────────────────────────────────────────

/** Handles agent-related button taps. Returns false if `action` isn't one of them. */
export async function handleAgentButton(
  c: BotContext,
  action: string,
  arg: string,
  messageId: number,
): Promise<boolean> {
  if (action === "al") {
    const { html, keyboard } = await listView(c.user.id);
    await editHtml(c.chatId, messageId, html, { keyboard });
    return true;
  }
  if (action === "na") {
    await startNewAgent(c);
    return true;
  }
  if (!["a", "at", "ar", "ad", "ax", "ay"].includes(action)) return false;

  // Every id from a button is re-checked against this user's agents.
  const agent = await getAgent(c.user.id, arg);
  if (!agent) {
    await sendHtml(c.chatId, msg.STALE_BUTTON);
    return true;
  }

  switch (action) {
    case "a":
      await editHtml(c.chatId, messageId, msg.agentCard(agent), { keyboard: cardKeyboard(agent) });
      break;
    case "at":
      await switchTo(c, agent);
      break;
    case "ar":
      await setFlow(c.user.id, { kind: "rename_agent", agentId: agent.id });
      await sendHtml(c.chatId, msg.askRename(agent));
      break;
    case "ad":
      if (agent.role === "primary") break;
      await setFlow(c.user.id, { kind: "describe_agent", agentId: agent.id });
      await sendHtml(c.chatId, msg.askRedescribe(agent));
      break;
    case "ax":
      if (agent.role === "primary") break;
      await editHtml(c.chatId, messageId, msg.confirmDeleteAgent(agent), {
        keyboard: {
          inline_keyboard: [
            [
              { text: "Yes, delete", callback_data: `ay:${agent.id}` },
              { text: "Cancel", callback_data: `a:${agent.id}` },
            ],
          ],
        },
      });
      break;
    case "ay":
      if (agent.role === "primary") break;
      await deleteAgent(c.user.id, agent.id);
      if ((await getActiveAgentId(c.user.id)) === agent.id) await setActiveAgentId(c.user.id, undefined);
      await editHtml(c.chatId, messageId, msg.agentDeleted(agent.name));
      break;
  }
  return true;
}

// ─── Flows ──────────────────────────────────────────────────────────────────

/** /newagent [name] */
export async function startNewAgent(c: BotContext, name = ""): Promise<void> {
  const agents = await loadAgents(c.user.id);
  if (agents.length - 1 >= MAX_SPECIALISTS) return sendHtml(c.chatId, msg.tooManyAgents(MAX_SPECIALISTS));
  const flow: Flow = { kind: "new_agent", step: "name" };
  // Saved first, so a rejected name leaves the user at the name step rather than nowhere.
  await setFlow(c.user.id, flow);
  if (name) return continueAgentFlow(c, flow, name);
  return sendHtml(c.chatId, msg.ASK_AGENT_NAME);
}

/** An error message if `name` can't be used, ignoring the agent being renamed. */
function nameProblem(name: string, agents: Agent[], renamingId?: string): string | undefined {
  const check = checkAgentName(name, agents, renamingId);
  if (check.ok) return undefined;
  if (check.reason === "taken") return msg.nameTaken(check.agent);
  return check.reason === "reserved" ? msg.NAME_RESERVED : msg.NAME_INVALID;
}

type AgentFlow = Extract<Flow, { kind: "new_agent" | "rename_agent" | "describe_agent" }>;

export async function continueAgentFlow(c: BotContext, flow: AgentFlow, text: string): Promise<void> {
  const userId = c.user.id;
  const agents = await loadAgents(userId);

  if (flow.kind === "new_agent" && flow.step === "name") {
    const problem = nameProblem(text, agents);
    if (problem) return sendHtml(c.chatId, problem);
    await setFlow(userId, { kind: "new_agent", step: "description", name: text });
    return sendHtml(c.chatId, msg.askAgentDescription(text));
  }

  if (flow.kind === "new_agent") {
    if (text.length > MAX_AGENT_DESCRIPTION_LENGTH) return sendHtml(c.chatId, msg.DESCRIPTION_INVALID);
    // Checked again: the main agent may have created agents while this flow was open.
    if (agents.length - 1 >= MAX_SPECIALISTS) {
      await clearFlow(userId);
      return sendHtml(c.chatId, msg.tooManyAgents(MAX_SPECIALISTS));
    }
    const problem = nameProblem(flow.name, agents);
    if (problem) {
      await setFlow(userId, { kind: "new_agent", step: "name" });
      return sendHtml(c.chatId, problem);
    }
    const agent = await createAgent(userId, {
      name: flow.name,
      description: text,
      soul: buildSpecialistSoul(flow.name, text),
    });
    await clearFlow(userId);
    return sendHtml(c.chatId, msg.agentCreated(agent), {
      keyboard: { inline_keyboard: [[{ text: `💬 Talk to ${agent.name}`, callback_data: `at:${agent.id}` }]] },
    });
  }

  const agent = agents.find((a) => a.id === flow.agentId);
  if (!agent) {
    await clearFlow(userId);
    return sendHtml(c.chatId, msg.STALE_BUTTON);
  }

  if (flow.kind === "rename_agent") {
    const problem = nameProblem(text, agents, agent.id);
    if (problem) return sendHtml(c.chatId, problem);
    // Instructions built from the old name are rebuilt; hand-written ones are left alone.
    const generated =
      agent.description !== null && agent.soul === buildSpecialistSoul(agent.name, agent.description);
    const updated = await updateAgent(userId, agent.id, {
      name: text,
      ...(generated ? { soul: buildSpecialistSoul(text, agent.description!) } : {}),
    });
    await clearFlow(userId);
    return sendHtml(c.chatId, msg.agentRenamed(updated ?? agent));
  }

  if (text.length > MAX_AGENT_DESCRIPTION_LENGTH) return sendHtml(c.chatId, msg.DESCRIPTION_INVALID);
  const updated = await updateAgent(userId, agent.id, {
    description: text,
    soul: buildSpecialistSoul(agent.name, text),
  });
  await clearFlow(userId);
  return sendHtml(c.chatId, msg.agentRedescribed(updated ?? agent));
}
