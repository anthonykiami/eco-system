import { describe, expect, it, vi } from "vitest";
import { NotFoundError, updateUser } from "@/lib/db/queries";
import {
  createUserJob,
  deleteUserJob,
  listUserJobs,
  pauseUserJob,
  rescheduleUserJobs,
  resumeUserJob,
  runUserJobNow,
} from "./jobs";
import { InvalidScheduleError } from "./schedule";
import { seedUser } from "./testing";

vi.mock("@/lib/db", async () => (await import("@/test/db")).createTestDbModule());

const localTime = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

describe("lib/heartbeat user job helpers", () => {
  it("create computes next_run_at in the user's timezone", async () => {
    const { user, agent } = await seedUser("berlin@example.com", { timezone: "Europe/Berlin" });
    const job = await createUserJob(user.id, { agentId: agent.id, cronExpression: "30 7 * * 1-5", prompt: "news" });
    expect(job.enabled).toBe(true);
    expect(job.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    expect(localTime(job.nextRunAt!, "Europe/Berlin")).toBe("07:30");
  });

  it("create rejects invalid cron and agents the user doesn't own", async () => {
    const a = await seedUser("a-jobs@example.com");
    const b = await seedUser("b-jobs@example.com");
    await expect(createUserJob(a.user.id, { agentId: a.agent.id, cronExpression: "nope", prompt: "x" }))
      .rejects.toBeInstanceOf(InvalidScheduleError);
    await expect(createUserJob(a.user.id, { agentId: b.agent.id, cronExpression: "0 9 * * *", prompt: "x" }))
      .rejects.toBeInstanceOf(NotFoundError);
  });

  it("list, pause, resume and delete only touch the caller's jobs", async () => {
    const a = await seedUser("a2-jobs@example.com");
    const b = await seedUser("b2-jobs@example.com");
    const job = await createUserJob(a.user.id, { agentId: a.agent.id, cronExpression: "0 9 * * *", prompt: "x" });

    expect((await listUserJobs(a.user.id)).map((j) => j.id)).toEqual([job.id]);
    expect(await listUserJobs(b.user.id)).toEqual([]);

    expect(await pauseUserJob(b.user.id, job.id)).toBeUndefined();
    expect(await resumeUserJob(b.user.id, job.id)).toBeUndefined();
    expect(await deleteUserJob(b.user.id, job.id)).toBe(false);

    expect(await pauseUserJob(a.user.id, job.id)).toMatchObject({ enabled: false });
    const resumed = await resumeUserJob(a.user.id, job.id);
    expect(resumed).toMatchObject({ enabled: true });
    expect(resumed!.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    expect(await deleteUserJob(a.user.id, job.id)).toBe(true);
    expect(await listUserJobs(a.user.id)).toEqual([]);
  });

  it("run now makes only the caller's enabled job due immediately", async () => {
    const a = await seedUser("a3-jobs@example.com");
    const b = await seedUser("b3-jobs@example.com");
    const job = await createUserJob(a.user.id, { agentId: a.agent.id, cronExpression: "0 9 * * *", prompt: "x" });

    expect(await runUserJobNow(b.user.id, job.id)).toBeUndefined();
    const due = await runUserJobNow(a.user.id, job.id);
    expect(due!.nextRunAt!.getTime()).toBeLessThanOrEqual(Date.now());

    await pauseUserJob(a.user.id, job.id);
    expect(await runUserJobNow(a.user.id, job.id)).toBeUndefined();
  });

  it("reschedule moves enabled jobs to the user's new timezone", async () => {
    const { user, agent } = await seedUser("move-jobs@example.com", { timezone: "Europe/Berlin" });
    const job = await createUserJob(user.id, { agentId: agent.id, cronExpression: "0 7 * * *", prompt: "x" });

    await updateUser(user.id, { timezone: "America/Los_Angeles" });
    await rescheduleUserJobs(user.id);

    const [moved] = await listUserJobs(user.id);
    expect(moved.id).toBe(job.id);
    expect(localTime(moved.nextRunAt!, "America/Los_Angeles")).toBe("07:00");
  });
});
