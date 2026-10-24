import { beforeEach, describe, expect, it, vi } from "vitest";
import * as q from "@/lib/db/queries";
import { signQStash, qstashRequest, seedUser } from "@/lib/heartbeat/testing";
import { POST } from "./route";

vi.mock("@/lib/db", async () => (await import("@/test/db")).createTestDbModule());
const fake = vi.hoisted(() => ({}) as ReturnType<typeof import("@/lib/heartbeat/testing").createFakeUpstash>);
vi.mock("@/lib/upstash", async (importOriginal) => {
  Object.assign(fake, (await import("@/lib/heartbeat/testing")).createFakeUpstash());
  return { ...(await importOriginal<typeof import("@/lib/upstash")>()), redis: fake.redis, qstash: fake.qstash, createRatelimit: fake.createRatelimit };
});

const PATH = "/api/cron/heartbeat";
const url = `${process.env.APP_URL}${PATH}`;
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

beforeEach(() => {
  fake.qstash.publishJSON.mockClear();
});

describe("POST /api/cron/heartbeat: signature", () => {
  it.each([
    ["missing", null],
    ["garbage", "not-a-jwt"],
    ["wrong key", signQStash("{}", url, "some-other-key")],
    ["wrong url", signQStash("{}", `${process.env.APP_URL}/api/jobs/run`)],
    ["tampered body", signQStash('{"x":1}', url)],
  ])("rejects a %s signature with 401 and publishes nothing", async (_, signature) => {
    await seedUser(`sig-${crypto.randomUUID()}@example.com`).then(({ user, agent }) =>
      q.createJob(user.id, { agentId: agent.id, cronExpression: "0 9 * * *", prompt: "p", nextRunAt: minutesAgo(1) }),
    );
    const res = await POST(qstashRequest(PATH, {}, { signature }));
    expect(res.status).toBe(401);
    expect(fake.qstash.publishJSON).not.toHaveBeenCalled();
  });
});

