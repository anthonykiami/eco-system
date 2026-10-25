import { getAgentByTelegramBotId, updateAgent } from "@/lib/db/queries";
import type { Agent } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { asBot, callTelegram, TelegramApiError } from "./api";
import { botWebhookSecret, decryptToken, encryptToken } from "./secret-box";

/**
 * Agents' own Telegram bots. The user makes a bot in @BotFather and pastes its token on the web;
 * from then on that bot's private chat is that agent, and it speaks for the agent in the user's
 * group. The shared bot (TELEGRAM_BOT_TOKEN) stays the main agent's.
 */

/** The commands an agent's own bot offers: the main bot's, minus switching between agents. */
const AGENT_BOT_COMMANDS = [
  { command: "new", description: "Start a fresh conversation" },
  { command: "tasks", description: "Your scheduled tasks" },
  { command: "newtask", description: "Schedule a task" },
  { command: "connections", description: "Connected accounts" },
  { command: "usage", description: "This month's usage" },
  { command: "help", description: "What I can do" },
  { command: "cancel", description: "Stop what you're doing" },
];

export class BotSetupError extends Error {
  constructor(readonly reason: "format" | "invalid" | "main" | "taken") {
    super(`Bot setup failed: ${reason}`);
    this.name = "BotSetupError";
  }
}

const TOKEN_FORMAT = /^(\d{5,15}):[A-Za-z0-9_-]{30,}$/;

/** The main bot's numeric id, from its token. */
const mainBotId = () => env.TELEGRAM_BOT_TOKEN.split(":")[0];

export const agentBotWebhookUrl = (botId: string) => new URL(`/api/telegram/bot/${botId}`, env.APP_URL).toString();

/** The agent's decrypted bot token, or undefined if it has no bot (or the token can't be read). */
export function agentBotToken(agent: Pick<Agent, "id" | "telegramBotToken">): string | undefined {
  if (!agent.telegramBotToken) return undefined;
  try {
    return decryptToken(agent.telegramBotToken);
  } catch (err) {
    console.error(`[telegram] couldn't read the bot token of agent ${agent.id}`, err);
    return undefined;
  }
}

/**
 * Checks a pasted token with Telegram, points the bot's webhook at this app, names it after the
 * agent and stores it (encrypted) on the agent. Throws BotSetupError for a bad, foreign or main token.
 */
export async function connectAgentBot(userId: string, agent: Agent, rawToken: string): Promise<Agent> {
  const token = rawToken.trim();
  const match = TOKEN_FORMAT.exec(token);
  if (!match) throw new BotSetupError("format");
  const botId = match[1];
  if (botId === mainBotId()) throw new BotSetupError("main");
  const owner = await getAgentByTelegramBotId(botId);
  if (owner && owner.id !== agent.id) throw new BotSetupError("taken");

  return asBot(token, async () => {
    let me: { id: number; username?: string; is_bot?: boolean };
    try {
      me = await callTelegram("getMe", {});
    } catch (err) {
      if (err instanceof TelegramApiError) throw new BotSetupError("invalid");
      throw err;
    }
    if (!me.is_bot || String(me.id) !== botId || !me.username) throw new BotSetupError("invalid");

    await callTelegram("setWebhook", {
      url: agentBotWebhookUrl(botId),
      secret_token: botWebhookSecret(botId),
      allowed_updates: ["message", "callback_query"],
    });
    await callTelegram("setMyCommands", { commands: AGENT_BOT_COMMANDS });
    await nameAgentBot(agent);

    const updated = await updateAgent(userId, agent.id, {
      telegramBotId: botId,
      telegramBotUsername: me.username,
      telegramBotToken: encryptToken(token),
    });
    if (!updated) throw new BotSetupError("invalid");
    return updated;
  });
}

/** Names the bot after the agent and describes its job. Best effort: Telegram rate-limits renames. */
async function nameAgentBot(agent: Pick<Agent, "name" | "description">): Promise<void> {
  try {
    await callTelegram("setMyName", { name: agent.name.slice(0, 64) });
    if (agent.description) {
      await callTelegram("setMyShortDescription", { short_description: agent.description.slice(0, 120) });
    }
  } catch (err) {
    console.error("[telegram] couldn't name an agent bot", err);
  }
}

/** Keeps the bot's name and description in step with the agent's. */
export async function renameAgentBot(agent: Agent): Promise<void> {
  const token = agentBotToken(agent);
  if (token) await asBot(token, () => nameAgentBot(agent));
}

/** Stops the bot sending updates here and forgets it. The bot itself stays in the user's BotFather. */
export async function disconnectAgentBot(userId: string, agent: Agent): Promise<void> {
  const token = agentBotToken(agent);
  if (token) {
    await asBot(token, () => callTelegram("deleteWebhook", {})).catch((err: unknown) =>
      console.error(`[telegram] couldn't remove the webhook of agent ${agent.id}'s bot`, err),
    );
  }
  await updateAgent(userId, agent.id, { telegramBotId: null, telegramBotUsername: null, telegramBotToken: null });
}
