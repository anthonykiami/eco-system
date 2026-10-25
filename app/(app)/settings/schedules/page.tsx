import Link from "next/link";
import { formatWhen } from "@/components/format";
import { Badge, Button, Card, EmptyState, inputClass, Notice, PageHeader } from "@/components/ui";
import { requireActiveUser } from "@/lib/auth/session";
import { getUser, listAgents } from "@/lib/db/queries";
import type { ScheduledJob } from "@/lib/db/schema";
import { listUserJobs } from "@/lib/heartbeat";
import { BRIEFING_PROMPT, DAY_PRESETS, describeJob } from "@/lib/heartbeat/briefing";
import { addBriefing, addTask, changeJob } from "./actions";

const ERRORS: Record<string, string> = {
  time: "Pick a valid time.",
  prompt: "Describe the task (up to 2,000 characters).",
};

function jobTitle(job: ScheduledJob): string {
  if (job.prompt.startsWith(BRIEFING_PROMPT)) return "☀️ Morning briefing";
  const firstLine = job.prompt.split("\n")[0];
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
}

function ScheduleFields({ defaultTime }: { defaultTime: string }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <input type="time" name="time" required defaultValue={defaultTime} className={inputClass} aria-label="Time" />
      <select name="days" defaultValue="daily" className={inputClass} aria-label="Days">
        {Object.entries(DAY_PRESETS).map(([value, { label }]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

function JobButton({
  jobId,
  action,
  label,
  variant = "ghost",
}: {
  jobId: string;
  action: string;
  label: string;
  variant?: "ghost" | "primary" | "danger";
}) {
  return (
    <form action={changeJob}>
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="action" value={action} />
      <Button type="submit" size="sm" variant={variant}>
        {label}
      </Button>
    </form>
  );
}

const KIND_BADGE = { recurring: undefined, once: <Badge>Once</Badge>, reminder: <Badge tone="accent">Reminder</Badge> };

export default async function SchedulesPage({ searchParams }: PageProps<"/settings/schedules">) {
  const session = await requireActiveUser();
  const [jobs, user, agents, params] = await Promise.all([
    listUserJobs(session.user.id),
    getUser(session.user.id),
    listAgents(session.user.id),
    searchParams,
  ]);
  const timezone = user?.timezone ?? session.user.timezone;
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;
  const queued = params.queued === "1";
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name;
  const pausedAgents = new Set(agents.filter((a) => a.tasksPaused).map((a) => a.id));

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-8">
      <PageHeader
        title="Tasks"
        description={
          <>
            Reminders and tasks your agents run on their own, with results sent to Telegram. Times are in your
            timezone, {timezone} (<Link href="/settings" className="underline">change</Link>). In Telegram, just ask:
            “remind me at 6 to call mom”.
          </>
        }
      />
      {!user?.telegramChatId && (
        <Notice tone="danger">
          Telegram isn&apos;t linked, so results are only saved to your web chats.{" "}
          <Link href="/settings/telegram" className="underline">
            Link Telegram
          </Link>
        </Notice>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      {queued && (
        <Notice tone="success">
          Queued. It runs at the next check, within about 5 minutes; a briefing can take a minute or two to write.
        </Notice>
      )}

      {jobs.length === 0 ? (
        <EmptyState>No tasks yet. Add a morning briefing or a custom task below.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {jobs.map((job) => (
            <li key={job.id} className="flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-surface p-4">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {jobTitle(job)}
                  {KIND_BADGE[job.kind]}
                  {!job.enabled && <Badge tone="warning">off</Badge>}
                  {job.enabled && pausedAgents.has(job.agentId) && (
                    <Badge tone="warning">paused with {agentName(job.agentId) ?? "its agent"}</Badge>
                  )}
                </p>
                <p className="mt-0.5 text-sm text-muted">
                  {job.kind === "recurring" ? describeJob(job, timezone) : job.nextRunAt ? formatWhen(job.nextRunAt, timezone) : "already sent"}
                  {job.kind === "recurring" && job.enabled && job.nextRunAt && ` · next ${formatWhen(job.nextRunAt, timezone)}`}
                  {job.lastRunAt && ` · last ran ${formatWhen(job.lastRunAt, timezone)}`}
                  {agents.length > 1 && agentName(job.agentId) && ` · ${agentName(job.agentId)}`}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                {job.enabled ? (
                  <>
                    <JobButton jobId={job.id} action="run" label="Send now" />
                    <JobButton jobId={job.id} action="pause" label="Pause" />
                  </>
                ) : (
                  <JobButton jobId={job.id} action="resume" label="Turn on" variant="primary" />
                )}
                <JobButton jobId={job.id} action="delete" label="Delete" variant="danger" />
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="☀️ Morning briefing">
          <form action={addBriefing} className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              Today&apos;s calendar, emails that need you, and reminders, in one message. It uses the accounts in{" "}
              <Link href="/settings/integrations" className="underline">
                Integrations
              </Link>
              .
            </p>
            <ScheduleFields defaultTime="07:00" />
            <textarea
              name="extra"
              rows={2}
              maxLength={500}
              placeholder="Anything to add? e.g. “Include Lakers scores”"
              className={inputClass}
            />
            <Button type="submit" variant="primary" className="self-start">
              Add briefing
            </Button>
          </form>
        </Card>

        <Card title="Custom task">
          <form action={addTask} className="flex flex-col gap-3">
            <textarea
              name="prompt"
              rows={3}
              required
              maxLength={2000}
              placeholder="e.g. Look at tomorrow's calendar and tell me what to prepare tonight."
              className={inputClass}
            />
            <ScheduleFields defaultTime="09:00" />
            <Button type="submit" variant="primary" className="self-start">
              Add task
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
