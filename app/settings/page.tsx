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
      <nav className="flex flex-col gap-3 text-sm">
        <Link href="/settings/telegram" className="flex flex-col">
          <span className="underline">Telegram</span>
          <span className="text-neutral-500">Where you talk to your agents.</span>
        </Link>
        <Link href="/settings/integrations" className="flex flex-col">
          <span className="underline">Integrations</span>
          <span className="text-neutral-500">Connect Gmail, Calendar and more, and choose what agents may do.</span>
        </Link>
        <Link href="/settings/schedules" className="flex flex-col">
          <span className="underline">Scheduled tasks</span>
          <span className="text-neutral-500">Also manageable in Telegram with /tasks.</span>
        </Link>
      </nav>
      <Link href="/" className="text-sm underline">
        Back
      </Link>
    </main>
  );
}
