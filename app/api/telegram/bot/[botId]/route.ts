import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { getAgentByTelegramBotId } from "@/lib/db/queries";
import { agentBotToken } from "@/lib/telegram/agent-bots";
import { asBot } from "@/lib/telegram/api";
import { handleUpdate } from "@/lib/telegram/handle-update";
import { botWebhookSecret } from "@/lib/telegram/secret-box";
import { telegramUpdateSchema } from "@/lib/telegram/types";
import { redis } from "@/lib/upstash";

// Covers the agent turn that runs in after(), which may take up to 240s (lib/agents/primary).
export const maxDuration = 300;

const DEDUPE_TTL_SECONDS = 24 * 60 * 60;

function isValidSecret(header: string | null, botId: string): boolean {
  if (!header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(botWebhookSecret(botId));
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Public route for agents' own bots: one webhook per bot, authenticated by a secret derived from
 * the bot id. The update is handled exactly like the main bot's, but as that bot and that agent.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/telegram/bot/[botId]">) {
  const { botId } = await ctx.params;
  if (!/^\d{5,15}$/.test(botId) || !isValidSecret(request.headers.get("x-telegram-bot-api-secret-token"), botId)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const parsed = telegramUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("OK");
  const update = parsed.data;

  // Update ids are per bot, so the dedupe key carries the bot id.
  const first = await redis.set(`tg:update:${botId}:${update.update_id}`, 1, { nx: true, ex: DEDUPE_TTL_SECONDS });
  if (first === null) return new Response("OK");

  const agent = await getAgentByTelegramBotId(botId);
  const token = agent && agentBotToken(agent);
  // A bot that was disconnected from its agent: nothing to answer as.
  if (!agent || !token) return new Response("OK");

  after(() => asBot(token, () => handleUpdate(update, { agent })));
  return new Response("OK");
}
