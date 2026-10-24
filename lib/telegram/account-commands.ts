import { listToolkitConnections, type ToolkitConnection } from "@/lib/agents/composio";
import { PLAN_LIMITS, resolvePlan } from "@/lib/agents/limits";
import { currentMonth, getUsage, updateUser } from "@/lib/db/queries";
import { rescheduleUserJobs } from "@/lib/heartbeat";
import { sendHtml } from "./api";
import type { BotContext } from "./conversation";
import { escapeHtml } from "./format";
import * as msg from "./messages";
import { resolveTimezone } from "./time";

/** Composio connection statuses, in words. No status means the user never started connecting. */
function connectionState(c: ToolkitConnection): string {
  switch (c.status) {
    case undefined:
      return "⚪️ not connected";
    case "ACTIVE": {
      const level = c.access.find((a) => a.id === c.currentAccess);
      return `✅ connected${level ? ` · ${escapeHtml(level.label.toLowerCase())}` : ""}`;
    }
    case "INITIATED":
    case "INITIALIZING":
      return "⏳ connection not finished";
    default:
      return "⚠️ needs reconnecting";
  }
}

/**
 * /connections. Connecting accounts and choosing what the agent may do with them happens on the
 * web (it needs Google's consent screen), so this shows status and links there.
 */
export async function showConnections(c: BotContext): Promise<void> {
  const connections = await listToolkitConnections(c.user.id);
  const lines = connections.map((conn) => `<b>${escapeHtml(conn.name)}</b>: ${connectionState(conn)}`);
  return sendHtml(
    c.chatId,
    [
      "<b>Connected accounts</b>",
      "",
      ...lines,
      "",
      `Connect accounts and choose what your agents may do with them in <a href="${msg.connectionsUrl()}">Settings → Integrations</a>.`,
    ].join("\n"),
  );
}

/** /timezone [zone]. Changing it moves scheduled tasks so "07:00" stays 07:00 local time. */
export async function timezone(c: BotContext, input: string): Promise<void> {
  if (!input) {
    return sendHtml(
      c.chatId,
      `Your timezone is <b>${escapeHtml(c.user.timezone)}</b>. To change it, send /timezone with a zone, like <code>/timezone America/Chicago</code> or <code>/timezone Europe/London</code>.`,
    );
  }
  const zone = resolveTimezone(input);
  if (!zone) {
    return sendHtml(
      c.chatId,
      `I don't know the timezone “${escapeHtml(input)}”. Use a zone name like <code>America/Los_Angeles</code>, <code>Europe/Paris</code> or <code>Asia/Tokyo</code>.`,
    );
  }
  await updateUser(c.user.id, { timezone: zone });
  await rescheduleUserJobs(c.user.id);
  return sendHtml(c.chatId, `✅ Timezone set to <b>${escapeHtml(zone)}</b>. Scheduled tasks now follow it.`);
}

/** /usage: this month's tokens against the plan's allowance. */
export async function usage(c: BotContext): Promise<void> {
  const row = await getUsage(c.user.id, currentMonth());
  const limit = PLAN_LIMITS[resolvePlan(c.user.plan)].monthlyTokens;
  const used = (row?.inputTokens ?? 0) + (row?.outputTokens ?? 0);
  const percent = Math.min(100, Math.round((used / limit) * 100));
  const fmt = (n: number) => n.toLocaleString("en-US");
  return sendHtml(
    c.chatId,
    [
      "<b>Usage this month</b>",
      `${percent}% of your allowance: ${fmt(used)} of ${fmt(limit)} tokens, across ${fmt(row?.messageCount ?? 0)} messages.`,
      "The allowance resets on the 1st (UTC).",
    ].join("\n"),
  );
}
