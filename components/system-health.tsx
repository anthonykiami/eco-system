import { env } from "@/lib/env";
import { adminListUsers } from "@/lib/db/queries/admin";
import { callTelegram } from "@/lib/telegram/api";
import { topicsEnabled } from "@/lib/telegram/topics";
import { redis } from "@/lib/upstash";
import { formatAgo } from "./format";
import { Status } from "./ui";

/**
 * Admin-only: whether the moving parts are healthy. Only render this after requireAdmin() or for a
 * session with isAdmin, since it reads every user.
 */

type Check = { name: string; tone: "success" | "warning" | "danger"; detail: string };

type WebhookInfo = {
  url: string;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
  allowed_updates?: string[];
};

/** An error older than this is history, not a current problem. */
const RECENT_ERROR_MS = 60 * 60 * 1000;

async function telegramCheck(): Promise<Check> {
  try {
    const info = await callTelegram<WebhookInfo>("getWebhookInfo", {});
    const expected = new URL("/api/telegram", env.APP_URL).toString();
    if (info.url !== expected) {
      return { name: "Telegram webhook", tone: "danger", detail: `Points to ${info.url || "nothing"}, not this app.` };
    }
    if (!info.allowed_updates?.includes("callback_query")) {
      return { name: "Telegram webhook", tone: "warning", detail: "Buttons are off: run scripts/set-webhook.ts again." };
    }
    const lastError = info.last_error_date ? new Date(info.last_error_date * 1000) : undefined;
    if (lastError && Date.now() - lastError.getTime() < RECENT_ERROR_MS) {
      return {
        name: "Telegram webhook",
        tone: "danger",
        detail: `Failing ${formatAgo(lastError)}: ${info.last_error_message ?? "unknown error"}`,
      };
    }
    if (info.pending_update_count > 5) {
      return { name: "Telegram webhook", tone: "warning", detail: `${info.pending_update_count} messages waiting.` };
    }
    return {
      name: "Telegram webhook",
      tone: "success",
      detail: lastError ? `Working. Last error ${formatAgo(lastError)}.` : "Working, no errors.",
    };
  } catch (err) {
    return { name: "Telegram webhook", tone: "danger", detail: `Couldn't ask Telegram: ${String(err)}` };
  }
}

async function topicsCheck(): Promise<Check> {
  return (await topicsEnabled())
    ? { name: "Agent topics", tone: "success", detail: "Threaded Mode is on: agents get topics, replies stream." }
    : { name: "Agent topics", tone: "warning", detail: "Threaded Mode is off in BotFather: one chat, no streaming." };
}

async function redisCheck(): Promise<Check> {
  const started = Date.now();
  try {
    await redis.ping();
    return { name: "Redis", tone: "success", detail: `Reachable (${Date.now() - started} ms).` };
  } catch (err) {
    return {
      name: "Redis",
      tone: "danger",
      detail: `Unreachable, so the bot can't answer. Free Upstash databases are deleted after 14 idle days. ${String(err)}`,
    };
  }
}

function voiceCheck(): Check {
  return env.GROQ_API_KEY
    ? { name: "Voice messages", tone: "success", detail: "Groq transcription is configured." }
    : { name: "Voice messages", tone: "warning", detail: "GROQ_API_KEY isn't set: voice messages are refused." };
}

export async function SystemHealth() {
  const [checks, users] = await Promise.all([
    Promise.all([telegramCheck(), topicsCheck(), redisCheck(), Promise.resolve(voiceCheck())]),
    adminListUsers(),
  ]);
  const waitlist = users.filter((u) => u.status === "waitlist").length;

  return (
    <ul className="flex flex-col divide-y divide-line">
      {checks.map((check) => (
        <li key={check.name} className="flex flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0">
          <Status tone={check.tone}>{check.name}</Status>
          <p className="pl-4 text-xs text-muted">{check.detail}</p>
        </li>
      ))}
      <li className="flex flex-col gap-0.5 py-2.5 last:pb-0">
        <Status tone={waitlist > 0 ? "warning" : "success"}>Users</Status>
        <p className="pl-4 text-xs text-muted">
          {users.length - waitlist} active · {waitlist} waiting for access
        </p>
      </li>
    </ul>
  );
}
