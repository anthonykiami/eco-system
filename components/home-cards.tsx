import Link from "next/link";
import { loadToday } from "@/lib/agents/today";

/** "Today's Focus": how much of today's calendar is behind you, with each event ticked off as it passes. */
export async function FocusCard({ userId, timeZone }: { userId: string; timeZone: string }) {
  const now = new Date();
  const today = await loadToday(userId, timeZone, now);
  const events = today.events.filter((e) => e.day === today.today);
  const done = events.filter((e) => !e.allDay && new Date(e.end ?? e.start) <= now).length;
  const percent = events.length === 0 ? 0 : Math.round((done / events.length) * 100);
  const time = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));

  const R = 46;
  const C = 2 * Math.PI * R;
  return (
    <div className="flex items-center gap-5">
      <div className="relative h-32 w-32 shrink-0">
        <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden>
          <circle cx="60" cy="60" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="9" />
          <circle
            cx="60"
            cy="60"
            r={R}
            fill="none"
            stroke="url(#focus-ring)"
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={`${(percent / 100) * C} ${C}`}
            style={{ filter: "drop-shadow(0 0 6px rgba(94,230,168,0.6))" }}
          />
          <defs>
            <linearGradient id="focus-ring" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="#5ee6a8" />
              <stop offset="100%" stopColor="#4fd8e8" />
            </linearGradient>
          </defs>
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-light tabular-nums">{percent}%</span>
          <span className="text-[10px] text-muted">of today</span>
        </span>
      </div>
      {today.unavailable ? (
        <p className="text-sm text-muted">Your calendar can&apos;t be reached right now.</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-muted">
          {today.calendarConnected ? "Nothing on the calendar today. A clear day." : (
            <>
              <Link href="/settings/integrations" className="underline">Connect Google Calendar</Link> to see your day.
            </>
          )}
        </p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-2.5">
          {events.slice(0, 5).map((e, i) => {
            const past = !e.allDay && new Date(e.end ?? e.start) <= now;
            return (
              <li key={i} className="flex items-center gap-2.5 text-sm">
                <span
                  className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border ${
                    past ? "border-accent bg-accent text-accent-foreground" : "border-white/30"
                  }`}
                  aria-hidden
                >
                  {past && <span className="text-[11px] leading-none">✓</span>}
                </span>
                <span className={`truncate ${past ? "text-muted" : ""}`}>{e.title}</span>
                <span className="ml-auto shrink-0 pl-2 text-xs text-muted">{e.allDay ? "All day" : time(e.start)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
