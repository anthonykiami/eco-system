import { Badge, Button, buttonClass, Card, inputClass, Notice, PageHeader } from "@/components/ui";
import { MAX_AGENT_DESCRIPTION_LENGTH, MAX_AGENT_NAME_LENGTH, MAX_SPECIALISTS } from "@/lib/agents/naming";
import { requireActiveUser } from "@/lib/auth/session";
import { ensurePrimaryAgent, listAgents, listJobs } from "@/lib/db/queries";
import type { Agent } from "@/lib/db/schema";
import { addAgent, connectBot, disconnectBot, editAgent, removeAgent, setTasksPaused } from "./actions";

const ERRORS: Record<string, string> = {
  invalid: `Names need 1 to ${MAX_AGENT_NAME_LENGTH} characters, with at least one letter or number.`,
  reserved: "“main” is reserved for your main agent. Pick another name.",
  taken: "You already have an agent with that name.",
  description: `Describe the job in 1 to ${MAX_AGENT_DESCRIPTION_LENGTH.toLocaleString("en-US")} characters.`,
  limit: `You can have up to ${MAX_SPECIALISTS} agents besides your main one. Delete one first.`,
  missing: "That agent no longer exists.",
  "bot-format": "That doesn't look like a bot token. It's the long code BotFather sends, like 123456789:AAH…",
  "bot-invalid": "Telegram didn't accept that token. Copy it again from @BotFather (or /token there to get a new one).",
  "bot-main": "That's your main assistant's bot. Make a new bot in @BotFather for this agent.",
  "bot-taken": "That bot is already connected to another agent.",
  "bot-failed": "Couldn't set up the bot. Please try again.",
};

const SAVED: Record<string, string> = {
  created: "Agent created. If Telegram is connected, it now has its own topic there.",
  updated: "Saved. It applies from the next message.",
  deleted: "Agent deleted, along with its conversations and tasks. Its bot (if any) was disconnected.",
  bot: "Bot connected. Open its chat and tap Start, so it can message you.",
  unbot: "Bot disconnected. The agent is still reachable through your main assistant, and its tasks keep running.",
  paused: "Its tasks are paused. Nothing it has scheduled will run until you resume.",
  resumed: "Its tasks are running again. Repeating ones continue from their next time.",
};

/** "3 scheduled tasks" and a Pause / Resume button for one agent. */
function TasksControl({ agent, count }: { agent: Agent; count: number }) {
  return (
    <form action={setTasksPaused} className="flex flex-wrap items-center gap-3 text-sm">
      <input type="hidden" name="agentId" value={agent.id} />
      <input type="hidden" name="paused" value={agent.tasksPaused ? "false" : "true"} />
      {agent.tasksPaused ? (
        <Badge tone="warning">tasks paused</Badge>
      ) : (
        <span className="text-muted">
          {count === 0 ? "No scheduled tasks" : `${count} scheduled ${count === 1 ? "task" : "tasks"}`}
        </span>
      )}
      {(count > 0 || agent.tasksPaused) && (
        <Button type="submit" size="sm" variant={agent.tasksPaused ? "primary" : "ghost"}>
          {agent.tasksPaused ? "▶ Resume tasks" : "⏸ Pause tasks"}
        </Button>
      )}
    </form>
  );
}

