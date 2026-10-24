import { redis } from "@/lib/upstash";
import { callTelegram } from "./api";

/** The "/" menu Telegram shows in the chat. Bump COMMANDS_VERSION whenever this list changes. */
export const BOT_COMMANDS = [
  { command: "agents", description: "Your agents" },
  { command: "talk", description: "Talk to one agent" },
  { command: "main", description: "Back to your main agent" },
  { command: "new", description: "Start a fresh conversation" },
  { command: "newagent", description: "Create an agent" },
  { command: "tasks", description: "Your scheduled tasks" },
  { command: "newtask", description: "Schedule a task" },
  { command: "briefing", description: "Get a morning briefing" },
  { command: "connections", description: "Connected accounts" },
  { command: "timezone", description: "Check or change your timezone" },
  { command: "usage", description: "This month's usage" },
  { command: "help", description: "What I can do" },
  { command: "cancel", description: "Stop what you're doing" },
] as const;

const COMMANDS_VERSION = 1;
const commandsKey = `tg:commands:v${COMMANDS_VERSION}`;

/**
 * Registers the command menu with Telegram once per version, from whichever webhook call gets
 * there first, so a deploy that changes the list needs no manual step. Never throws.
 */
export async function ensureBotCommands(): Promise<void> {
  try {
    if ((await redis.set(commandsKey, 1, { nx: true })) === null) return;
    try {
      await callTelegram("setMyCommands", { commands: BOT_COMMANDS });
    } catch (err) {
      await redis.del(commandsKey);
      throw err;
    }
  } catch (err) {
    console.error("[telegram] failed to register bot commands", err);
  }
}
