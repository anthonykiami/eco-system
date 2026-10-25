import { Badge, Button, Card, EmptyState, inputClass, Notice, PageHeader } from "@/components/ui";
import { getToolkits, listOneClickApps, type CatalogApp } from "@/lib/agents/composio";
import { requireAdmin } from "@/lib/auth/session";
import { listIntegrationCatalog } from "@/lib/db/queries";
import { addIntegration, removeIntegration } from "./actions";

const RESULT_LIMIT = 30;

function AppLogo({ src, name }: { src: string | null; name: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- small logos from Composio's CDN
    <img src={src} alt="" className="h-9 w-9 shrink-0 rounded-lg bg-white object-contain p-1" />
  ) : (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-sm font-semibold">
      {name.slice(0, 1)}
    </span>
  );
}

const matches = (app: CatalogApp, q: string) =>
  [app.name, app.slug, app.description, ...app.categories].some((field) => field.toLowerCase().includes(q));

export default async function AdminIntegrationsPage({ searchParams }: PageProps<"/admin/integrations">) {
  await requireAdmin();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().toLowerCase() : "";
  const [toolkits, catalog, apps] = await Promise.all([getToolkits(), listIntegrationCatalog(), listOneClickApps()]);
  const offered = new Set(toolkits.map((t) => t.slug));
  const results = (q ? apps.filter((a) => matches(a, q)) : apps).slice(0, RESULT_LIMIT);
  const counts = new Map(
    catalog.map((c) => [c.slug, { full: c.fullTools.length, read: c.readTools.length, safe: c.safeTools.length }]),
  );

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-8">
      <PageHeader
        title="App catalog"
        description="Choose which apps everyone can connect on their Integrations page. These use Composio's one-click sign-in, like Gmail; each user still connects their own account and picks what agents may do."
        actions={<Badge tone="warning">admin</Badge>}
      />
      {params.error === "unknown" && <Notice tone="danger">That app isn&apos;t available with one-click sign-in.</Notice>}
      {typeof params.added === "string" && (
        <Notice tone="success">{params.added} is now on everyone&apos;s Integrations page.</Notice>
      )}
      {params.removed === "1" && <Notice tone="success">Removed. Agents stop using it from the next message.</Notice>}

      <Card title={`Offered to users (${toolkits.length})`}>
        <ul className="grid gap-3 sm:grid-cols-2">
          {toolkits.map((t) => (
            <li key={t.slug} className="flex items-center gap-3 rounded-xl border border-line p-3">
              <AppLogo src={t.logo} name={t.name} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {t.name} {t.builtIn && <Badge>built in</Badge>}
                </p>
                <p className="text-xs text-muted">
                  {t.builtIn
                    ? "Hand-picked access levels"
                    : `${counts.get(t.slug)?.full ?? 0} tools: ${counts.get(t.slug)?.read ?? 0} read-only, ${counts.get(t.slug)?.safe ?? 0} non-deleting`}
                </p>
              </div>
              {!t.builtIn && (
                <div className="flex gap-1">
                  <form action={addIntegration}>
                    <input type="hidden" name="slug" value={t.slug} />
                    <Button type="submit" size="sm" variant="ghost" title="Re-read its tools from Composio">
                      Refresh
                    </Button>
                  </form>
                  <form action={removeIntegration}>
                    <input type="hidden" name="slug" value={t.slug} />
                    <Button type="submit" size="sm" variant="danger">
                      Remove
                    </Button>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card title={`Add an app (${apps.length} available)`}>
        <form className="flex gap-2" role="search">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search Notion, GitHub, Slack, Drive, Outlook…"
            aria-label="Search apps"
            className={inputClass}
          />
          <Button type="submit">Search</Button>
        </form>
        {results.length === 0 ? (
          <EmptyState>No one-click app matches “{q}”.</EmptyState>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((app) => (
              <li key={app.slug} className="flex flex-col gap-2 rounded-xl border border-line p-3">
                <div className="flex items-center gap-3">
                  <AppLogo src={app.logo} name={app.name} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{app.name}</p>
                    <p className="truncate text-xs text-muted">
                      {[app.categories[0], `${app.toolsCount} tools`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </div>
                <p className="line-clamp-2 flex-1 text-xs text-muted">{app.description}</p>
                {offered.has(app.slug) ? (
                  <Badge tone="success">offered</Badge>
                ) : (
                  <form action={addIntegration}>
                    <input type="hidden" name="slug" value={app.slug} />
                    <Button type="submit" size="sm" variant="primary">
                      Add
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {!q && apps.length > RESULT_LIMIT && (
          <p className="text-xs text-muted">Showing {RESULT_LIMIT} of {apps.length}. Search to find others.</p>
        )}
      </Card>
    </main>
  );
}
