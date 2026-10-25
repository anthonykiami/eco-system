import Link from "next/link";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { PLAN_LIMITS, resolvePlan } from "@/lib/agents/limits";
import { requireActiveUser } from "@/lib/auth/session";
import { getUser } from "@/lib/db/queries";
import { setTimezone } from "./actions";

const SECTIONS = [
  { href: "/settings/telegram", title: "Telegram", text: "Where you talk to your agents." },
  { href: "/settings/integrations", title: "Integrations", text: "Gmail, Calendar and more, and what agents may do." },
  { href: "/settings/schedules", title: "Tasks", text: "Reminders, briefings and scheduled tasks." },
  { href: "/agents", title: "Agents", text: "Create and edit your agents." },
];

export default async function SettingsPage() {
  const session = await requireActiveUser();
  const user = await getUser(session.user.id);
  const zones = Intl.supportedValuesOf("timeZone");
  // Keep a saved alias (e.g. "UTC") selectable even though Intl doesn't list it.
  if (!zones.includes(session.user.timezone)) zones.unshift(session.user.timezone);
  const plan = resolvePlan(user?.plan ?? "free");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-8">
      <PageHeader title="Settings" />

      <Card title="Account">
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-4 text-sm">
          <dt className="text-muted">Email</dt>
          <dd>{session.user.email}</dd>
          <dt className="text-muted">Plan</dt>
          <dd className="flex items-center gap-2">
            <Badge tone="accent">{plan}</Badge>
            <span className="text-muted">
              {PLAN_LIMITS[plan].monthlyTokens.toLocaleString("en-US")} tokens a month
            </span>
          </dd>
          <dt className="text-muted">Timezone</dt>
          <dd>
            <form action={setTimezone} className="flex flex-wrap items-center gap-2">
              <select
                name="timezone"
                defaultValue={session.user.timezone}
                aria-label="Timezone"
                className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
              >
                {zones.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
              <Button type="submit" size="sm">
                Save
              </Button>
            </form>
            <p className="mt-1 text-xs text-muted">Scheduled tasks follow it, so 07:00 stays 07:00 where you are.</p>
          </dd>
        </dl>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="flex flex-col gap-1 rounded-2xl border border-line bg-surface p-4 transition hover:border-accent/50"
          >
            <span className="font-medium">{s.title} →</span>
            <span className="text-sm text-muted">{s.text}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
