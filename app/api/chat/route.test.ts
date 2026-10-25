import { beforeEach, describe, expect, it, vi } from "vitest";
import { BudgetExceededError, ServiceUnavailableError } from "@/lib/agents/errors";
import { db } from "@/lib/db";
import * as q from "@/lib/db/queries";
import { users } from "@/lib/db/schema";
import { POST, type ChatEvent } from "./route";

vi.mock("@/lib/db", async () => (await import("@/test/db")).createTestDbModule());
const mocks = vi.hoisted(() => ({ auth: vi.fn(), runAgent: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/agents", () => ({ runAgent: mocks.runAgent }));

async function seedUser(email: string) {
  const [user] = await db.insert(users).values({ email }).returning();
  const primary = await q.ensurePrimaryAgent(user.id);
  mocks.auth.mockResolvedValue({ user: { id: user.id, status: "active" } });
  return { userId: user.id, primary };
}

const post = (body: unknown) =>
  POST(new Request("https://example.com/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

/** Reads the whole NDJSON stream. */
async function events(res: Response): Promise<ChatEvent[]> {
  const text = await res.text();
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as ChatEvent);
}

beforeEach(() => {
  mocks.runAgent.mockReset().mockImplementation(async ({ chatId }) => ({ text: "hello back", chatId }));
});

describe("POST /api/chat", () => {
  it("starts a new conversation with the chosen agent and streams the reply", async () => {
    const { userId } = await seedUser("stream@example.com");
    const coach = await q.createAgent(userId, { name: "Coach", soul: "You coach." });
    mocks.runAgent.mockImplementation(async ({ chatId, onPartialText, onDelegate }) => {
      onPartialText("hel");
      onDelegate({ id: "x", name: "Researcher" });
      return { text: "hello back", chatId };
    });

    const res = await post({ message: "hi", agentId: coach.id });

    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    const [first, ...rest] = await events(res);
    expect(first.type).toBe("chat");
    const chatId = (first as { chatId: string }).chatId;
    expect(await q.getChat(userId, chatId)).toMatchObject({ agentId: coach.id, channel: "web" });
    expect(rest).toEqual([
      { type: "partial", text: "hel" },
      { type: "delegate", name: "Researcher" },
      { type: "done", text: "hello back" },
    ]);
    expect(mocks.runAgent).toHaveBeenCalledWith(expect.objectContaining({ userId, chatId, message: "hi", channel: "web" }));
  });

  it("continues a conversation, and sends photos to the agent as images", async () => {
    const { userId, primary } = await seedUser("photos-web@example.com");
    const chat = await q.createChat(userId, { agentId: primary.id, channel: "telegram" });

    await events(await post({ message: "", chatId: chat.id, images: [{ data: Buffer.from("img").toString("base64"), mediaType: "image/jpeg" }] }));

    const input = mocks.runAgent.mock.calls[0][0];
    expect(input.chatId).toBe(chat.id);
    expect(input.images).toEqual([{ data: Buffer.from("img"), mediaType: "image/jpeg" }]);
  });

  it("offers tasks the agent scheduled, and reports agent errors as messages", async () => {
    const { userId, primary } = await seedUser("tasks-web@example.com");
    const job = await q.createJob(userId, { agentId: primary.id, cronExpression: "0 9 * * *", prompt: "Check inbox", enabled: false });
    mocks.runAgent.mockImplementationOnce(async ({ chatId, onTaskScheduled }) => {
      onTaskScheduled({ id: job.id });
      return { text: "Set.", chatId };
    });

    expect(await events(await post({ message: "every day at 9 check my inbox" }))).toContainEqual({
      type: "task",
      id: job.id,
      title: "Check inbox",
      when: "Every day at 09:00",
    });

    mocks.runAgent.mockRejectedValueOnce(new BudgetExceededError());
    expect((await events(await post({ message: "hi" }))).at(-1)).toEqual({
      type: "error",
      message: new BudgetExceededError().userMessage,
    });
    mocks.runAgent.mockRejectedValueOnce(new ServiceUnavailableError("credit"));
    expect((await events(await post({ message: "hi" }))).at(-1)).toMatchObject({ message: expect.stringMatching(/out of credit/) });
  });

  it("can't start a conversation with someone else's agent", async () => {
    const other = await seedUser("other-web@example.com");
    const coach = await q.createAgent(other.userId, { name: "Coach", soul: "You coach." });
    await seedUser("me-web@example.com");

    expect((await post({ message: "hi", agentId: coach.id })).status).toBe(404);
    expect(mocks.runAgent).not.toHaveBeenCalled();
  });

  it("rejects signed-out and waitlisted callers, and empty messages", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await post({ message: "hi" })).status).toBe(401);
    mocks.auth.mockResolvedValue({ user: { id: "u", status: "waitlist" } });
    expect((await post({ message: "hi" })).status).toBe(403);
    await seedUser("empty-web@example.com");
    expect((await post({ message: "   " })).status).toBe(400);
    expect((await post({ message: "x".repeat(8001) })).status).toBe(400);
    expect(mocks.runAgent).not.toHaveBeenCalled();
  });
});
