import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/session";
import { setTimezone } from "./actions";

export default async function SettingsPage() {
  const session = await requireActiveUser();
  const zones = Intl.supportedValuesOf("timeZone");
  // Keep a saved alias (e.g. "UTC") selectable even though Intl doesn't list it.
  if (!zones.includes(session.user.timezone)) zones.unshift(session.user.timezone);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-neutral-500">Email</dt>
        <dd>{session.user.email}</dd>
        <dt className="text-neutral-500">Timezone</dt>
        <dd>
          <form action={setTimezone} className="flex items-center gap-2">
            <select
              name="timezone"
              defaultValue={session.user.timezone}
              aria-label="Timezone"
              className="rounded border border-neutral-300 bg-transparent px-1 py-0.5 dark:border-neutral-700"
            >
              {zones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
            <button type="submit" className="underline">
              Save
            </button>
          </form>
        </dd>
      </dl>
      <nav className="flex flex-col gap-2 text-sm">
        <Link href="/settings/telegram" className="underline">
          Telegram
        </Link>
        <Link href="/settings/integrations" className="underline">
          Integrations
        </Link>
        <Link href="/settings/schedules" className="underline">
          Scheduled tasks
        </Link>
      </nav>
      <p className="text-neutral-500">More settings coming soon.</p>
      <Link href="/" className="text-sm underline">
        Back
      </Link>
    </main>
  );
}
