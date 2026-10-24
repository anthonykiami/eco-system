/** Presets and helpers for the scheduled-tasks settings page. */

export const BRIEFING_PROMPT = `Write my morning briefing for today. I'll read it on my phone, so keep it to about a minute of reading.

1. Calendar: today's events in order, with times. Flag conflicts, early starts, travel, and anything I need to prepare for.
2. Email: messages from the last 24 hours that need a reply or action from me. Skip newsletters, promotions and automated notifications.
3. Reminders: deadlines or commitments for today that you know about from earlier conversations.
4. If you can search the web: today's weather where I am, if you know where that is.

If you can't access my calendar or email, say so in one line and skip that section. Never guess at events or messages.
Use short headings and bullet points. If a section has nothing, write "Nothing today."`;

export type DayPreset = "daily" | "weekdays";

export const DAY_PRESETS: Record<DayPreset, { label: string; cronDays: string }> = {
  daily: { label: "Every day", cronDays: "*" },
  weekdays: { label: "Weekdays", cronDays: "1-5" },
};

/** "07:30" + "weekdays" → "30 7 * * 1-5". Returns undefined for a malformed time. */
export function dailyCron(time: string, days: DayPreset): string | undefined {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) return undefined;
  return `${Number(match[2])} ${Number(match[1])} * * ${DAY_PRESETS[days].cronDays}`;
}

/** Human-readable form of crons made by dailyCron; anything else is shown as-is. */
export function describeCron(cron: string): string {
  const match = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5)$/.exec(cron);
  if (!match) return cron;
  const time = `${match[2].padStart(2, "0")}:${match[1].padStart(2, "0")}`;
  return `${match[3] === "*" ? "Every day" : "Weekdays"} at ${time}`;
}

/** Briefing prompt, with the user's own additions appended. */
export function briefingPrompt(extra: string): string {
  const trimmed = extra.trim();
  return trimmed ? `${BRIEFING_PROMPT}\n\nAlso: ${trimmed}` : BRIEFING_PROMPT;
}
