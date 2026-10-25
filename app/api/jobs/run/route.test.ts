import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BudgetExceededError, RateLimitError } from "@/lib/agents/errors";
import * as q from "@/lib/db/queries";
import { jobLockKey } from "@/lib/heartbeat/run-job";
import { qstashRequest, seedUser, signQStash } from "@/lib/heartbeat/testing";
import { POST } from "./route";

vi.mock("@/lib/db", async () => (await import("@/test/db")).createTestDbModule());
const fake = vi.hoisted(() => ({}) as ReturnType<typeof import("@/lib/heartbeat/testing").createFakeUpstash>);
vi.mock("@/lib/upstash", async (importOriginal) => {
  Object.assign(fake, (await import("@/lib/heartbeat/testing")).createFakeUpstash());
  return { ...(await importOriginal<typeof import("@/lib/upstash")>()), redis: fake.redis, qstash: fake.qstash, createRatelimit: fake.createRatelimit };
});
const agents = vi.hoisted(() => ({ runAgent: vi.fn() }));
vi.mock("@/lib/agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agents")>();
  // The worker is tested against the runAgent contract, not the agent itself: the real
  // implementation would call Anthropic, Composio and Supermemory.
  agents.runAgent.mockImplementation(async ({ message, chatId }) => ({
    text: message,
    chatId: chatId ?? "test-chat",
  }));
  return { ...actual, runAgent: agents.runAgent };
});

const PATH = "/api/jobs/run";
// The shared client (lib/telegram/api.ts) requires an ok:true envelope.
const telegram = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
  async () => new Response(JSON.stringify({ ok: true, result: {} })),
);
const sentTexts = () =>
  telegram.mock.calls.map(([, init]) => {
    const { chat_id, text } = JSON.parse(String(init?.body)) as { chat_id: string; text: string };
    return { chat_id, text };
  });

