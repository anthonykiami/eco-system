import { redis } from "@/lib/upstash";
import { executeForAccount, listConnectedAccounts, type ConnectedAccount } from "./composio";

/**
 * The dashboard's "Today" view: today's and tomorrow's calendar events and recent unread email,
 * read straight from every connected Google account (not through the agent). Cached briefly so
 * reloading the dashboard doesn't call Google every time.
 */

export type TodayEvent = {
  title: string;
  /** ISO timestamp, or YYYY-MM-DD for an all-day event. */
  start: string;
  end?: string;
  allDay: boolean;
  /** Local YYYY-MM-DD the event falls on, for grouping into today and tomorrow. */
  day: string;
  calendar?: string;
  url?: string;
  /** The connected account's email, when the user has several. */
  account?: string;
};

export type TodayEmail = {
  from: string;
  subject: string;
  at: string;
  url?: string;
  account?: string;
};

export type Today = {
  /** Local YYYY-MM-DD of today and tomorrow in the user's timezone. */
  today: string;
  tomorrow: string;
  events: TodayEvent[];
  emails: TodayEmail[];
  calendarConnected: boolean;
  gmailConnected: boolean;
  /** Accounts that couldn't be read, by email or toolkit name. */
  failed: string[];
};

const CACHE_SECONDS = 120;
const cacheKey = (userId: string) => `today:v2:${userId}`;
const MAX_EMAILS = 8;
/** Unread inbox mail from the last two days: what's likely to still need attention. */
const EMAIL_QUERY = "is:unread in:inbox newer_than:2d";

export const localDate = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

/** How far `timeZone` is ahead of UTC at `date`, in ms. */
function offsetMs(date: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, Number(p.value)]),
  );
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return wall - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant local midnight starts on `day` (YYYY-MM-DD) in `timeZone`. */
export function startOfLocalDay(day: string, timeZone: string): Date {
  const guess = new Date(`${day}T00:00:00Z`);
  return new Date(guess.getTime() - offsetMs(guess, timeZone));
}

/**
 * Makes a Google link open in the account it came from. Without this, Google uses whichever
 * account is signed in first in the browser, which may not be the connected one.
 */
export function inGoogleAccount(url: string | undefined, email: string | undefined): string | undefined {
  if (!url || !email) return url;
  try {
    const link = new URL(url);
    if (link.hostname === "mail.google.com" && /\/mail\/u\/[^/]+/.test(link.pathname)) {
      link.pathname = link.pathname.replace(/\/mail\/u\/[^/]+/, `/mail/u/${email}`);
    } else {
      link.searchParams.set("authuser", email);
    }
    return link.toString();
  } catch {
    return url;
  }
}

/** "Jane Doe <jane@x.com>" → "Jane Doe"; a bare address stays as is. */
export function senderName(sender: string): string {
  const match = /^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/.exec(sender);
  return (match?.[1] ?? sender).trim();
}

type SummaryEvent = { title?: string; start?: string; end?: string; is_all_day?: boolean; calendar?: string; display_url?: string };
type Message = { sender?: string; subject?: string; messageTimestamp?: string; display_url?: string };

async function readCalendar(userId: string, account: ConnectedAccount, from: Date, to: Date, timeZone: string, label?: string) {
  const result = await executeForAccount(userId, "GOOGLECALENDAR", account.id, "GOOGLECALENDAR_EVENTS_LIST_ALL_CALENDARS", {
    time_min: from.toISOString(),
    time_max: to.toISOString(),
    single_events: true,
  });
  if (result.successful === false) throw new Error(String(result.error ?? "calendar read failed"));
  const events = (result.data?.summary_view as SummaryEvent[] | undefined) ?? [];
  return events.flatMap((e): TodayEvent[] => {
    if (!e.start) return [];
    const allDay = Boolean(e.is_all_day);
    return [
      {
        title: e.title?.trim() || "(No title)",
        start: e.start,
        end: e.end,
        allDay,
        day: allDay ? e.start.slice(0, 10) : localDate(new Date(e.start), timeZone),
        calendar: e.calendar,
        url: inGoogleAccount(e.display_url, account.email),
        account: label,
      },
    ];
  });
}

async function readInbox(userId: string, account: ConnectedAccount, label?: string) {
  const result = await executeForAccount(userId, "GMAIL", account.id, "GMAIL_FETCH_EMAILS", {
    query: EMAIL_QUERY,
    max_results: MAX_EMAILS,
    include_payload: false,
    verbose: false,
  });
  if (result.successful === false) throw new Error(String(result.error ?? "gmail read failed"));
  const messages = (result.data?.messages as Message[] | undefined) ?? [];
  return messages.map(
    (m): TodayEmail => ({
      from: senderName(m.sender ?? "Unknown sender"),
      subject: m.subject?.trim() || "(No subject)",
      at: m.messageTimestamp ?? new Date(0).toISOString(),
      url: inGoogleAccount(m.display_url, account.email),
      account: label,
    }),
  );
}

/** Today's and tomorrow's events and recent unread mail across the user's connected accounts. */
export async function loadToday(userId: string, timeZone: string, now = new Date()): Promise<Today> {
  const cached = await redis.get<Today>(cacheKey(userId)).catch(() => null);
  const today = localDate(now, timeZone);
  if (cached && cached.today === today) return cached;

  const tomorrow = localDate(new Date(startOfLocalDay(today, timeZone).getTime() + 36 * 3_600_000), timeZone);
  const from = startOfLocalDay(today, timeZone);
  const to = startOfLocalDay(localDate(new Date(from.getTime() + 60 * 3_600_000), timeZone), timeZone);

  const accounts = await listConnectedAccounts(userId);
  const calendars = accounts.get("GOOGLECALENDAR") ?? [];
  const inboxes = accounts.get("GMAIL") ?? [];
  // Name the account on each item only when there's more than one to tell apart.
  const labelOf = (list: ConnectedAccount[], a: ConnectedAccount, i: number) =>
    list.length > 1 ? (a.email ?? `account ${i + 1}`) : undefined;

  const failed: string[] = [];
  const settle = async <T>(work: Promise<T[]>, name: string): Promise<T[]> => {
    try {
      return await work;
    } catch (err) {
      console.error(`[today] couldn't read ${name} for user ${userId}`, err);
      failed.push(name);
      return [];
    }
  };

  const [events, emails] = await Promise.all([
    Promise.all(
      calendars.map((a, i) =>
        settle(readCalendar(userId, a, from, to, timeZone, labelOf(calendars, a, i)), a.email ?? "Google Calendar"),
      ),
    ),
    Promise.all(inboxes.map((a, i) => settle(readInbox(userId, a, labelOf(inboxes, a, i)), a.email ?? "Gmail"))),
  ]);

  const result: Today = {
    today,
    tomorrow,
    events: events
      .flat()
      .filter((e) => e.day === today || e.day === tomorrow)
      // All-day first, then by start time.
      .sort((a, b) => Number(b.allDay) - Number(a.allDay) || new Date(a.start).getTime() - new Date(b.start).getTime()),
    emails: emails
      .flat()
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, MAX_EMAILS),
    calendarConnected: calendars.length > 0,
    gmailConnected: inboxes.length > 0,
    failed,
  };
  if (failed.length === 0) await redis.set(cacheKey(userId), result, { ex: CACHE_SECONDS }).catch(() => {});
  return result;
}

/** Forget the cached view, e.g. after the user asks for a refresh. */
export async function clearTodayCache(userId: string): Promise<void> {
  await redis.del(cacheKey(userId));
}
