import type { Agent } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { displayHandle } from "./agent-handles";
import { escapeHtml } from "./format";

/** User-facing bot replies (HTML parse mode). */

export const settingsUrl = () => `${env.APP_URL}/settings/telegram`;
export const connectionsUrl = () => `${env.APP_URL}/settings/integrations`;

/** The agent list shows the start of each description; the agent's card shows all of it. */
const LIST_DESCRIPTION_LENGTH = 120;
const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const name = (agent: Agent) => `<b>${escapeHtml(agent.name)}</b>`;
const handle = (agent: Agent) => `<code>@${displayHandle(agent)}</code>`;

export const LINK_INSTRUCTIONS = () =>
  [
    "Hi! This chat isn't linked to an account yet.",
    "",
    `1. Open <a href="${settingsUrl()}">Settings → Telegram</a> and click <b>Connect Telegram</b>.`,
    "2. Tap the link it gives you, or send <code>/link CODE</code> here.",
  ].join("\n");

export const LINK_USAGE = "Send <code>/link CODE</code> using the 6-character code from Settings → Telegram.";

export const LINK_INVALID_CODE =
  "That code is invalid or has expired. Codes work once and last 10 minutes. Generate a new one in Settings → Telegram.";

export const LINK_TOO_MANY_ATTEMPTS = "Too many linking attempts. Please wait a few minutes and try again.";

export const LINK_PRIVATE_ONLY = "For your privacy, accounts can only be linked in a private chat with the bot.";

export const LINK_CHAT_TAKEN =
  "This Telegram chat is already linked to another account. Unlink it from that account's settings first.";

export const LINK_ALREADY_LINKED = "This chat is already linked to your account. Just send me a message!";

export const LINK_SUCCESS =
  "✅ Your Telegram is now linked. Send me a message to get started, or /help to see everything I can do.";

export const WAITLIST =
  "You're on the waitlist. We're letting people in gradually and will email you as soon as your account is ready.";

export const NEW_CHAT = "🆕 Started a new conversation.";

export const TEXT_ONLY = "Sorry, I can only read text messages right now.";

export const GENERIC_ERROR = "Sorry, something went wrong. Please try again in a moment.";

export const CANCELLED = "OK, cancelled.";

export const NOTHING_TO_CANCEL = "Nothing to cancel.";

export const STALE_BUTTON = "That button has expired. Send the command again.";

export const HELP = [
  "<b>Talking to your agents</b>",
  "Just send a message: your main agent answers, and hands work to your other agents when it fits.",
  "<code>@name your message</code> sends one message straight to a specific agent. Replying to an agent's message does the same.",
  "/talk — keep talking to one agent · /main — back to the main agent",
  "/new — start a fresh conversation",
  "",
  "<b>Agents</b>",
  "/agents — see and change your agents · /newagent — create one",
  "",
  "<b>Scheduled tasks</b>",
  "/tasks — see, pause or run your tasks · /newtask — schedule one",
  "/briefing — get a morning briefing",
  "Or just ask: “remind me to call mom at 6pm”, “every Monday at 9, check my inbox”.",
  "",
  "<b>Account</b>",
  "/connections — your connected accounts (Gmail, Calendar…)",
  "/timezone — check or change your timezone · /usage — this month's usage",
  "/cancel — stop what you're in the middle of",
].join("\n");

// ─── Conversation ───────────────────────────────────────────────────────────

export const newChatWith = (agent: Agent) => `🆕 Started a new conversation with ${name(agent)}.`;

export const delegating = (from: string, to: string) =>
  `↪️ <i>${escapeHtml(from)} asked ${escapeHtml(to)} to help…</i>`;

export const switchedTo = (agent: Agent) =>
  agent.role === "primary"
    ? `You're talking to ${name(agent)}, your main agent. It hands work to your other agents when it fits.`
    : `You're now talking to ${name(agent)}. Messages go straight to it until you send /main.`;

export const pickAgent = (current: Agent) => `You're talking to ${name(current)}. Who do you want to talk to?`;

export const noSuchAgent = (query: string, agents: Agent[]) =>
  `You don't have an agent called “${escapeHtml(query)}”. Your agents: ${agents.map(handle).join(", ")}.`;

