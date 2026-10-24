import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { users, type Agent, type Chat, type Message, type ScheduledJob } from "@/lib/db/schema";
import * as q from "./index";

vi.mock("@/lib/db", async () => (await import("@/test/db")).createTestDbModule());

const MONTH = "2026-09";

type Fixture = {
  userId: string;
  agent: Agent;
  chat: Chat;
  message: Message;
  job: ScheduledJob;
};

async function seedUser(email: string): Promise<Fixture> {
  const [user] = await db.insert(users).values({ email }).returning();
  const agent = await q.ensurePrimaryAgent(user.id);
  const chat = await q.createChat(user.id, { agentId: agent.id, channel: "web" });
  const message = await q.addMessage(user.id, { chatId: chat.id, role: "user", content: `hi from ${email}` });
  const job = await q.createJob(user.id, {
    agentId: agent.id,
    cronExpression: "0 9 * * *",
    prompt: "daily brief",
    nextRunAt: new Date(Date.now() - 60_000),
  });
  await q.incrementUsage(user.id, MONTH, { inputTokens: 100, outputTokens: 50 });
  await q.setIntegrationAccess(user.id, "GMAIL", "read");
  return { userId: user.id, agent, chat, message, job };
}

let a: Fixture;
let b: Fixture;

beforeAll(async () => {
  a = await seedUser("alice@example.com");
  b = await seedUser("bob@example.com");
});

/** Asserts that B's data is exactly as seeded — nothing A did leaked through. */
async function expectBUntouched() {
  expect(await q.getAgent(b.userId, b.agent.id)).toEqual(b.agent);
  expect(await q.getChat(b.userId, b.chat.id)).toEqual(b.chat);
  expect(await q.getMessage(b.userId, b.message.id)).toEqual(b.message);
  expect(await q.getJob(b.userId, b.job.id)).toEqual(b.job);
  expect(await q.getUsage(b.userId, MONTH)).toMatchObject({
    inputTokens: 100,
    outputTokens: 50,
    messageCount: 1,
  });
  expect(await q.getUser(b.userId)).toMatchObject({ email: "bob@example.com", telegramChatId: null });
  expect(await q.listIntegrationAccess(b.userId)).toMatchObject([{ toolkit: "GMAIL", access: "read" }]);
}