describe("POST /api/cron/heartbeat: fan-out", () => {
  it("publishes one message per due job and advances next_run_at in the owner's timezone", async () => {
    // Drain anything left due by earlier tests.
    await POST(qstashRequest(PATH, {}));
    fake.qstash.publishJSON.mockClear();

    const ny = await seedUser("ny@example.com", { timezone: "America/New_York" });
    const tokyo = await seedUser("tokyo@example.com", { timezone: "Asia/Tokyo" });
    const nyDue = await q.createJob(ny.user.id, {
      agentId: ny.agent.id, cronExpression: "0 9 * * *", prompt: "ny", nextRunAt: minutesAgo(3),
    });
    const tokyoDue = await q.createJob(tokyo.user.id, {
      agentId: tokyo.agent.id, cronExpression: "0 9 * * *", prompt: "tokyo", nextRunAt: minutesAgo(1),
    });
    const future = await q.createJob(ny.user.id, {
      agentId: ny.agent.id, cronExpression: "0 9 * * *", prompt: "later", nextRunAt: new Date(Date.now() + 3_600_000),
    });
    const paused = await q.createJob(tokyo.user.id, {
      agentId: tokyo.agent.id, cronExpression: "0 9 * * *", prompt: "paused", enabled: false, nextRunAt: minutesAgo(5),
    });
    const broken = await q.createJob(ny.user.id, {
      agentId: ny.agent.id, cronExpression: "every tuesday", prompt: "bad", nextRunAt: minutesAgo(2),
    });

    const res = await POST(qstashRequest(PATH, {}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ published: 2, disabled: 1, failed: 0 });

    expect(fake.qstash.publishJSON).toHaveBeenCalledTimes(2);
    const calls = fake.qstash.publishJSON.mock.calls.map(([req]) => req as {
      url: string; body: { jobId: string; userId: string; scheduledFor: string }; deduplicationId: string;
    });
    expect(calls.map((c) => c.body.jobId).sort()).toEqual([nyDue.id, tokyoDue.id].sort());
    for (const c of calls) {
      expect(c.url).toBe(`${process.env.APP_URL}/api/jobs/run`);
      expect(c.deduplicationId).toContain(c.body.jobId);
    }
    expect(calls.find((c) => c.body.jobId === nyDue.id)?.body).toEqual({
      jobId: nyDue.id, userId: ny.user.id, scheduledFor: nyDue.nextRunAt!.toISOString(),
    });

    // next_run_at moved to the next 09:00 in each owner's own timezone.
    const nyNext = (await q.getJob(ny.user.id, nyDue.id))!.nextRunAt!;
    const tokyoNext = (await q.getJob(tokyo.user.id, tokyoDue.id))!.nextRunAt!;
    expect(nyNext.getTime()).toBeGreaterThan(Date.now());
    expect(tokyoNext.getTime()).toBeGreaterThan(Date.now());
    expect(hourIn(nyNext, "America/New_York")).toBe("09:00");
    expect(hourIn(tokyoNext, "Asia/Tokyo")).toBe("09:00");

    // Untouched / disabled rows.
    expect((await q.getJob(ny.user.id, future.id))!.nextRunAt).toEqual(future.nextRunAt);
    expect((await q.getJob(tokyo.user.id, paused.id))!.nextRunAt).toEqual(paused.nextRunAt);
    expect(await q.getJob(ny.user.id, broken.id)).toMatchObject({ enabled: false, nextRunAt: null });

    // A second tick right after enqueues nothing: jobs are not queued twice.
    fake.qstash.publishJSON.mockClear();
    const again = await POST(qstashRequest(PATH, {}));
    expect(await again.json()).toEqual({ published: 0, disabled: 0, failed: 0 });
    expect(fake.qstash.publishJSON).not.toHaveBeenCalled();
  });

  it("leaves a job due if publishing fails, so the next tick retries it", async () => {
    const { user, agent } = await seedUser("flaky@example.com");
    const job = await q.createJob(user.id, {
      agentId: agent.id, cronExpression: "*/5 * * * *", prompt: "p", nextRunAt: minutesAgo(1),
    });
    fake.qstash.publishJSON.mockRejectedValueOnce(new Error("qstash down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(qstashRequest(PATH, {}));
    expect(await res.json()).toMatchObject({ failed: 1 });
    expect((await q.getJob(user.id, job.id))!.nextRunAt).toEqual(job.nextRunAt);
  });
});

describe("POST /api/cron/heartbeat: one-offs", () => {
  const jobIdOf = (req: unknown) => (req as { body: { jobId: string } }).body.jobId;
  const publishedFor = (jobId: string) => fake.qstash.publishJSON.mock.calls.filter(([req]) => jobIdOf(req) === jobId);

  it("publishes a due one-off once and never again, and hands it back if publishing fails", async () => {
    const { user, agent } = await seedUser("oneoff@example.com");
    const job = await q.createJob(user.id, {
      agentId: agent.id, kind: "reminder", cronExpression: "0 15 25 10 *", prompt: "call mom", nextRunAt: minutesAgo(1),
    });

    const publish = fake.qstash.publishJSON.getMockImplementation()!;
    fake.qstash.publishJSON.mockImplementation(async (req) => {
      if (jobIdOf(req) === job.id) throw new Error("qstash down");
      return publish(req);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await POST(qstashRequest(PATH, {}));
    expect((await q.getJob(user.id, job.id))!.nextRunAt).toEqual(job.nextRunAt);

    fake.qstash.publishJSON.mockImplementation(publish);
    fake.qstash.publishJSON.mockClear();
    await POST(qstashRequest(PATH, {}));
    expect(publishedFor(job.id)).toHaveLength(1);
    expect((await q.getJob(user.id, job.id))!.nextRunAt).toBeNull();

    await POST(qstashRequest(PATH, {}));
    expect(publishedFor(job.id)).toHaveLength(1);
  });
});

function hourIn(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}
