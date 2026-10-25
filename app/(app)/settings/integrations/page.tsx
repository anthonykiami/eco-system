import { Badge, Button, Card, LinkButton, Notice, PageHeader, Status } from "@/components/ui";
import { listToolkitConnections } from "@/lib/agents/composio";
import { requireActiveUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { connectToolkit, removeToolkit, setToolkitAccess } from "./actions";

const ERRORS: Record<string, string> = {
  start: "Couldn't start that connection. Please try again.",
  disconnect: "Couldn't disconnect that account. Please try again.",
  unknown: "Unknown integration.",
  access: "Couldn't save that setting. Please try again.",
};

export default async function IntegrationsPage({ searchParams }: PageProps<"/settings/integrations">) {
  const session = await requireActiveUser();
  const [toolkits, params] = await Promise.all([listToolkitConnections(session.user.id), searchParams]);

  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;
  // Composio appends this when it sends the user back from the provider.
  const justConnected = params.status === "success";
  const justFailed = params.status === "failed";
  const justSaved = params.saved === "1";

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-8">
      <PageHeader
        title="Integrations"
        description="Connect your accounts so your agents can act on them, and choose how much they may do. Agents only ever see the accounts you connect here."
      />

      {error && <Notice tone="danger">{error}</Notice>}
      {justConnected && (
        <Notice tone="success">
          Connected. Your agents can use it from your next message.{" "}
          <a href={`https://t.me/${env.TELEGRAM_BOT_USERNAME}`} className="underline">
            Open Telegram
          </a>
        </Notice>
      )}
      {justSaved && <Notice tone="success">Saved. It applies from your next message.</Notice>}
      {justFailed && <Notice tone="danger">That connection wasn&apos;t completed.</Notice>}

      <div className="grid gap-6 md:grid-cols-2">
        {toolkits.map((toolkit) => {
          const connected = toolkit.accounts.length > 0;
          return (
            <Card
              key={toolkit.slug}
              title={
                <span className="flex items-center gap-2.5">
                  {toolkit.logo && (
                    // eslint-disable-next-line @next/next/no-img-element -- small logos from Composio's CDN
                    <img src={toolkit.logo} alt="" className="h-7 w-7 rounded-md bg-white object-contain p-0.5" />
                  )}
                  {toolkit.name}
                </span>
              }
              action={
                connected ? (
                  <Badge tone="success">{toolkit.accounts.length === 1 ? "connected" : `${toolkit.accounts.length} accounts`}</Badge>
                ) : toolkit.status ? (
                  <Badge tone="warning">not finished</Badge>
                ) : (
                  <Badge>not connected</Badge>
                )
              }
            >
              <p className="-mt-2 line-clamp-3 text-sm text-muted">{toolkit.description}</p>

              {connected ? (
                <div className="flex flex-col gap-2">
                  <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
                    {toolkit.accounts.map((account, i) => (
                      <li key={account.id} className="flex items-center justify-between gap-3 px-3 py-2">
                        <Status tone="success">
                          <span className="truncate">{account.email ?? `Account ${i + 1}`}</span>
                          {i === 0 && toolkit.accounts.length > 1 && <Badge>default</Badge>}
                        </Status>
                        <form action={removeToolkit}>
                          <input type="hidden" name="connectedAccountId" value={account.id} />
                          <Button type="submit" size="sm" variant="ghost">
                            Disconnect
                          </Button>
                        </form>
                      </li>
                    ))}
                  </ul>
                  <form action={connectToolkit}>
                    <input type="hidden" name="slug" value={toolkit.slug} />
                    <Button type="submit" size="sm">
                      + Connect another account
                    </Button>
                  </form>
                  <p className="text-xs text-muted">
                    Pick the account on the sign-in screen. If it doesn&apos;t ask, sign in to that account in this
                    browser first.
                  </p>
                </div>
              ) : (
                <form action={connectToolkit}>
                  <input type="hidden" name="slug" value={toolkit.slug} />
                  <Button type="submit" variant="primary">
                    {toolkit.status ? "Finish connecting" : `Connect ${toolkit.name}`}
                  </Button>
                </form>
              )}

              <form action={setToolkitAccess} className="flex flex-col gap-2 border-t border-line pt-4">
                <input type="hidden" name="slug" value={toolkit.slug} />
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-sm font-medium">What your agents can do</legend>
                  {toolkit.access.map((level) => (
                    <label
                      key={level.id}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 text-sm transition has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
                    >
                      <input
                        type="radio"
                        name="access"
                        value={level.id}
                        defaultChecked={level.id === toolkit.currentAccess}
                        className="mt-0.5 accent-[var(--accent)]"
                      />
                      <span>
                        <span className="font-medium">{level.label}</span>
                        <span className="block text-muted">{level.description}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <Button type="submit" size="sm" className="self-start">
                  Save
                </Button>
              </form>
            </Card>
          );
        })}
      </div>

      <LinkButton href="/" variant="ghost" className="self-start">
        ← Dashboard
      </LinkButton>
    </main>
  );
}
