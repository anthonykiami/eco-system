import Link from "next/link";
import { Suspense } from "react";
import { formatAgo, formatCompact, formatNumber, formatWhen, greeting, preview } from "@/components/format";
import { SystemHealth } from "@/components/system-health";
import { TodaySkeleton, TodayView } from "@/components/today";
import { Badge, Card, EmptyState, LinkButton, Meter, Status } from "@/components/ui";
import { listToolkitConnections } from "@/lib/agents/composio";
import { monthlyTokenLimit, resolvePlan } from "@/lib/agents/limits";
import { requireActiveUser } from "@/lib/auth/session";
import {
  currentMonth,
  ensurePrimaryAgent,
  getUsage,
  getUser,
  listAgents,
  listJobs,
  listRecentConversations,
} from "@/lib/db/queries";
import type { Agent, ScheduledJob } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { BRIEFING_PROMPT, describeJob } from "@/lib/heartbeat/briefing";

const telegramUrl = `https://t.me/${env.TELEGRAM_BOT_USERNAME}`;

const jobTitle = (job: ScheduledJob) =>
  job.prompt.startsWith(BRIEFING_PROMPT) ? "☀️ Morning briefing" : preview(job.prompt, 70);

export default async function Dashboard() {
  const session = await requireActiveUser();
  const userId = session.user.id;
  const primary = await ensurePrimaryAgent(userId);
  const [user, agents, jobs, usage, recent] = await Promise.all([
    getUser(userId),
    listAgents(userId),
    listJobs(userId),
    getUsage(userId, currentMonth()),
    listRecentConversations(userId, { limit: 6 }),
  ]);
  const timezone = user?.timezone ?? session.user.timezone;
  const firstName = (user?.name ?? session.user.name ?? "").split(" ")[0];
  const today = new Intl.DateTimeFormat("en-US", { timeZone: timezone, dateStyle: "full" }).format(new Date());

  const pausedAgents = new Set(agents.filter((a) => a.tasksPaused).map((a) => a.id));
  const upcoming = jobs
    .filter((j) => j.enabled && j.nextRunAt && !pausedAgents.has(j.agentId))
    .sort((a, b) => a.nextRunAt!.getTime() - b.nextRunAt!.getTime())
    .slice(0, 6);
  const off = jobs.filter((j) => !j.enabled);
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? "Agent";

  const plan = resolvePlan(user?.plan ?? "free");
  const limit = user ? monthlyTokenLimit(user) : monthlyTokenLimit({ plan, monthlyTokenLimit: null });
  const used = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">{today}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            {greeting(timezone)}
            {firstName ? `, ${firstName}` : ""}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <LinkButton href={telegramUrl} variant="primary" target="_blank" rel="noreferrer">
            Open Telegram
          </LinkButton>
          <LinkButton href="/chat">Chat here</LinkButton>
          <LinkButton href="/settings/schedules">New task</LinkButton>
        </div>
      </header>

      {!user?.telegramChatId && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent/30 bg-accent-soft px-5 py-4">
          <p className="text-sm">
            <span className="font-medium">Connect Telegram</span> to talk to your agents from your phone, with
            reminders, voice messages and photos.
          </p>
          <LinkButton href="/settings/telegram" variant="primary" size="sm">
            Connect
          </LinkButton>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card title="Today">
            <Suspense fallback={<TodaySkeleton />}>
              <TodayView userId={userId} timeZone={timezone} />
            </Suspense>
          </Card>

          <Card title="Coming up" action={<Link href="/settings/schedules" className="text-muted hover:text-foreground">All tasks →</Link>}>
            {upcoming.length === 0 ? (
              <EmptyState>
                Nothing scheduled. Ask in Telegram: “remind me at 6 to call mom”, or “every weekday at 8, summarize my
                inbox”.
              </EmptyState>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {upcoming.map((job) => (
                  <li key={job.id} className="flex items-center gap-4 py-2.5 first:pt-0 last:pb-0">
                    <span className="w-36 shrink-0 text-sm font-medium tabular-nums">{formatWhen(job.nextRunAt!, timezone)}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{jobTitle(job)}</span>
                    <span className="hidden shrink-0 sm:block">
                      {job.kind === "reminder" ? (
                        <Badge tone="accent">Reminder</Badge>
                      ) : job.kind === "once" ? (
                        <Badge>Once</Badge>
                      ) : (
                        <Badge>{describeJob(job, timezone)}</Badge>
                      )}
                    </span>
                    {agents.length > 1 && <span className="hidden text-xs text-muted md:block">{agentName(job.agentId)}</span>}
                  </li>
                ))}
              </ul>
            )}
            {off.length > 0 && (
              <p className="text-xs text-muted">
                {off.length} {off.length === 1 ? "task is" : "tasks are"} switched off.{" "}
                <Link href="/settings/schedules" className="underline">
                  Review
                </Link>
              </p>
            )}
          </Card>

          <Card title="Recent conversations">
            {recent.length === 0 ? (
              <EmptyState>No conversations yet.</EmptyState>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {recent.map(({ chat, lastMessage }) => {
                  const where = chat.fromTask
                    ? "Task run"
                    : chat.channel === "web"
                      ? "Web"
                      : chat.telegramTopicId !== null
                        ? "Telegram topic"
                        : "Telegram";
                  return (
                    <li key={chat.id}>
                      <Link
                        href={chat.fromTask ? "/settings/schedules" : chat.channel === "web" ? "/chat" : telegramUrl}
                        target={chat.channel === "telegram" ? "_blank" : undefined}
                        className="-mx-2 flex items-start gap-3 rounded-lg px-2 py-2.5 transition hover:bg-surface-muted"
                      >
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                          {agentName(chat.agentId).slice(0, 1)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 text-sm">
                            <span className="font-medium">{agentName(chat.agentId)}</span>
                            <Badge>{where}</Badge>
                            <span className="ml-auto shrink-0 text-xs text-muted">{formatAgo(lastMessage.createdAt)}</span>
                          </span>
                          <span className="mt-0.5 block truncate text-sm text-muted">
                            {lastMessage.role === "user" ? "You: " : ""}
                            {preview(lastMessage.content)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card title="Usage this month" action={<Badge tone="accent">{plan} plan</Badge>}>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-semibold tabular-nums">{formatCompact(used)}</span>
              <span className="text-sm text-muted">of {formatCompact(limit)} tokens</span>
            </div>
            <Meter value={(used / limit) * 100} label="Tokens used this month" />
            <p className="text-xs text-muted">
              {formatNumber(usage?.messageCount ?? 0)} messages · resets on the 1st (UTC)
            </p>
          </Card>

          <AgentsCard primary={primary} agents={agents} />

          <Card title="Connected accounts" action={<Link href="/settings/integrations" className="text-muted hover:text-foreground">Manage →</Link>}>
            <Suspense fallback={<p className="text-sm text-muted">Checking…</p>}>
              <Connections userId={userId} />
            </Suspense>
          </Card>

          {session.user.isAdmin && (
            <Card
              title={
                <span className="flex items-center gap-2">
                  System <Badge tone="warning">admin</Badge>
                </span>
              }
              action={<Link href="/admin" className="text-muted hover:text-foreground">Details →</Link>}
            >
              <Suspense fallback={<p className="text-sm text-muted">Checking…</p>}>
                <SystemHealth />
              </Suspense>
            </Card>
          )}
        </div>
      </div>
    </main>
  );
}

function AgentsCard({ primary, agents }: { primary: Agent; agents: Agent[] }) {
  const specialists = agents.filter((a) => a.role === "specialized");
  return (
    <Card title="Agents" action={<Link href="/agents" className="text-muted hover:text-foreground">Manage →</Link>}>
      <ul className="flex flex-col gap-2">
        <li className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
            {primary.name.slice(0, 1)}
          </span>
          <span className="text-sm font-medium">{primary.name}</span>
          <Badge>main</Badge>
        </li>
        {specialists.map((agent) => (
          <li key={agent.id} className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
              {agent.name.slice(0, 1)}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm">{agent.name}</span>
            {agent.telegramTopicId !== null && <Badge>topic</Badge>}
          </li>
        ))}
      </ul>
      {specialists.length === 0 && (
        <p className="text-xs text-muted">
          Add agents for specific jobs (research, travel, fitness). Each gets its own Telegram topic.
        </p>
      )}
    </Card>
  );
}

async function Connections({ userId }: { userId: string }) {
  const toolkits = await listToolkitConnections(userId);
  return (
    <ul className="flex flex-col gap-3">
      {toolkits.map((t) => (
        <li key={t.slug} className="flex flex-col gap-0.5">
          {t.accounts.length > 0 ? (
            <Status tone="success">{t.name}</Status>
          ) : t.status ? (
            <Status tone="warning">{t.name}: not finished</Status>
          ) : (
            <Status tone="danger">{t.name}: not connected</Status>
          )}
          {t.accounts.map((a) => (
            <span key={a.id} className="pl-4 text-xs text-muted">
              {a.email ?? "Connected account"}
            </span>
          ))}
        </li>
      ))}
    </ul>
  );
}
