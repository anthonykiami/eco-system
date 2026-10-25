import { Button, Card, LinkButton, PageHeader, Status } from "@/components/ui";
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
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-8">
      <PageHeader
        title="Telegram"
        description="Where you use your agents day to day: talk to them, send voice messages and photos, get reminders and briefings, and manage agents and tasks. Send /help to the bot to see everything."
      />

      <Card>
        {user?.telegramChatId ? (
          <div className="flex flex-col gap-4">
            <Status tone="success">
              Connected
              {linkedAt && (
                <span className="text-muted">
                  {" "}
                  since {linkedAt.toLocaleDateString("en-US", { timeZone: session.user.timezone, dateStyle: "medium" })}
                </span>
              )}
            </Status>
            <div className="flex flex-wrap gap-2">
              <LinkButton href={`https://t.me/${env.TELEGRAM_BOT_USERNAME}`} variant="primary" target="_blank" rel="noreferrer">
                Open Telegram
              </LinkButton>
              <form action={unlinkTelegram}>
                <Button type="submit" variant="ghost">
                  Unlink
                </Button>
              </form>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Status tone="danger">Not connected</Status>
            <ConnectForm />
          </div>
        )}
      </Card>

      <Card title="How it's organized">
        <ul className="flex flex-col gap-2 text-sm text-muted">
          <li>
            <span className="font-medium text-foreground">Main chat:</span> your main agent. It hands work to your other
            agents when it fits.
          </li>
          <li>
            <span className="font-medium text-foreground">Agent topics:</span> each other agent has its own topic. Write
            there to talk to just that agent; its scheduled results land there too.
          </li>
          <li>
            <span className="font-medium text-foreground">Anywhere:</span> “@coach …” sends one message to an agent, and
            replies stream in as they&apos;re written.
          </li>
        </ul>
      </Card>
    </main>
  );
}
