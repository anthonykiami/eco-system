import Link from "next/link";
import { requireActiveUser } from "@/lib/auth/session";
import { getUser } from "@/lib/db/queries";
import type { ScheduledJob } from "@/lib/db/schema";
import { listUserJobs } from "@/lib/heartbeat";
import { BRIEFING_PROMPT, DAY_PRESETS, describeJob } from "@/lib/heartbeat/briefing";
import { addBriefing, addTask, changeJob } from "./actions";

const ERRORS: Record<string, string> = {
  time: "Pick a valid time.",
  prompt: "Describe the task (up to 2,000 characters).",
};

const inputClass =
  "rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700";
const primaryButton = "self-start rounded-lg bg-foreground px-4 py-2 text-sm text-background";

function jobTitle(job: ScheduledJob): string {
  if (job.prompt.startsWith(BRIEFING_PROMPT)) return "Morning briefing";
  const firstLine = job.prompt.split("\n")[0];
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
}

function ScheduleFields({ defaultTime }: { defaultTime: string }) {
  return (
    <div className="flex flex-wrap gap-3">
      <input type="time" name="time" required defaultValue={defaultTime} className={inputClass} />
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

function JobButton({ jobId, action, label }: { jobId: string; action: string; label: string }) {
  return (
    <form action={changeJob}>
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="action" value={action} />
      <button type="submit" className="text-sm text-neutral-500 underline">
        {label}
      </button>
    </form>
  );
}

export default async function SchedulesPage({ searchParams }: PageProps<"/settings/schedules">) {
  const session = await requireActiveUser();
  const [jobs, user, params] = await Promise.all([
    listUserJobs(session.user.id),
    getUser(session.user.id),
    searchParams,
  ]);
  const timezone = user?.timezone ?? session.user.timezone;
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;
  const queued = params.queued === "1";
  const formatRun = (date: Date) =>
    date.toLocaleString("en-US", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" });

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-8">
      <div>
        <h1 className="text-2xl font-semibold">Scheduled tasks</h1>
        <p className="mt-1 text-neutral-500">
          Your assistant runs these on its own and sends you the result on Telegram. Times are in
          your timezone, {timezone} (<Link href="/settings" className="underline">change</Link>).
        </p>
        {!user?.telegramChatId && (
          <p role="alert" className="mt-2 text-sm text-amber-600">
            Telegram isn&apos;t linked, so results will only be saved to your web chats.{" "}
            <Link href="/settings/telegram" className="underline">
              Link Telegram
            </Link>
          </p>
        )}
      </div>

      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      {queued && (
        <p role="status" className="text-sm text-green-600">
          Queued. It runs at the next check, within about 5 minutes, and a briefing can take a minute
          or two to write.
        </p>
      )}

      {jobs.length > 0 && (
        <ul className="flex flex-col gap-3">
          {jobs.map((job) => (
            <li
              key={job.id}
              className="flex flex-col gap-2 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
            >
              <div>
                <p className="font-medium">{jobTitle(job)}</p>
                <p className="text-sm text-neutral-500">
                  {describeJob(job, timezone)}
                  {job.kind === "recurring" &&
                    ` · ${job.enabled && job.nextRunAt ? `next ${formatRun(job.nextRunAt)}` : "paused"}`}
                  {job.kind !== "recurring" && !job.enabled && " · paused"}
                  {job.lastRunAt && ` · last ran ${formatRun(job.lastRunAt)}`}
                </p>
              </div>
              <div className="flex flex-wrap gap-4">
                {job.enabled ? (
                  <>
                    <JobButton jobId={job.id} action="run" label="Send now" />
                    <JobButton jobId={job.id} action="pause" label="Pause" />
                  </>
                ) : (
                  <JobButton jobId={job.id} action="resume" label="Resume" />
                )}
                <JobButton jobId={job.id} action="delete" label="Delete" />
              </div>
            </li>
          ))}
        </ul>
      )}

      <form action={addBriefing} className="flex flex-col gap-3">
        <div>
          <h2 className="font-medium">Morning briefing</h2>
          <p className="text-sm text-neutral-500">
            Today&apos;s calendar, emails that need you, and reminders, in one message. It uses the
            accounts you&apos;ve connected in{" "}
            <Link href="/settings/integrations" className="underline">
              Integrations
            </Link>
            .
          </p>
        </div>
        <ScheduleFields defaultTime="07:00" />
        <textarea
          name="extra"
          rows={2}
          maxLength={500}
          placeholder="Anything to add? e.g. “Include Lakers scores” or “Keep it under 5 bullets”"
          className={inputClass}
        />
        <button type="submit" className={primaryButton}>
          Add briefing
        </button>
      </form>

      <form action={addTask} className="flex flex-col gap-3">
        <div>
          <h2 className="font-medium">Custom task</h2>
          <p className="text-sm text-neutral-500">Anything you&apos;d ask your assistant, on a schedule.</p>
        </div>
        <textarea
          name="prompt"
          rows={3}
          required
          maxLength={2000}
          placeholder="e.g. Look at tomorrow's calendar and tell me what I should prepare tonight."
          className={inputClass}
        />
        <ScheduleFields defaultTime="09:00" />
        <button type="submit" className={primaryButton}>
          Add task
        </button>
      </form>

      <Link href="/settings" className="text-sm underline">
        Back to settings
      </Link>
    </main>
  );
}
