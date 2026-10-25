/** Date and number formatting for the web pages, always in the user's own timezone. */

const dayKey = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

/** "Today 7:30 AM", "Tomorrow 9:00 AM", "Sat, Oct 25, 3:00 PM". */
export function formatWhen(date: Date, timeZone: string, now = new Date()): string {
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(date);
  const day = dayKey(date, timeZone);
  if (day === dayKey(now, timeZone)) return `Today ${time}`;
  if (day === dayKey(new Date(now.getTime() + 86_400_000), timeZone)) return `Tomorrow ${time}`;
  if (day === dayKey(new Date(now.getTime() - 86_400_000), timeZone)) return `Yesterday ${time}`;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function formatAgo(date: Date, now = new Date()): string {
  const minutes = Math.round((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** "Good morning" etc. by the hour where the user is. */
export function greeting(timeZone: string, now = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now));
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export const formatNumber = (n: number) => n.toLocaleString("en-US");

/** 1234567 → "1.2M", 45200 → "45.2K". */
export function formatCompact(n: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** First line of a message, shortened, without markdown symbols. */
export function preview(text: string, max = 110): string {
  const line = text.replace(/[*_`#>]/g, "").split("\n").find((l) => l.trim()) ?? "";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line.trim();
}