export default async function AgentsPage({ searchParams }: PageProps<"/agents">) {
  const session = await requireActiveUser();
  const userId = session.user.id;
  const [primary, params] = await Promise.all([ensurePrimaryAgent(userId), searchParams]);
  const [all, jobs] = await Promise.all([listAgents(userId), listJobs(userId)]);
  const specialists = all.filter((a) => a.role === "specialized");
  const taskCount = (agentId: string) => jobs.filter((j) => j.agentId === agentId).length;
  const main = all.find((a) => a.id === primary.id) ?? primary;
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;
  const saved = typeof params.saved === "string" ? SAVED[params.saved] : undefined;
  const atLimit = specialists.length >= MAX_SPECIALISTS;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-8">
      <PageHeader
        title="Agents"
        description="Your main agent answers everything and hands work to the others. Each other agent has one job, can be messaged with @name, and can have its own Telegram bot: its own chat, and its own voice in your group."
      />
      {error && <Notice tone="danger">{error}</Notice>}
      {saved && <Notice tone="success">{saved}</Notice>}

      <Card>
        <div className="flex items-start gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent font-semibold text-accent-foreground">
            {primary.name.slice(0, 1)}
          </span>
          <div className="flex flex-col gap-1">
            <p className="flex items-center gap-2 font-medium">
              {primary.name} <Badge tone="accent">main agent</Badge>
            </p>
            <p className="text-sm text-muted">
              Answers in your main Telegram chat and here in Chat. Remembers what you tell it, uses your connected
              accounts, schedules tasks, and creates new agents when you ask.
            </p>
            <TasksControl agent={main} count={taskCount(main.id)} />
          </div>
        </div>
      </Card>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          Specialists <span className="font-normal text-muted">({specialists.length} of {MAX_SPECIALISTS})</span>
        </h2>
        {specialists.length === 0 && (
          <p className="text-sm text-muted">None yet. Create one below, or ask your main agent in Telegram.</p>
        )}
        {specialists.map((agent) => (
          <Card key={agent.id}>
            <details className="group">
              <summary className="flex cursor-pointer list-none items-start gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent">
                  {agent.name.slice(0, 1)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {agent.name}
                    {agent.telegramBotUsername ? <Badge tone="accent">@{agent.telegramBotUsername}</Badge> : <Badge>no own bot</Badge>}
                  </span>
                  <span className="line-clamp-2 text-sm text-muted">{agent.description}</span>
                  {agent.tasksPaused && <Badge tone="warning">tasks paused</Badge>}
                </span>
                <span className="shrink-0 text-sm text-muted group-open:hidden">Edit</span>
                <span className="hidden shrink-0 text-sm text-muted group-open:inline">Close</span>
              </summary>

              <section className="mt-5 flex flex-col gap-2 border-t border-line pt-5" aria-label="Scheduled tasks">
                <h3 className="text-sm font-medium">Scheduled tasks</h3>
                <TasksControl agent={agent} count={taskCount(agent.id)} />
              </section>

              <section className="mt-5 flex flex-col gap-3 border-t border-line pt-5" aria-label="Telegram bot">
                <h3 className="text-sm font-medium">Its own Telegram bot</h3>
                {agent.telegramBotUsername ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={`https://t.me/${agent.telegramBotUsername}`}
                      target="_blank"
                      rel="noreferrer"
                      className={buttonClass("primary", "sm")}
                    >
                      Open @{agent.telegramBotUsername}
                    </a>
                    <form action={disconnectBot}>
                      <input type="hidden" name="agentId" value={agent.id} />
                      <Button type="submit" size="sm" variant="ghost">
                        Disconnect bot
                      </Button>
                    </form>
                  </div>
                ) : (
                  <>
                    <ol className="list-decimal space-y-0.5 pl-5 text-sm text-muted">
                      <li>
                        In Telegram, open{" "}
                        <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="underline">
                          @BotFather
                        </a>{" "}
                        and send <code>/newbot</code>.
                      </li>
                      <li>Name it (e.g. “{agent.name}”) and pick a username ending in “bot”.</li>
                      <li>Paste the token it gives you here. The app names the bot and sets it up.</li>
                    </ol>
                    <form action={connectBot} className="flex flex-wrap gap-2">
                      <input type="hidden" name="agentId" value={agent.id} />
                      <input
                        name="token"
                        type="password"
                        autoComplete="off"
                        placeholder="123456789:AAH…"
                        aria-label={`Bot token for ${agent.name}`}
                        required
                        className={`${inputClass} min-w-0 flex-1`}
                      />
                      <Button type="submit" variant="primary">
                        Connect bot
                      </Button>
                    </form>
                  </>
                )}
              </section>

              <form action={editAgent} className="mt-5 flex flex-col gap-3 border-t border-line pt-5">
                <input type="hidden" name="agentId" value={agent.id} />
                <label className="flex flex-col gap-1.5 text-sm">
                  Name
                  <input name="name" defaultValue={agent.name} maxLength={MAX_AGENT_NAME_LENGTH} required className={inputClass} />
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  What it does
                  <textarea
                    name="description"
                    defaultValue={agent.description ?? ""}
                    maxLength={MAX_AGENT_DESCRIPTION_LENGTH}
                    rows={3}
                    required
                    className={inputClass}
                  />
                </label>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Button type="submit" variant="primary">
                    Save
                  </Button>
                  <details className="text-sm">
                    <summary className="cursor-pointer list-none text-danger">Delete agent…</summary>
                    <div className="mt-2 flex items-center gap-3">
                      <span className="text-muted">Also deletes its conversations, tasks and topic.</span>
                      <Button formAction={removeAgent} variant="danger" size="sm">
                        Yes, delete
                      </Button>
                    </div>
                  </details>
                </div>
              </form>
            </details>
          </Card>
        ))}
      </div>

      <Card title="New agent">
        {atLimit ? (
          <p className="text-sm text-muted">You&apos;ve reached {MAX_SPECIALISTS} agents. Delete one to add another.</p>
        ) : (
          <form action={addAgent} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-sm">
              Name
              <input name="name" placeholder="Researcher, Travel Planner, Coach…" maxLength={MAX_AGENT_NAME_LENGTH} required className={inputClass} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              What it does
              <textarea
                name="description"
                placeholder="Finds and summarizes sources on any topic, with links."
                maxLength={MAX_AGENT_DESCRIPTION_LENGTH}
                rows={3}
                required
                className={inputClass}
              />
              <span className="text-xs text-muted">Your main agent reads this to decide when to hand it work.</span>
            </label>
            <Button type="submit" variant="primary" className="self-start">
              Create agent
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}
