/**
 * Parses the ways people type a time of day: "7", "7:30", "07:30", "7am", "7:30 pm", "19.30", "noon".
 * Returns 24-hour "HH:MM", or undefined if it isn't a valid time.
 */
export function parseTimeOfDay(input: string): string | undefined {
  const text = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (text === "noon") return "12:00";
  if (text === "midnight") return "00:00";

  const m = /^(\d{1,2})(?:[:.h](\d{2}))? ?(am|pm|a\.m\.|p\.m\.)?$/.exec(text);
  if (!m) return undefined;
  let hour = Number(m[1]);
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  const meridiem = m[3]?.replace(/\./g, "");
  if (minute > 59) return undefined;

  if (meridiem) {
    if (hour < 1 || hour > 12) return undefined;
    if (meridiem === "am" && hour === 12) hour = 0;
    if (meridiem === "pm" && hour !== 12) hour += 12;
  } else if (hour > 23) {
    return undefined;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** "Mon 7:30 AM" in the user's timezone. */
export function formatRunTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/**
 * Matches an IANA zone case-insensitively ("america/chicago" → "America/Chicago").
 * Aliases Intl accepts but doesn't list, like "UTC", are returned as typed.
 */
export function resolveTimezone(input: string): string | undefined {
  const value = input.trim().replace(/ /g, "_");
  if (!value) return undefined;
  const listed = Intl.supportedValuesOf("timeZone").find((z) => z.toLowerCase() === value.toLowerCase());
  if (listed) return listed;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return undefined;
  }
}
