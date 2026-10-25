import Link from "next/link";
import { refreshToday } from "@/app/(app)/today-actions";
import { loadToday, type TodayEvent } from "@/lib/agents/today";
import { formatAgo } from "./format";
import { Badge, Button, EmptyState } from "./ui";

const timeOf = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));

function eventTime(e: TodayEvent, timeZone: string): string {
  if (e.allDay) return "All day";
  return e.end ? `${timeOf(e.start, timeZone)} – ${timeOf(e.end, timeZone)}` : timeOf(e.start, timeZone);
}

function EventRow({ event, timeZone, now }: { event: TodayEvent; timeZone: string; now: Date }) {
  const start = new Date(event.start);
  const end = event.end ? new Date(event.end) : start;
  const past = !event.allDay && end < now;
  const current = !event.allDay && start <= now && now < end;
  const body = (
    <span className={`flex items-start gap-3 ${past ? "opacity-50" : ""}`}>
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${current ? "bg-success" : "bg-accent"}`} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{event.title}</span>
          {current && <Badge tone="success">now</Badge>}
        </span>
        <span className="block text-xs text-muted">
          {eventTime(event, timeZone)}
          {event.calendar && ` · ${event.calendar}`}
          {event.account && ` · ${event.account}`}
        </span>
      </span>
    </span>
  );
  return (
    <li>
      {event.url ? (
        <a href={event.url} target="_blank" rel="noreferrer" className="-mx-2 block rounded-lg px-2 py-1.5 transition hover:bg-surface-muted">
          {body}
        </a>
      ) : (
        <div className="py-1.5">{body}</div>
      )}
    </li>
  );
}

function DayList({ label, events, timeZone, now }: { label: string; events: TodayEvent[]; timeZone: string; now: Date }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      {events.length === 0 ? (
        <p className="py-1.5 text-sm text-muted">Nothing on the calendar.</p>
      ) : (
        <ul className="flex flex-col">
          {events.map((e, i) => (
            <EventRow key={`${e.start}-${i}`} event={e} timeZone={timeZone} now={now} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Today's calendar and unread email, read live from the user's connected Google accounts. */
export async function TodayView({ userId, timeZone }: { userId: string; timeZone: string }) {
  const now = new Date();
  const today = await loadToday(userId, timeZone, now);
  if (today.unavailable) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Couldn&apos;t reach your Google accounts right now. The service that connects them is having trouble; your
          calendar and email will be back once it recovers.
        </p>
        <form action={refreshToday}>
          <Button type="submit" size="sm" variant="ghost">
            Try again
          </Button>
        </form>
      </div>
    );
  }
  const todays = today.events.filter((e) => e.day === today.today);
  const tomorrows = today.events.filter((e) => e.day === today.tomorrow);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-6 md:grid-cols-2">
        <section className="flex flex-col gap-3" aria-label="Calendar">
          <h3 className="text-sm font-semibold">Calendar</h3>
          {today.calendarConnected ? (
            <>
              <DayList label="Today" events={todays} timeZone={timeZone} now={now} />
              <DayList label="Tomorrow" events={tomorrows} timeZone={timeZone} now={now} />
            </>
          ) : (
            <EmptyState>
              <Link href="/settings/integrations" className="underline">
                Connect Google Calendar
              </Link>{" "}
              to see your day here.
            </EmptyState>
          )}
        </section>

        <section className="flex flex-col gap-3" aria-label="Unread email">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            Unread email
            {today.emails.length > 0 && <Badge tone="accent">{today.emails.length}</Badge>}
          </h3>
          {!today.gmailConnected ? (
            <EmptyState>
              <Link href="/settings/integrations" className="underline">
                Connect Gmail
              </Link>{" "}
              to see what&apos;s waiting.
            </EmptyState>
          ) : today.emails.length === 0 ? (
            <p className="text-sm text-muted">Inbox zero for the last two days. 🎉</p>
          ) : (
            <ul className="flex flex-col">
              {today.emails.map((m, i) => {
                const body = (
                  <>
                    <span className="flex items-center gap-2 text-sm">
                      <span className="truncate font-medium">{m.from}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted">{formatAgo(new Date(m.at), now)}</span>
                    </span>
                    <span className="block truncate text-sm text-muted">
                      {m.subject}
                      {m.account && ` · ${m.account}`}
                    </span>
                  </>
                );
                return (
                  <li key={`${m.at}-${i}`}>
                    {m.url ? (
                      <a href={m.url} target="_blank" rel="noreferrer" className="-mx-2 block rounded-lg px-2 py-1.5 transition hover:bg-surface-muted">
                        {body}
                      </a>
                    ) : (
                      <div className="py-1.5">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-xs text-muted">
        <span>
          {today.failed.length > 0
            ? `Couldn't read ${today.failed.join(", ")}. It may need reconnecting in Integrations.`
            : "Live from your Google accounts · refreshes every couple of minutes"}
        </span>
        <form action={refreshToday}>
          <Button type="submit" size="sm" variant="ghost">
            Refresh
          </Button>
        </form>
      </div>
    </div>
  );
}

export function TodaySkeleton() {
  return (
    <div className="grid gap-6 md:grid-cols-2" aria-busy="true" aria-label="Loading today">
      {[0, 1].map((col) => (
        <div key={col} className="flex flex-col gap-3">
          <div className="h-4 w-24 animate-pulse rounded bg-surface-muted" />
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-9 animate-pulse rounded-lg bg-surface-muted" />
          ))}
        </div>
      ))}
    </div>
  );
}
