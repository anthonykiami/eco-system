import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { env } from "@/lib/env";
import { handleUpdate } from "@/lib/telegram/handle-update";
import { telegramUpdateSchema } from "@/lib/telegram/types";
import { redis } from "@/lib/upstash";

// Covers the agent turn that runs in after(), which may take up to 240s (lib/agents/primary).
export const maxDuration = 300;

const DEDUPE_TTL_SECONDS = 24 * 60 * 60;

function isValidSecret(header: string | null): boolean {
  if (!header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(env.TELEGRAM_WEBHOOK_SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Public route: authenticated by the secret token Telegram sends on every webhook call.
 * Always answers 200 quickly (Telegram retries anything else) and does the work in after().
 */
export async function POST(request: Request) {
  if (!isValidSecret(request.headers.get("x-telegram-bot-api-secret-token"))) {
    return new Response("Unauthorized", { status: 401 });
  }

  // A payload we can't parse is still answered 200, or Telegram retries it forever.
  const parsed = telegramUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("OK");
  const update = parsed.data;

  // Telegram redelivers updates it thinks failed; only the first delivery does any work.
  const first = await redis.set(`tg:update:${update.update_id}`, 1, {
    nx: true,
    ex: DEDUPE_TTL_SECONDS,
  });
  if (first === null) return new Response("OK");

  after(() => handleUpdate(update));
  return new Response("OK");
}