beforeEach(() => {
  vi.stubGlobal("fetch", telegram);
  telegram.mockClear();
  agents.runAgent.mockClear();
  fake.redis.store.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function seedJob(email: string, telegramChatId?: string) {
  const { user, agent } = await seedUser(email, { telegramChatId });
  const scheduledFor = new Date(Date.now() - 60_000);
  const next = new Date(Date.now() + 86_400_000);
  const job = await q.createJob(user.id, { agentId: agent.id, cronExpression: "0 9 * * *", prompt: `brief for ${email}`, nextRunAt: next });
  const message = { jobId: job.id, userId: user.id, scheduledFor: scheduledFor.toISOString() };
  return { user, agent, job, message };
}

describe("POST /api/jobs/run: signature", () => {
  it("rejects unsigned and mis-signed requests without running anything", async () => {
    const { message } = await seedJob("sig@example.com");
    const body = JSON.stringify(message);
    for (const signature of [null, "nope", signQStash(body, `${process.env.APP_URL}${PATH}`, "wrong-key"), signQStash(body, `${process.env.APP_URL}/api/cron/heartbeat`)]) {
      const res = await POST(qstashRequest(PATH, message, { signature }));
      expect(res.status).toBe(401);
    }
    expect(agents.runAgent).not.toHaveBeenCalled();
    expect(fake.redis.set).not.toHaveBeenCalledWith(jobLockKey(message.jobId), expect.anything(), expect.anything());
  });

  it("rejects a malformed payload with 400", async () => {
    const res = await POST(qstashRequest(PATH, { jobId: "x" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/jobs/run: running", () => {
  it("runs the job's agent on the scheduled channel, records last_run_at and sends to Telegram", async () => {
    const { user, agent, job, message } = await seedJob("happy@example.com", "tg-happy");
    const res = await POST(qstashRequest(PATH, message));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ran" });
    expect(agents.runAgent).toHaveBeenCalledWith({
      userId: user.id, agentId: agent.id, message: job.prompt, channel: "scheduled",
    });
    const saved = (await q.getJob(user.id, job.id))!;
    expect(saved.lastRunAt).not.toBeNull();
    expect(saved.nextRunAt).toEqual(job.nextRunAt);
    expect(sentTexts()).toEqual([{ chat_id: "tg-happy", text: job.prompt }]); // faked runAgent echoes
    expect(fake.redis.store.has(jobLockKey(job.id))).toBe(false); // lock released
  });

  it("labels a specialist's result with its name", async () => {
    const { user } = await seedUser("specialist@example.com", { telegramChatId: "tg-spec" });
    const coach = await q.createAgent(user.id, { name: "Coach", soul: "You coach." });
    const job = await q.createJob(user.id, {
      agentId: coach.id,
      cronExpression: "0 9 * * *",
      prompt: "weekly check-in",
      nextRunAt: new Date(Date.now() + 86_400_000),
    });
    const scheduledFor = new Date(Date.now() - 60_000).toISOString();

    await POST(qstashRequest(PATH, { jobId: job.id, userId: user.id, scheduledFor }));

    expect(sentTexts()).toEqual([{ chat_id: "tg-spec", text: "<b>Coach</b>\nweekly check-in" }]);
  });

  it("sends a specialist's result to its own topic, or to the main chat if that topic is gone", async () => {
    const { user } = await seedUser("topic@example.com", { telegramChatId: "tg-topic" });
    const coach = await q.createAgent(user.id, { name: "Coach", soul: "You coach." });
    await q.updateAgent(user.id, coach.id, { telegramTopicId: 42 });
    const run = async () => {
      const job = await q.createJob(user.id, {
        agentId: coach.id, cronExpression: "0 9 * * *", prompt: "check-in", nextRunAt: new Date(Date.now() + 86_400_000),
      });
      await POST(qstashRequest(PATH, { jobId: job.id, userId: user.id, scheduledFor: new Date(Date.now() - 60_000).toISOString() }));
    };
    const bodies = () => telegram.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);

    await run();
    expect(bodies()).toEqual([expect.objectContaining({ chat_id: "tg-topic", text: "check-in", message_thread_id: 42 })]);

    telegram.mockClear();
    telegram.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: message thread not found" }), { status: 400 }),
    );
    await run();
    expect(bodies()).toEqual([
      expect.objectContaining({ message_thread_id: 42 }),
      { chat_id: "tg-topic", text: "<b>Coach</b>\ncheck-in", parse_mode: "HTML", link_preview_options: { is_disabled: true } },
    ]);
    expect((await q.getAgent(user.id, coach.id))?.telegramTopicId).toBeNull();
  });

  it("does not send anything to Telegram when the user hasn't linked it", async () => {
    const { message } = await seedJob("nolink@example.com");
    const res = await POST(qstashRequest(PATH, message));
    expect(await res.json()).toMatchObject({ status: "ran" });
    expect(telegram).not.toHaveBeenCalled();
  });

  it("the lock prevents concurrent deliveries of the same job from running twice", async () => {
    const { message } = await seedJob("lock@example.com", "tg-lock");
    let release!: () => void;
    agents.runAgent.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({ text: "done", chatId: "c1" }))),
    );

    const first = POST(qstashRequest(PATH, message));
    await vi.waitFor(() => expect(agents.runAgent).toHaveBeenCalledTimes(1));
    const second = await POST(qstashRequest(PATH, message));
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ status: "locked" });

    release();
    expect(await (await first).json()).toMatchObject({ status: "ran" });
    expect(agents.runAgent).toHaveBeenCalledTimes(1);
  });

  it("a redelivery after a finished run is skipped", async () => {
    const { message } = await seedJob("redeliver@example.com");
    await POST(qstashRequest(PATH, message));
    const again = await POST(qstashRequest(PATH, message));
    expect(await again.json()).toEqual({ status: "skipped", reason: "already_ran" });
    expect(agents.runAgent).toHaveBeenCalledTimes(1);
  });

  it("skips paused and deleted jobs", async () => {
    const paused = await seedJob("paused@example.com");
    await q.setJobEnabled(paused.user.id, paused.job.id, false);
    expect(await (await POST(qstashRequest(PATH, paused.message))).json()).toEqual({ status: "skipped", reason: "disabled" });

    const gone = await seedJob("gone@example.com");
    await q.deleteJob(gone.user.id, gone.job.id);
    expect(await (await POST(qstashRequest(PATH, gone.message))).json()).toEqual({ status: "skipped", reason: "not_found" });
    expect(agents.runAgent).not.toHaveBeenCalled();
  });

  it("can't run another user's job by forging the userId", async () => {
    const victim = await seedJob("victim@example.com");
    const attacker = await seedJob("attacker@example.com");
    const res = await POST(qstashRequest(PATH, { ...victim.message, userId: attacker.user.id }));
    expect(await res.json()).toEqual({ status: "skipped", reason: "not_found" });
    expect(agents.runAgent).not.toHaveBeenCalled();
  });

  it("returns 500 on unexpected errors so QStash retries, and releases the lock", async () => {
    const { job, message } = await seedJob("boom@example.com");
    agents.runAgent.mockRejectedValueOnce(new Error("model down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(qstashRequest(PATH, message));
    expect(res.status).toBe(500);
    expect(fake.redis.store.has(jobLockKey(job.id))).toBe(false);
    expect((await q.getJob(message.userId, job.id))!.lastRunAt).toBeNull();
  });
});

describe("POST /api/jobs/run: one-offs", () => {
  async function seedOneOff(email: string, kind: "once" | "reminder", prompt: string) {
    const { user, agent } = await seedUser(email, { telegramChatId: `tg-${email}` });
    const job = await q.createJob(user.id, {
      agentId: agent.id, kind, cronExpression: "0 15 25 10 *", prompt, nextRunAt: null,
    });
    const message = { jobId: job.id, userId: user.id, scheduledFor: new Date(Date.now() - 60_000).toISOString() };
    return { user, job, message };
  }

  it("a reminder sends its text verbatim without running an agent, then is gone", async () => {
    const { user, job, message } = await seedOneOff("remind@example.com", "reminder", "Call mom");

    const res = await POST(qstashRequest(PATH, message));

    expect(await res.json()).toEqual({ status: "reminded" });
    expect(agents.runAgent).not.toHaveBeenCalled();
    expect(sentTexts()).toEqual([{ chat_id: "tg-remind@example.com", text: "⏰ Call mom" }]);
    expect(await q.getJob(user.id, job.id)).toBeUndefined();
  });

  it("a one-off task runs the agent once and is then deleted", async () => {
    const { user, job, message } = await seedOneOff("once@example.com", "once", "check flights");

    expect(await (await POST(qstashRequest(PATH, message))).json()).toMatchObject({ status: "ran" });

    expect(agents.runAgent).toHaveBeenCalledTimes(1);
    expect(sentTexts()).toEqual([{ chat_id: "tg-once@example.com", text: "check flights" }]);
    expect(await q.getJob(user.id, job.id)).toBeUndefined();
    // QStash redelivering the same message finds nothing to run.
    expect(await (await POST(qstashRequest(PATH, message))).json()).toMatchObject({ reason: "not_found" });
  });
});

describe("POST /api/jobs/run: budget and rate limits", () => {
  it("budget exceeded skips the run, returns 200 and notifies via Telegram at most once per day", async () => {
    const { user, job, message } = await seedJob("broke@example.com", "tg-broke");
    agents.runAgent
      .mockRejectedValueOnce(new BudgetExceededError())
      .mockRejectedValueOnce(new BudgetExceededError());

    const res = await POST(qstashRequest(PATH, message));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "skipped", reason: "budget_exceeded", notified: true });
    expect((await q.getJob(user.id, job.id))!.lastRunAt).toBeNull();
    expect(sentTexts()).toEqual([
      { chat_id: "tg-broke", text: expect.stringContaining(new BudgetExceededError().userMessage) },
    ]);

    // A second job for the same user the same day: still skipped, but no second notice.
    const other = await q.createJob(user.id, { agentId: job.agentId, cronExpression: "0 * * * *", prompt: "hourly", nextRunAt: job.nextRunAt });
    const res2 = await POST(qstashRequest(PATH, { ...message, jobId: other.id }));
    expect(res2.status).toBe(200);
    expect(await res2.json()).toEqual({ status: "skipped", reason: "budget_exceeded", notified: false });
    expect(telegram).toHaveBeenCalledTimes(1);
  });

  it("rate limited skips the run with 200 and notifies", async () => {
    const { message } = await seedJob("fast@example.com", "tg-fast");
    agents.runAgent.mockRejectedValueOnce(new RateLimitError(30));
    const res = await POST(qstashRequest(PATH, message));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "skipped", reason: "rate_limited", notified: true });
    expect(sentTexts()[0].text).toContain("try again in 30 seconds");
  });
});