export const ambiguousAgent = (agents: Agent[]) =>
  `That matches more than one agent: ${agents.map(handle).join(", ")}. Which one?`;

// ─── Agents ─────────────────────────────────────────────────────────────────

export const agentList = (agents: Agent[], activeId: string) =>
  [
    "<b>Your agents</b>",
    "",
    ...agents.map((a) =>
      [
        `${name(a)} ${handle(a)}${a.role === "primary" ? " · main" : ""}${a.id === activeId ? " · <i>talking now</i>" : ""}`,
        a.description ? escapeHtml(truncate(a.description, LIST_DESCRIPTION_LENGTH)) : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
    ),
    "",
    agents.length > 1
      ? "Tap an agent to talk to it or change it."
      : "Create agents for specific jobs (research, travel, fitness…). Your main agent hands them work, and you can talk to them directly.",
  ].join("\n");

export const agentCard = (agent: Agent) =>
  [
    `${name(agent)} ${handle(agent)}${agent.role === "primary" ? " · main agent" : ""}`,
    agent.description ? `\n${escapeHtml(agent.description)}` : "",
  ].join("\n");

export const confirmDeleteAgent = (agent: Agent) =>
  `Delete ${name(agent)}? Its conversations and scheduled tasks are deleted with it.`;

export const agentDeleted = (agentName: string) => `🗑 Deleted <b>${escapeHtml(agentName)}</b>.`;

export const ASK_AGENT_NAME =
  "What should your new agent be called? For example: Researcher, Travel Planner, Coach.\n\n/cancel to stop.";

export const askAgentDescription = (agentName: string) =>
  `What should <b>${escapeHtml(agentName)}</b> do? Describe its job in a sentence or two. Your main agent reads this to decide when to hand it work.`;

export const askRename = (agent: Agent) => `Send a new name for ${name(agent)}.\n\n/cancel to stop.`;

export const askRedescribe = (agent: Agent) =>
  `Send a new description of what ${name(agent)} should do. This replaces its current instructions.\n\n/cancel to stop.`;

export const agentCreated = (agent: Agent) =>
  [
    `✅ Created ${name(agent)}.`,
    "",
    `• Send <code>@${displayHandle(agent)} your message</code> to ask it something directly.`,
    `• /talk ${displayHandle(agent)} to keep talking to it.`,
    "• Or just talk to your main agent: it hands work to this one when it fits.",
  ].join("\n");

export const agentRenamed = (agent: Agent) => `✅ Renamed. It's now ${name(agent)} (${handle(agent)}).`;

export const agentRedescribed = (agent: Agent) => `✅ Updated what ${name(agent)} does.`;

export const NAME_INVALID = "Names need 1 to 40 characters, with at least one letter or number. Try another.";

export const NAME_RESERVED = "“main” is reserved for your main agent. Try another name.";

export const nameTaken = (agent: Agent) => `You already have ${name(agent)}. Pick a different name.`;

export const DESCRIPTION_INVALID = "Please describe the job in 1 to 1,000 characters.";

export const tooManyAgents = (max: number) =>
  `You have the maximum of ${max} agents besides your main one. Delete one with /agents first.`;

// ─── Scheduled tasks ────────────────────────────────────────────────────────

export const ASK_TASK_PROMPT =
  "What should I do on a schedule? For example: “Summarize my unread email” or “Check flights from Boston to Lisbon under $500”.\n\n/cancel to stop.";

export const ASK_TASK_TIME = "What time? For example 7:30, 7am or 18:00. It uses your timezone (/timezone).";

export const TIME_INVALID = "I didn't understand that time. Try something like 7:30, 7am or 18:00.";

export const ASK_TASK_DAYS = "Which days?";

export const ASK_TASK_AGENT = "Which agent should do it?";

export const USE_BUTTONS = "Tap one of the buttons above, or /cancel.";

export const PROMPT_INVALID = "Please keep the task to 2,000 characters or fewer.";

export const NO_TASKS =
  "You don't have any scheduled tasks yet. /briefing sets up a morning briefing, and /newtask schedules anything else.";

export const TASK_QUEUED = "Queued. The result arrives here within a few minutes.";

export const TASK_PAUSED_CANT_RUN = "Resume the task before running it.";

export const TASK_TIME_PASSED = "Its time has already passed. Delete it, or ask for a new one.";