describe("per-user isolation in lib/db/queries", () => {
  describe("reads", () => {
    it("users: getUser only returns self", async () => {
      expect((await q.getUser(a.userId))?.email).toBe("alice@example.com");
    });

    it("agents", async () => {
      expect(await q.getAgent(a.userId, b.agent.id)).toBeUndefined();
      expect((await q.getPrimaryAgent(a.userId))?.id).toBe(a.agent.id);
      const list = await q.listAgents(a.userId);
      expect(list.map((x) => x.id)).toEqual([a.agent.id]);
    });

    it("chats", async () => {
      expect(await q.getChat(a.userId, b.chat.id)).toBeUndefined();
      expect((await q.listChats(a.userId)).map((x) => x.id)).toEqual([a.chat.id]);
      expect(await q.listChats(a.userId, { agentId: b.agent.id })).toEqual([]);
    });

    it("messages", async () => {
      expect(await q.getMessage(a.userId, b.message.id)).toBeUndefined();
      expect(await q.listMessages(a.userId, b.chat.id)).toEqual([]);
      expect((await q.listMessages(a.userId, a.chat.id)).map((x) => x.id)).toEqual([a.message.id]);
    });

    it("jobs", async () => {
      expect(await q.getJob(a.userId, b.job.id)).toBeUndefined();
      expect((await q.listJobs(a.userId)).map((x) => x.id)).toEqual([a.job.id]);
    });

    it("usage", async () => {
      expect((await q.listUsage(a.userId)).every((u) => u.userId === a.userId)).toBe(true);
      expect((await q.getUsage(a.userId, MONTH))?.userId).toBe(a.userId);
    });

    it("integration access", async () => {
      expect((await q.listIntegrationAccess(a.userId)).every((x) => x.userId === a.userId)).toBe(true);
    });
  });

  describe("writes against the other user's rows are no-ops", () => {
    it("agents", async () => {
      expect(await q.updateAgent(a.userId, b.agent.id, { name: "pwned", soul: "x" })).toBeUndefined();
      expect(await q.deleteAgent(a.userId, b.agent.id)).toBe(false);
      await expectBUntouched();
    });

    it("chats", async () => {
      expect(await q.deleteChat(a.userId, b.chat.id)).toBe(false);
      await expectBUntouched();
    });

    it("messages", async () => {
      expect(await q.deleteMessage(a.userId, b.message.id)).toBe(false);
      await expectBUntouched();
    });

    it("jobs", async () => {
      expect(await q.updateJob(a.userId, b.job.id, { prompt: "pwned" })).toBeUndefined();
      expect(await q.setJobEnabled(a.userId, b.job.id, false)).toBeUndefined();
      expect(
        await q.markJobRun(a.userId, b.job.id, { lastRunAt: new Date(), nextRunAt: null }),
      ).toBeUndefined();
      expect(await q.deleteJob(a.userId, b.job.id)).toBe(false);
      await expectBUntouched();
    });

    it("jobs: claimJobSchedule can't claim another user's run", async () => {
      expect(
        await q.claimJobSchedule(a.userId, b.job.id, {
          expectedNextRunAt: b.job.nextRunAt!,
          nextRunAt: new Date("2030-01-01"),
        }),
      ).toBe(false);
      await expectBUntouched();
    });

    it("usage: incrementing A never touches B", async () => {
      await q.incrementUsage(a.userId, MONTH, { inputTokens: 1, outputTokens: 1 });
      expect((await q.getUsage(a.userId, MONTH))?.messageCount).toBe(2);
      await expectBUntouched();
    });

    it("integration access: A's changes never touch B", async () => {
      await q.setIntegrationAccess(a.userId, "GMAIL", "full");
      expect(await q.listIntegrationAccess(a.userId)).toMatchObject([{ toolkit: "GMAIL", access: "full" }]);
      await expectBUntouched();
    });

    it("users: A's updates only affect A", async () => {
      await q.updateUser(a.userId, { name: "Alice" });
      await q.setTelegramChatId(a.userId, "111");
      expect((await q.getUserByTelegramChatId("111"))?.id).toBe(a.userId);
      await expectBUntouched();
    });
  });

  describe("A cannot attach rows to B's agents or chats", () => {
    it("createChat with B's agent throws", async () => {
      await expect(q.createChat(a.userId, { agentId: b.agent.id, channel: "web" })).rejects.toThrow(
        q.NotFoundError,
      );
    });

    it("getOrCreateChat with B's agent throws", async () => {
      await expect(
        q.getOrCreateChat(a.userId, { agentId: b.agent.id, channel: "telegram" }),
      ).rejects.toThrow(q.NotFoundError);
    });

    it("addMessage into B's chat throws", async () => {
      await expect(
        q.addMessage(a.userId, { chatId: b.chat.id, role: "user", content: "hi" }),
      ).rejects.toThrow(q.NotFoundError);
    });

    it("createJob / updateJob with B's agent throws", async () => {
      await expect(
        q.createJob(a.userId, { agentId: b.agent.id, cronExpression: "* * * * *", prompt: "x" }),
      ).rejects.toThrow(q.NotFoundError);
      await expect(q.updateJob(a.userId, a.job.id, { agentId: b.agent.id })).rejects.toThrow(
        q.NotFoundError,
      );
    });

    it("B's data is still intact afterwards", async () => {
      await expectBUntouched();
      expect(await q.listMessages(b.userId, b.chat.id)).toHaveLength(1);
      expect(await q.listChats(b.userId)).toHaveLength(1);
      expect(await q.listJobs(b.userId)).toHaveLength(1);
    });
  });

  describe("invariants", () => {
    it("ensurePrimaryAgent is idempotent (one primary per user)", async () => {
      const again = await q.ensurePrimaryAgent(a.userId);
      expect(again.id).toBe(a.agent.id);
      expect((await q.listAgents(a.userId)).filter((x) => x.role === "primary")).toHaveLength(1);
    });

    it("claimJobSchedule is a compare-and-set: only the first caller wins", async () => {
      const job = await q.getJob(a.userId, a.job.id);
      const expectedNextRunAt = job!.nextRunAt!;
      const nextRunAt = new Date(expectedNextRunAt.getTime() + 60_000);

      expect(await q.claimJobSchedule(a.userId, a.job.id, { expectedNextRunAt, nextRunAt })).toBe(
        true,
      );
      // A second heartbeat sees the old value gone and backs off.
      expect(await q.claimJobSchedule(a.userId, a.job.id, { expectedNextRunAt, nextRunAt })).toBe(
        false,
      );
      expect((await q.getJob(a.userId, a.job.id))?.nextRunAt).toEqual(nextRunAt);
    });

    it("markJobRun without nextRunAt leaves the schedule alone", async () => {
      const before = await q.getJob(a.userId, a.job.id);
      const lastRunAt = new Date();
      const after = await q.markJobRun(a.userId, a.job.id, { lastRunAt });
      expect(after?.lastRunAt).toEqual(lastRunAt);
      expect(after?.nextRunAt).toEqual(before?.nextRunAt);
    });

    it("listDueJobs returns only identifiers for enabled, due jobs", async () => {
      const due = await q.listDueJobs(new Date());
      expect(due).toEqual(
        expect.arrayContaining([
          { id: a.job.id, userId: a.userId },
          { id: b.job.id, userId: b.userId },
        ]),
      );
      expect(Object.keys(due[0]).sort()).toEqual(["id", "userId"]);
    });
  });
});
