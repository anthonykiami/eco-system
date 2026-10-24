import Link from "next/link";
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

export default async function IntegrationsPage({
  searchParams,
}: PageProps<"/settings/integrations">) {
  const session = await requireActiveUser();
  const [toolkits, params] = await Promise.all([
    listToolkitConnections(session.user.id),
    searchParams,
  ]);

  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;
  // Composio appends this when it sends the user back from the provider.
  const justConnected = params.status === "success";
  const justFailed = params.status === "failed";
  const justSaved = params.saved === "1";

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold">Integrations</h1>
        <p className="mt-1 text-neutral-500">
          Connect your accounts so your agents can act on them, then talk to them in Telegram.
          They only ever see the accounts you connect here.
        </p>
      </div>

      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      {justConnected && (
        <p className="text-sm text-green-600">
          Connected. Your agents can use it from your next message.{" "}
          <a href={`https://t.me/${env.TELEGRAM_BOT_USERNAME}`} className="underline">
            Open Telegram
          </a>
        </p>
      )}
      {justSaved && <p className="text-sm text-green-600">Saved. It applies from your next message.</p>}
      {justFailed && (
        <p role="alert" className="text-sm text-red-500">
          That connection wasn&apos;t completed.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {toolkits.map((toolkit) => {
          const isActive = toolkit.status === "ACTIVE";
          return (
            <li
              key={toolkit.slug}
              className="flex flex-col gap-4 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-medium">{toolkit.name}</p>
                  <p className="text-sm text-neutral-500">{toolkit.description}</p>
                  {toolkit.status && !isActive && (
                    <p className="mt-1 text-xs text-neutral-500">Status: {toolkit.status}</p>
                  )}
                </div>

                {isActive ? (
                  <form action={removeToolkit}>
                    <input
                      type="hidden"
                      name="connectedAccountId"
                      value={toolkit.connectedAccountId}
                    />
                    <button type="submit" className="text-sm text-neutral-500 underline">
                      Disconnect
                    </button>
                  </form>
                ) : (
                  <form action={connectToolkit}>
                    <input type="hidden" name="slug" value={toolkit.slug} />
                    <button
                      type="submit"
                      className="rounded-lg bg-foreground px-4 py-2 text-sm text-background"
                    >
                      {toolkit.status ? "Finish connecting" : "Connect"}
                    </button>
                  </form>
                )}
              </div>

              <form action={setToolkitAccess} className="flex flex-col gap-2">
                <input type="hidden" name="slug" value={toolkit.slug} />
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-sm font-medium">What your agents can do</legend>
                  {toolkit.access.map((level) => (
                    <label key={level.id} className="flex items-start gap-2 text-sm">
                      <input
                        type="radio"
                        name="access"
                        value={level.id}
                        defaultChecked={level.id === toolkit.currentAccess}
                        className="mt-1"
                      />
                      <span>
                        <span className="font-medium">{level.label}</span>
                        <span className="block text-neutral-500">{level.description}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <button type="submit" className="self-start text-sm underline">
                  Save
                </button>
              </form>
            </li>
          );
        })}
      </ul>

      <Link href="/settings" className="text-sm underline">
        Back to settings
      </Link>
    </main>
  );
}
