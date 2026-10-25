import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import * as q from "@/lib/db/queries";
import { users } from "@/lib/db/schema";
import { agentBotToken, BotSetupError, connectAgentBot, disconnectAgentBot } from "./agent-bots";
import { botWebhookSecret, decryptToken, encryptToken } from "./secret-box";

vi.mock("@/lib/db", async () => (await import("@/test/db")).createTestDbModule());

const BOT_ID = "700100200";
const TOKEN = `${BOT_ID}:${"B".repeat(35)}`;

let getMe: Record<string, unknown>;
const botAnswering = (id: number, username: string) => {
  getMe = { ok: true, result: { id, is_bot: true, username } };
};
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => {
  const method = url.split("/").at(-1);
  if (method === "getMe") return Response.json(getMe);
  return Response.json({ ok: true, result: true });
});
const callsTo = (method: string) =>
  fetchMock.mock.calls
    .filter(([url]) => url.endsWith(`/${method}`))
    .map(([url, init]) => ({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> }));

async function seedAgent(email: string) {
  const [user] = await db.insert(users).values({ email }).returning();
  await q.ensurePrimaryAgent(user.id);
  const agent = await q.createAgent(user.id, { name: "Coach", soul: "You coach.", description: "Fitness plans" });
  return { userId: user.id, agent };
}

beforeEach(() => {
  getMe = { ok: true, result: { id: Number(BOT_ID), is_bot: true, username: "coach_eco_bot" } };
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("secret box", () => {
  it("round-trips a token and refuses one that was tampered with", () => {
    const sealed = encryptToken(TOKEN);
    expect(sealed).not.toContain(TOKEN);
    expect(decryptToken(sealed)).toBe(TOKEN);
    const [v, iv, tag, data] = sealed.split(".");
    expect(() => decryptToken([v, iv, tag, `x${data.slice(1)}`].join("."))).toThrow();
  });

  it("gives each bot its own webhook secret", () => {
    expect(botWebhookSecret("1")).not.toBe(botWebhookSecret("2"));
    expect(botWebhookSecret("1")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("connectAgentBot", () => {
  it("checks the token, points the bot at this app, names it and stores it encrypted", async () => {
    const { userId, agent } = await seedAgent("connect@example.com");

    const updated = await connectAgentBot(userId, agent, `  ${TOKEN} `);

    expect(callsTo("getMe")[0].url).toContain(`/bot${TOKEN}/`);
    expect(callsTo("setWebhook")[0].body).toEqual({
      url: `http://localhost:3000/api/telegram/bot/${BOT_ID}`,
      secret_token: botWebhookSecret(BOT_ID),
      allowed_updates: ["message", "callback_query"],
    });
    expect(callsTo("setMyName")[0].body).toEqual({ name: "Coach" });
    expect(updated).toMatchObject({ telegramBotId: BOT_ID, telegramBotUsername: "coach_eco_bot" });
    expect(updated.telegramBotToken).not.toContain(TOKEN);
    expect(agentBotToken(updated)).toBe(TOKEN);
  });

  it("refuses malformed tokens, tokens Telegram rejects and bots another agent has", async () => {
    const { userId, agent } = await seedAgent("refuse@example.com");
    const reason = (p: Promise<unknown>) => p.catch((err: unknown) => (err as BotSetupError).reason);
    const token = `700100300:${"C".repeat(35)}`;

    expect(await reason(connectAgentBot(userId, agent, "not a token"))).toBe("format");
    expect(await reason(connectAgentBot(userId, agent, `test:${"C".repeat(35)}`))).toBe("format");

    getMe = { ok: false, error_code: 401, description: "Unauthorized" };
    expect(await reason(connectAgentBot(userId, agent, token))).toBe("invalid");
    // A token whose bot isn't the one Telegram reports.
    botAnswering(1, "someone_else_bot");
    expect(await reason(connectAgentBot(userId, agent, token))).toBe("invalid");

    botAnswering(700100300, "taken_bot");
    const other = await seedAgent("other@example.com");
    await connectAgentBot(other.userId, other.agent, token);
    expect(await reason(connectAgentBot(userId, agent, token))).toBe("taken");
    expect((await q.getAgent(userId, agent.id))?.telegramBotId).toBeNull();
  });

  it("disconnecting removes the webhook and forgets the bot", async () => {
    const { userId, agent } = await seedAgent("disconnect@example.com");
    botAnswering(700100400, "gone_bot");
    const connected = await connectAgentBot(userId, agent, `700100400:${"D".repeat(35)}`);

    await disconnectAgentBot(userId, connected);

    expect(callsTo("deleteWebhook")).toHaveLength(1);
    expect(await q.getAgent(userId, agent.id)).toMatchObject({ telegramBotId: null, telegramBotToken: null });
  });
});
