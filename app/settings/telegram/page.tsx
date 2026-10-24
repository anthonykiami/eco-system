import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/session";
import { getUser } from "@/lib/db/queries";
import { env } from "@/lib/env";
import { unlinkTelegram } from "./actions";
import { ConnectForm } from "./connect-form";

export default async function TelegramSettingsPage() {
  const session = await requireActiveUser();
  const user = await getUser(session.user.id);
  const linkedAt = user?.telegramChatId ? user.telegramLinkedAt : null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">Telegram</h1>
      <p className="text-neutral-500">
        Telegram is where you talk to your agents, get scheduled briefings, and manage agents and
        tasks. Send <code>/help</code> to the bot to see everything it can do.
      </p>

      {user?.telegramChatId ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            <span className="font-medium text-green-700 dark:text-green-500">Connected</span>
            {linkedAt && (
              <span className="text-neutral-500"> since {linkedAt.toLocaleDateString("en-US", { timeZone: session.user.timezone, dateStyle: "medium" })}</span>
            )}
          </p>
          <a
            href={`https://t.me/${env.TELEGRAM_BOT_USERNAME}`}
            className="self-start rounded-lg bg-foreground px-4 py-2 text-sm text-background"
          >
            Open Telegram
          </a>
          <form action={unlinkTelegram}>
            <button
              type="submit"
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm dark:border-neutral-700"
            >
              Unlink
            </button>
          </form>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            <span className="font-medium">Not connected</span>
          </p>
          <ConnectForm />
        </div>
      )}

      <Link href="/settings" className="text-sm underline">
        Back to settings
      </Link>
    </main>
  );
}
