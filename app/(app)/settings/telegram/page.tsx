import Link from "next/link";
import { Button, Card, LinkButton, PageHeader, Status } from "@/components/ui";
import { requireActiveUser } from "@/lib/auth/session";
import { getUser, listAgents } from "@/lib/db/queries";
import { env } from "@/lib/env";
import { unlinkGroup, unlinkTelegram } from "./actions";
import { ConnectForm } from "./connect-form";

export default async function TelegramSettingsPage() {
  const session = await requireActiveUser();
  const [user, agents] = await Promise.all([getUser(session.user.id), listAgents(session.user.id)]);
  const linkedAt = user?.telegramChatId ? user.telegramLinkedAt : null;
  const agentBots = agents.filter((a) => a.telegramBotUsername);

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
            <span className="font-medium text-foreground">@{env.TELEGRAM_BOT_USERNAME}:</span> your main agent. It hands
            work to your other agents when it fits, and “@coach …” sends one message to a specific agent.
          </li>
          <li>
            <span className="font-medium text-foreground">Agents&apos; own bots:</span> give any agent its own bot on the{" "}
            <Link href="/agents" className="underline">
              Agents page
            </Link>
            , and it gets its own private chat.
            {agentBots.length > 0 && ` Yours: ${agentBots.map((a) => `@${a.telegramBotUsername}`).join(", ")}.`}
          </li>
          <li>
            <span className="font-medium text-foreground">The group:</span> one chat with you and all your agents, where
            each answers as itself.
          </li>
        </ul>
      </Card>

      <Card
        title="Group chat"
        action={user?.telegramGroupChatId ? <Status tone="success">Linked</Status> : <Status tone="warning">Not set up</Status>}
      >
        {user?.telegramGroupChatId ? (
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-muted">
              Messages with no @mention go to your main agent; “@agent_bot …” or replying to an agent&apos;s message goes
              to that agent, who answers as itself. Only you can talk to your agents there.
            </p>
            <form action={unlinkGroup}>
              <Button type="submit" variant="ghost" size="sm">
                Unlink group
              </Button>
            </form>
          </div>
        ) : (
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted">
            <li>In Telegram, create a new group (just you is fine).</li>
            <li>
              Add your main bot, <span className="text-foreground">@{env.TELEGRAM_BOT_USERNAME}</span>, and make it an
              admin, so it sees every message.
            </li>
            <li>
              Add your agents&apos; bots
              {agentBots.length > 0
                ? `: ${agentBots.map((a) => `@${a.telegramBotUsername}`).join(", ")}`
                : " (connect them on the Agents page first)"}
              .
            </li>
            <li>
              Send <code className="text-foreground">/linkgroup</code> in the group.
            </li>
          </ol>
        )}
      </Card>
    </main>
  );
}
