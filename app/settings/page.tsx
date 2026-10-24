import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/session";

export default async function SettingsPage() {
  const session = await requireActiveUser();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-neutral-500">Email</dt>
        <dd>{session.user.email}</dd>
        <dt className="text-neutral-500">Timezone</dt>
        <dd>{session.user.timezone}</dd>
      </dl>
      <nav className="flex flex-col gap-2 text-sm">
        <Link href="/settings/telegram" className="underline">
          Telegram
        </Link>
        <Link href="/settings/integrations" className="underline">
          Integrations
        </Link>
      </nav>
      <p className="text-neutral-500">More settings coming soon.</p>
      <Link href="/" className="text-sm underline">
        Back
      </Link>
    </main>
  );
}
