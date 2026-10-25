import Link from "next/link";
import { Suspense } from "react";
import { formatAgo, formatCompact, formatNumber, formatWhen, greeting, preview } from "@/components/format";
import { Clock } from "@/components/clock";
import { FocusCard } from "@/components/home-cards";
import { Orchestrator, type OrbitNode } from "@/components/orchestrator";
import { SystemHealth } from "@/components/system-health";
import { TodaySkeleton, TodayView } from "@/components/today";
import { Badge, Card, EmptyState, LinkButton, Meter, Status } from "@/components/ui";
import { Wordmark } from "@/components/logo";
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
import type { ScheduledJob } from "@/lib/db/schema";
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
    listRecentConversations(userId, { limit: 20 }),
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

  const specialists = agents.filter((a) => a.role === "specialized");
  const palette: OrbitNode["color"][] = ["blue", "teal", "violet", "green"];
  const nodes: OrbitNode[] = [
    ...specialists.slice(0, 4).map((a, i) => ({
      key: a.id,
      label: a.name,
      sub: a.tasksPaused ? "Specialist · tasks paused" : "Specialist agent · chat",
      href: `/chat?agent=${a.id}`,
      color: palette[i % palette.length],
      icon: <span className="text-lg font-semibold">{a.name.slice(0, 1)}</span>,
    })),
    {
      key: "memory",
      label: "Memory",
      sub: "Remembers · Connects · Learns",
      href: "/chat",
      color: "green" as const,
      icon: <NodeIcon path="M5 19c8 0 14-6 14-14C11 5 5 11 5 19Zm0 0 7-7" />,
    },
    {
      key: "tasks",
      label: "Tasks",
      sub: `${jobs.filter((j) => j.enabled).length} scheduled · Keeps you on track`,
      href: "/settings/schedules",
      color: "teal" as const,
      icon: <NodeIcon path="M9 4h6v3H9zM6 6h12v14H6zm3 8 2 2 4-4" />,
    },
  ];
  // Latest activity per agent, and the latest reply overall, from recent conversations.
  const lastByAgent = new Map<string, (typeof recent)[number]>();
  for (const r of recent) if (!lastByAgent.has(r.chat.agentId)) lastByAgent.set(r.chat.agentId, r);
  const latestReply = recent.find((r) => r.lastMessage.role === "assistant");
  const allAgents = [primary, ...specialists];

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-8">
      <section className="relative grid items-center gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col gap-5 pt-2 lg:pt-10">
          <p className="eyebrow">Intelligence in balance · {today}</p>
          <h1 className="text-5xl leading-none font-light sm:text-6xl">
            <Wordmark className="!tracking-[0.12em]" />
          </h1>
          <p className="text-2xl leading-snug font-light text-accent">
            {greeting(timezone)}
            {firstName ? `, ${firstName}` : ""}.
            <br />A calmer, smarter you.
          </p>
          <p className="max-w-md text-muted">
            Your AI agents work together to understand, create, and move your goals forward, here and in Telegram.
          </p>
          <div className="flex flex-wrap gap-3">
            <LinkButton href="/chat" variant="glow" className="!px-6 !py-3">
              <span aria-hidden>▶</span> Chat with ECO-SYSTEM <span aria-hidden>→</span>
            </LinkButton>
            <LinkButton href={telegramUrl} target="_blank" rel="noreferrer" variant="ghost" className="!py-3">
              Open Telegram ↗
            </LinkButton>
          </div>
        </div>
        <div className="relative">
          <div className="absolute -top-2 right-0 z-10 hidden xl:block">
            <Clock timeZone={timezone} />
          </div>
          <Orchestrator center={{ name: primary.name, href: "/chat" }} nodes={nodes} />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          title={<span className="flex items-center gap-2.5"><CardIcon path="M8 3v4m8-4v4M4 9h16M5 5h14v15H5zm4 9 2 2 4-4" /> Today&apos;s Focus</span>}
          action={<Link href="/settings/schedules" className="text-muted hover:text-foreground">→</Link>}
        >
          <Suspense fallback={<div className="h-32 animate-pulse rounded-2xl bg-surface-muted" />}>
            <FocusCard userId={userId} timeZone={timezone} />
          </Suspense>
        </Card>

        <Card
          title={<span className="flex items-center gap-2.5"><CardIcon path="M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm10 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM7 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm10 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /> Active Agents</span>}
          action={<Link href="/agents" className="text-muted hover:text-foreground">→</Link>}
        >
          <ul className="flex flex-col divide-y divide-line">
            {allAgents.map((a, i) => {
              const last = lastByAgent.get(a.id);
              return (
                <li key={a.id}>
                  <Link href={`/chat?agent=${a.id}`} className="-mx-2 flex items-center gap-3 rounded-2xl px-2 py-2.5 transition hover:bg-surface-muted">
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                        a.role === "primary" ? "bg-accent/20 text-accent" : ["bg-agent-blue/20 text-agent-blue", "bg-agent-teal/20 text-agent-teal", "bg-agent-violet/20 text-agent-violet"][i % 3]
                      }`}
                    >
                      {a.name.slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{a.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {a.tasksPaused ? "Tasks paused" : last ? `${preview(last.lastMessage.content, 40)} · ${formatAgo(last.lastMessage.createdAt)}` : "Ready"}
                      </span>
                    </span>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${a.tasksPaused ? "bg-warning" : "bg-accent shadow-[0_0_8px_rgba(94,230,168,0.9)]"}`} aria-hidden />
                    <span className="text-muted" aria-hidden>›</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card
          title={<span className="flex items-center gap-2.5"><CardIcon path="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z" /> Latest from your agents</span>}
          action={<Link href="/chat" className="text-muted hover:text-foreground">→</Link>}
        >
          {latestReply ? (
            <Link href={`/chat?agent=${latestReply.chat.agentId}&c=${latestReply.chat.id}`} className="group flex flex-col gap-3">
              <div className="relative h-28 overflow-hidden rounded-2xl border border-line" style={{ background: "radial-gradient(120% 90% at 20% 100%, rgba(40,140,80,0.55), transparent 60%), radial-gradient(90% 80% at 85% 0%, rgba(120,190,170,0.35), transparent 60%), linear-gradient(160deg, #0b2418, #06120c)" }}>
                <span className="absolute bottom-3 left-4 text-xs text-white/70">
                  {agentName(latestReply.chat.agentId)} · {formatAgo(latestReply.lastMessage.createdAt)}
                </span>
              </div>
              <p className="line-clamp-3 text-sm leading-relaxed text-foreground/90 group-hover:text-foreground">
                {preview(latestReply.lastMessage.content, 220)}
              </p>
            </Link>
          ) : (
            <EmptyState>Nothing yet. Say hi to your agents in Chat or Telegram.</EmptyState>
          )}
        </Card>
      </div>

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

function NodeIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={path} />
    </svg>
  );
}

function CardIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 text-accent" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={path} />
    </svg>
  );
}
