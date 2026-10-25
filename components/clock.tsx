"use client";

import { useEffect, useState } from "react";

/** A live date and time in the user's timezone, as in the dashboard's corner widget. */
export function Clock({ timeZone }: { timeZone: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // Rendered on the client only, so the server's clock and timezone never show.
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  const city = timeZone.split("/").at(-1)?.replace(/_/g, " ") ?? timeZone;
  return (
    <div className="glass flex min-w-52 items-center justify-between gap-6 rounded-3xl border border-line px-5 py-4">
      <div>
        <p className="text-xs text-muted">
          {now ? new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(now) : " "}
        </p>
        <p className="mt-1 text-3xl font-light tabular-nums tracking-tight">
          {now ? new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(now) : " "}
        </p>
      </div>
      <p className="text-right text-xs text-muted">{city}</p>
    </div>
  );
}
