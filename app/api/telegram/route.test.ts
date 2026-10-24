import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BudgetExceededError, RateLimitError, runAgent } from "@/lib/agents";
import { listToolkitConnections } from "@/lib/agents/composio";
import { db } from "@/lib/db";
import * as q from "@/lib/db/queries";
import { getUser } from "@/lib/db/queries";
import { users, type UserStatus } from "@/lib/db/schema";
import { createLinkCode } from "@/lib/telegram/linking";
import * as msg from "@/lib/telegram/messages";
import type { TelegramUpdate } from "@/lib/telegram/types";
import { POST } from "./route";

const h = vi.hoisted(() => {
  type Entry = { value: unknown; expiresAt?: number };
  const store = new Map<string, Entry>();
  const live = (key: string) => {
    const entry = store.get(key);
    if (entry?.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
      store.delete(key);
      return undefined;
    }
    return entry;
  };

  /** In-memory stand-in for the Upstash commands the bot uses. TTLs follow Date.now(). */
  const redis = {
    store,
    async get(key: string) {
      return live(key)?.value ?? null;
    },
    async set(key: string, value: unknown, opts?: { nx?: boolean; ex?: number }) {
      if (opts?.nx && live(key)) return null;
      store.set(key, { value, expiresAt: opts?.ex ? Date.now() + opts.ex * 1000 : undefined });
      return "OK";
    },
    async getdel(key: string) {
      const value = live(key)?.value ?? null;
      store.delete(key);
      return value;
    },
    async del(...keys: string[]) {
      return keys.filter((k) => store.delete(k)).length;
    },
  };

  return { redis, pending: [] as Promise<unknown>[], linkAllowed: true };
});

vi.mock("@/lib/db", async () => (await import("@/test/db")).createTestDbModule());
vi.mock("@/lib/upstash", () => ({
  redis: h.redis,
  createRatelimit: () => ({ limit: async () => ({ success: h.linkAllowed }) }),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => {
    h.pending.push(Promise.resolve().then(task));
  },
}));
vi.mock("@/lib/agents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agents")>()),
  runAgent: vi.fn(),
}));
vi.mock("@/lib/agents/composio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/agents/composio")>()),
  listToolkitConnections: vi.fn(),
}));

const runAgentMock = vi.mocked(runAgent);
const listConnectionsMock = vi.mocked(listToolkitConnections);
const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
  async () =>
    new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }),
);

/**
 * "Latest chat" is ordered by created_at, which PGlite stores to the millisecond (Neon: microsecond).
 * Waiting a tick keeps chats created back to back from tying.
 */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

let nextUpdateId = 1;
let nextChatId = 1000;

const textUpdate = (
  chatId: number,
  text: string | undefined,
  type: "private" | "group" = "private",
): TelegramUpdate => ({
  update_id: nextUpdateId++,
  message: { message_id: 1, chat: { id: chatId, type }, text },
});

const buttonUpdate = (chatId: number, data: string, messageId = 77): TelegramUpdate => ({
  update_id: nextUpdateId++,
  callback_query: {
    id: `cb${nextUpdateId}`,
    data,
    message: { message_id: messageId, chat: { id: chatId, type: "private" } },
  },
});

/** POSTs to the webhook and waits for the after() work to finish. */
async function post(update: unknown, secret: string | null = "test-secret") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers["x-telegram-bot-api-secret-token"] = secret;
  const res = await POST(
    new Request("http://localhost/api/telegram", {
      method: "POST",
      headers,
      body: JSON.stringify(update),
    }),
  );
  await Promise.all(h.pending.splice(0));
  return res;
}

function calls(method: string) {
  return fetchMock.mock.calls
    .filter(([url]) => url.endsWith(`/${method}`))
    .map(([, init]) => JSON.parse(String(init.body)) as Record<string, unknown>);
}
const sentTexts = (chatId: number) =>
  calls("sendMessage")
    .filter((b) => b.chat_id === chatId)
    .map((b) => b.text as string);
const lastSent = (chatId: number) => sentTexts(chatId).at(-1) ?? "";
const editedTexts = (chatId: number) =>
  calls("editMessageText")
    .filter((b) => b.chat_id === chatId)
    .map((b) => b.text as string);
/** callback_data of every button on the last message sent to this chat. */
function lastButtons(chatId: number): { text: string; data?: string }[] {
  const body = calls("sendMessage").filter((b) => b.chat_id === chatId).at(-1);
  const markup = body?.reply_markup as { inline_keyboard: { text: string; callback_data?: string }[][] } | undefined;
  return (markup?.inline_keyboard.flat() ?? []).map((b) => ({ text: b.text, data: b.callback_data }));
}
const buttonData = (chatId: number, label: string | RegExp) =>
  lastButtons(chatId).find((b) => (typeof label === "string" ? b.text === label : label.test(b.text)))?.data;

async function seedUser(opts: { status?: UserStatus; telegramChatId?: number } = {}) {
  const [user] = await db
    .insert(users)
    .values({
      email: `user${nextChatId++}@example.com`,
      status: opts.status ?? "active",
      telegramChatId: opts.telegramChatId === undefined ? null : String(opts.telegramChatId),
      telegramLinkedAt: opts.telegramChatId === undefined ? null : new Date(),
    })
    .returning();
  return user;
}

beforeEach(() => {
  fetchMock.mockClear();
  runAgentMock.mockReset();
  runAgentMock.mockImplementation(async ({ message, chatId }) => ({
    text: `echo: ${message}`,
    chatId: chatId!,
  }));
  h.linkAllowed = true;
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("POST /api/telegram: request handling", () => {
  it("rejects a missing or wrong secret token without doing any work", async () => {
    const chatId = nextChatId++;
    for (const secret of [null, "wrong-secret", "test-secret-but-longer"]) {
      const res = await post(textUpdate(chatId, "hi"), secret);
      expect(res.status).toBe(401);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.redis.store.has(`tg:update:${nextUpdateId - 1}`)).toBe(false);
  });

  it("processes a duplicate update_id only once", async () => {
    const chatId = nextChatId++;
    await seedUser({ telegramChatId: chatId });
    const update = textUpdate(chatId, "hello");

    expect((await post(update)).status).toBe(200);
    expect((await post(update)).status).toBe(200);

    expect(runAgentMock).toHaveBeenCalledTimes(1);
    expect(sentTexts(chatId)).toEqual(["echo: hello"]);
    const entry = h.redis.store.get(`tg:update:${update.update_id}`);
    expect(entry?.expiresAt).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
  });

  it("answers 200 to malformed bodies so Telegram doesn't retry them", async () => {
    expect((await post({ nope: true })).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("linking", () => {
  it("links the chat with a valid /start code and confirms", async () => {
    const user = await seedUser();
    const chatId = nextChatId++;
    const { code, deepLink } = await createLinkCode(user.id);
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect(deepLink).toBe(`https://t.me/test_bot?start=${code}`);

    await post(textUpdate(chatId, `/start ${code}`));

    const linked = await getUser(user.id);
    expect(linked?.telegramChatId).toBe(String(chatId));
    expect(linked?.telegramLinkedAt).toBeInstanceOf(Date);
    expect(sentTexts(chatId)).toEqual([msg.LINK_SUCCESS]);
  });

  it("links with /link and accepts lower-case codes", async () => {
    const user = await seedUser();
    const chatId = nextChatId++;
    const { code } = await createLinkCode(user.id);

    await post(textUpdate(chatId, `/link ${code.toLowerCase()}`));

    expect((await getUser(user.id))?.telegramChatId).toBe(String(chatId));
  });

  it("rejects an expired code", async () => {
    const user = await seedUser();
    const chatId = nextChatId++;
    const { code } = await createLinkCode(user.id);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1);
    await post(textUpdate(chatId, `/start ${code}`));

    expect((await getUser(user.id))?.telegramChatId).toBeNull();
    expect(sentTexts(chatId)).toEqual([msg.LINK_INVALID_CODE]);
  });

  it("rejects a code that was already used", async () => {
    const user = await seedUser();
    const { code } = await createLinkCode(user.id);
    const firstChat = nextChatId++;
    const secondChat = nextChatId++;

    await post(textUpdate(firstChat, `/link ${code}`));
    await post(textUpdate(secondChat, `/link ${code}`));

    expect((await getUser(user.id))?.telegramChatId).toBe(String(firstChat));
    expect(sentTexts(secondChat)).toEqual([msg.LINK_INVALID_CODE]);
  });

  it("invalidates the previous code when a new one is generated", async () => {
    const user = await seedUser();
    const chatId = nextChatId++;
    const { code: oldCode } = await createLinkCode(user.id);
    await createLinkCode(user.id);

    await post(textUpdate(chatId, `/link ${oldCode}`));

    expect(sentTexts(chatId)).toEqual([msg.LINK_INVALID_CODE]);
  });

  it("won't link a chat that already belongs to another user", async () => {
    const chatId = nextChatId++;
    const owner = await seedUser({ telegramChatId: chatId });
    const other = await seedUser();
    const { code } = await createLinkCode(other.id);

    await post(textUpdate(chatId, `/link ${code}`));

    expect((await getUser(owner.id))?.telegramChatId).toBe(String(chatId));
    expect((await getUser(other.id))?.telegramChatId).toBeNull();
    expect(sentTexts(chatId)).toEqual([msg.LINK_CHAT_TAKEN]);
  });

  it("refuses to link group chats", async () => {
    const user = await seedUser();
    const chatId = -nextChatId++;
    const { code } = await createLinkCode(user.id);

    await post(textUpdate(chatId, `/link ${code}`, "group"));

    expect((await getUser(user.id))?.telegramChatId).toBeNull();
    expect(sentTexts(chatId)).toEqual([msg.LINK_PRIVATE_ONLY]);
  });

  it("throttles repeated link attempts", async () => {
    const chatId = nextChatId++;
    h.linkAllowed = false;

    await post(textUpdate(chatId, "/link ABCDEF"));

    expect(sentTexts(chatId)).toEqual([msg.LINK_TOO_MANY_ATTEMPTS]);
  });
});

describe("messages", () => {
  it("sends linking instructions to unlinked chats", async () => {
    const chatId = nextChatId++;

    await post(textUpdate(chatId, "hello?"));

    expect(runAgentMock).not.toHaveBeenCalled();
    const [text] = sentTexts(chatId);
    expect(text).toBe(msg.LINK_INSTRUCTIONS());
    expect(text).toContain("http://localhost:3000/settings/telegram");
  });

  it("tells waitlisted users they're on the waitlist", async () => {
    const chatId = nextChatId++;
    await seedUser({ status: "waitlist", telegramChatId: chatId });

    await post(textUpdate(chatId, "hello"));

    expect(runAgentMock).not.toHaveBeenCalled();
    expect(sentTexts(chatId)).toEqual([msg.WAITLIST]);
  });

  it("shows typing, runs the agent on the telegram channel, and replies in HTML", async () => {
    const chatId = nextChatId++;
    const user = await seedUser({ telegramChatId: chatId });
    runAgentMock.mockResolvedValueOnce({ text: "**Done** <ok>", chatId: "ignored" });

    await post(textUpdate(chatId, "do it"));

    expect(calls("sendChatAction")[0]).toEqual({ chat_id: chatId, action: "typing" });
    expect(runAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user.id, message: "do it", channel: "telegram" }),
    );
    expect(calls("sendMessage")).toEqual([
      expect.objectContaining({ chat_id: chatId, text: "<b>Done</b> &lt;ok&gt;", parse_mode: "HTML" }),
    ]);
  });

  it("keeps one ongoing chat per user and /new starts a fresh one", async () => {
    const chatId = nextChatId++;
    await seedUser({ telegramChatId: chatId });

    await post(textUpdate(chatId, "one"));
    await post(textUpdate(chatId, "two"));
    await tick();
    await post(textUpdate(chatId, "/new"));
    await post(textUpdate(chatId, "three"));

    const chatIds = runAgentMock.mock.calls.map(([input]) => input.chatId);
    expect(chatIds[0]).toBeTruthy();
    expect(chatIds[1]).toBe(chatIds[0]);
    expect(chatIds[2]).toBeTruthy();
    expect(chatIds[2]).not.toBe(chatIds[0]);
    expect(sentTexts(chatId)).toContain(msg.NEW_CHAT);
  });

  it("sends the friendly message when the user is rate limited", async () => {
    const chatId = nextChatId++;
    await seedUser({ telegramChatId: chatId });
    const err = new RateLimitError(30);
    runAgentMock.mockRejectedValueOnce(err);

    await post(textUpdate(chatId, "hi"));

    expect(sentTexts(chatId)).toEqual([err.userMessage]);
  });

  it("sends the friendly message when the budget is exceeded", async () => {
    const chatId = nextChatId++;
    await seedUser({ telegramChatId: chatId });
    const err = new BudgetExceededError();
    runAgentMock.mockRejectedValueOnce(err);

    await post(textUpdate(chatId, "hi"));

    expect(sentTexts(chatId)).toEqual([err.userMessage]);
  });

  it("sends a generic message for unexpected errors", async () => {
    const chatId = nextChatId++;
    await seedUser({ telegramChatId: chatId });
    runAgentMock.mockRejectedValueOnce(new Error("db exploded: secret details"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await post(textUpdate(chatId, "hi"));

    expect(sentTexts(chatId)).toEqual([msg.GENERIC_ERROR]);
    consoleError.mockRestore();
  });

  it("splits long replies into multiple messages under 4096 characters", async () => {
    const chatId = nextChatId++;
    await seedUser({ telegramChatId: chatId });
    const long = "word ".repeat(2000); // 10,000 chars
    runAgentMock.mockResolvedValueOnce({ text: long, chatId: "x" });

    await post(textUpdate(chatId, "long please"));

    const texts = sentTexts(chatId);
    expect(texts.length).toBe(3);
    for (const t of texts) expect(t.length).toBeLessThanOrEqual(4096);
    expect(texts.join(" ").trim()).toBe(long.trim());
  });

  it("falls back to plain text if Telegram rejects the HTML", async () => {
    const chatId = nextChatId++;
    await seedUser({ telegramChatId: chatId });
    runAgentMock.mockResolvedValueOnce({ text: "**bold**", chatId: "x" });
    fetchMock.mockImplementation(async (url, init) => {
      const body = JSON.parse(String(init.body));
      const rejected = url.endsWith("/sendMessage") && body.parse_mode === "HTML";
      return new Response(
        JSON.stringify(
          rejected
            ? { ok: false, error_code: 400, description: "Bad Request: can't parse entities" }
            : { ok: true, result: {} },
        ),
        { status: rejected ? 400 : 200 },
      );
    });

    await post(textUpdate(chatId, "hi"));

    expect(sentTexts(chatId)).toEqual(["<b>bold</b>", "bold"]);
    fetchMock.mockReset();
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }),
    );
  });

  it("asks for text when a linked user sends something else", async () => {
    const chatId = nextChatId++;
    await seedUser({ telegramChatId: chatId });

    await post(textUpdate(chatId, undefined));

    expect(runAgentMock).not.toHaveBeenCalled();
    expect(sentTexts(chatId)).toEqual([msg.TEXT_ONLY]);
  });
});

// ─── Talking to several agents ──────────────────────────────────────────────

async function seedWithSpecialist(name = "Researcher") {
  const chatId = nextChatId++;
  const user = await seedUser({ telegramChatId: chatId });
  const primary = await q.ensurePrimaryAgent(user.id);
  const specialist = await q.createAgent(user.id, { name, description: "Finds sources.", soul: "You research." });
  return { chatId, user, primary, specialist };
}

describe("several agents", () => {
  it("doesn't label replies while the user only has the main agent", async () => {
    const chatId = nextChatId++;
    await seedUser({ telegramChatId: chatId });

    await post(textUpdate(chatId, "hi"));

    expect(sentTexts(chatId)).toEqual(["echo: hi"]);
  });

  it("labels replies with the agent's name once there's more than one", async () => {
    const { chatId, primary } = await seedWithSpecialist();

    await post(textUpdate(chatId, "hi"));

    expect(sentTexts(chatId)).toEqual([`<b>${primary.name}</b>\necho: hi`]);
  });

  it("@name sends one message to that agent, in that agent's own chat", async () => {
    const { chatId, user, primary, specialist } = await seedWithSpecialist();

    await post(textUpdate(chatId, "@researcher find sleep papers"));
    await post(textUpdate(chatId, "thanks"));

    const [first, second] = runAgentMock.mock.calls.map(([input]) => input);
    expect(first.message).toBe("find sleep papers");
    expect((await q.getChat(user.id, first.chatId!))?.agentId).toBe(specialist.id);
    // The next plain message goes back to the main agent.
    expect((await q.getChat(user.id, second.chatId!))?.agentId).toBe(primary.id);
    expect(sentTexts(chatId)[0]).toBe("<b>Researcher</b>\necho: find sleep papers");
  });

  it("treats an @ that isn't one of their agents as an ordinary message", async () => {
    const { chatId } = await seedWithSpecialist();

    await post(textUpdate(chatId, "@someone said hi"));

    expect(runAgentMock.mock.calls[0][0].message).toBe("@someone said hi");
  });

  it("/talk switches every following message to that agent until /main", async () => {
    const { chatId, user, primary, specialist } = await seedWithSpecialist("Travel Planner");

    await post(textUpdate(chatId, "/talk travel"));
    expect(lastSent(chatId)).toContain("You're now talking to <b>Travel Planner</b>");
    await post(textUpdate(chatId, "plan lisbon"));
    await post(textUpdate(chatId, "/main"));
    await post(textUpdate(chatId, "hi again"));

    const agentIds = await Promise.all(
      runAgentMock.mock.calls.map(async ([input]) => (await q.getChat(user.id, input.chatId!))?.agentId),
    );
    expect(agentIds).toEqual([specialist.id, primary.id]);
  });

  it("/talk without a name offers a button per agent, and a bare @name also switches", async () => {
    const { chatId, specialist } = await seedWithSpecialist();

    await post(textUpdate(chatId, "/talk"));
    expect(lastButtons(chatId).map((b) => b.data)).toContain(`at:${specialist.id}`);

    await post(buttonUpdate(chatId, `at:${specialist.id}`));
    expect(lastSent(chatId)).toContain("now talking to <b>Researcher</b>");

    await post(textUpdate(chatId, "/main"));
    await post(textUpdate(chatId, "@researcher"));
    expect(lastSent(chatId)).toContain("now talking to <b>Researcher</b>");
    expect(runAgentMock).not.toHaveBeenCalled();
  });

  it("/talk with an unknown name lists the user's agents", async () => {
    const { chatId } = await seedWithSpecialist();

    await post(textUpdate(chatId, "/talk chef"));

    expect(lastSent(chatId)).toContain("You don't have an agent called “chef”");
    expect(lastSent(chatId)).toContain("<code>@researcher</code>");
  });

  it("/new starts a fresh conversation with the agent being talked to", async () => {
    const { chatId, user, specialist } = await seedWithSpecialist();

    await post(textUpdate(chatId, "/talk researcher"));
    await post(textUpdate(chatId, "one"));
    await tick();
    await post(textUpdate(chatId, "/new"));
    await post(textUpdate(chatId, "two"));

    const [one, two] = runAgentMock.mock.calls.map(([input]) => input.chatId);
    expect(two).not.toBe(one);
    expect((await q.getChat(user.id, two!))?.agentId).toBe(specialist.id);
    expect(sentTexts(chatId)).toContain("🆕 Started a new conversation with <b>Researcher</b>.");
  });

  it("announces a delegation before the main agent's reply", async () => {
    const { chatId, specialist } = await seedWithSpecialist();
    runAgentMock.mockImplementationOnce(async ({ chatId: id, onDelegate }) => {
      onDelegate?.({ id: specialist.id, name: specialist.name });
      onDelegate?.({ id: specialist.id, name: specialist.name });
      return { text: "Here's what Researcher found.", chatId: id! };
    });

    await post(textUpdate(chatId, "research sleep"));

    expect(sentTexts(chatId)).toEqual([
      "↪️ <i>Assistant asked Researcher to help…</i>",
      "<b>Assistant</b>\nHere's what Researcher found.",
    ]);
  });
});

// ─── Managing agents ────────────────────────────────────────────────────────

describe("managing agents", () => {
  it("/newagent asks for a name and a job, then creates a specialist", async () => {
    const chatId = nextChatId++;
    const user = await seedUser({ telegramChatId: chatId });

    await post(textUpdate(chatId, "/newagent"));
    expect(lastSent(chatId)).toBe(msg.ASK_AGENT_NAME);
    await post(textUpdate(chatId, "Travel Planner"));
    expect(lastSent(chatId)).toContain("What should <b>Travel Planner</b> do?");
    await post(textUpdate(chatId, "Plans trips and finds flights."));

    const created = (await q.listAgents(user.id)).find((a) => a.role === "specialized");
    expect(created).toMatchObject({ name: "Travel Planner", description: "Plans trips and finds flights." });
    expect(created?.soul).toContain("You are Travel Planner");
    expect(lastSent(chatId)).toContain("✅ Created <b>Travel Planner</b>");
    expect(lastSent(chatId)).toContain("@travel_planner");
    expect(runAgentMock).not.toHaveBeenCalled();
  });

  it("/newagent with a name skips straight to the job, and rejects taken or reserved names", async () => {
    const { chatId } = await seedWithSpecialist();

    await post(textUpdate(chatId, "/newagent researcher"));
    expect(lastSent(chatId)).toContain("You already have <b>Researcher</b>");
    await post(textUpdate(chatId, "Main"));
    expect(lastSent(chatId)).toBe(msg.NAME_RESERVED);
    await post(textUpdate(chatId, "Coach"));
    expect(lastSent(chatId)).toContain("What should <b>Coach</b> do?");
  });

  it("/cancel and other commands abandon a half-finished flow", async () => {
    const chatId = nextChatId++;
    const user = await seedUser({ telegramChatId: chatId });

    await post(textUpdate(chatId, "/newagent"));
    await post(textUpdate(chatId, "/cancel"));
    expect(lastSent(chatId)).toBe(msg.CANCELLED);
    await post(textUpdate(chatId, "Coach"));

    expect(runAgentMock).toHaveBeenCalledTimes(1);
    expect(await q.listAgents(user.id)).toHaveLength(1);

    await post(textUpdate(chatId, "/cancel"));
    expect(lastSent(chatId)).toBe(msg.NOTHING_TO_CANCEL);
  });

  it("/agents lists agents; their buttons rename, re-describe and delete", async () => {
    const { chatId, user, specialist } = await seedWithSpecialist();

    await post(textUpdate(chatId, "/agents"));
    expect(lastSent(chatId)).toContain("<b>Your agents</b>");
    await post(buttonUpdate(chatId, `a:${specialist.id}`));
    expect(editedTexts(chatId).at(-1)).toContain("<b>Researcher</b>");

    await post(buttonUpdate(chatId, `ar:${specialist.id}`));
    await post(textUpdate(chatId, "Scout"));
    let updated = await q.getAgent(user.id, specialist.id);
    expect(updated?.name).toBe("Scout");
    // A hand-written soul is left alone by a rename.
    expect(updated?.soul).toBe("You research.");

    await post(buttonUpdate(chatId, `ad:${specialist.id}`));
    await post(textUpdate(chatId, "Scouts restaurants."));
    updated = await q.getAgent(user.id, specialist.id);
    expect(updated?.description).toBe("Scouts restaurants.");
    expect(updated?.soul).toContain("You are Scout");

    await post(textUpdate(chatId, "/talk scout"));
    await post(buttonUpdate(chatId, `ax:${specialist.id}`));
    expect(await q.getAgent(user.id, specialist.id)).toBeDefined();
    await post(buttonUpdate(chatId, `ay:${specialist.id}`));
    expect(await q.getAgent(user.id, specialist.id)).toBeUndefined();

    // The deleted agent was active; messages fall back to the main agent.
    await post(textUpdate(chatId, "hi"));
    expect(lastSent(chatId)).toBe("echo: hi");
  });

  it("can't delete the main agent", async () => {
    const { chatId, user, primary } = await seedWithSpecialist();

    await post(buttonUpdate(chatId, `ay:${primary.id}`));

    expect(await q.getAgent(user.id, primary.id)).toBeDefined();
  });

  it("ignores button ids that belong to another user", async () => {
    const victim = await seedWithSpecialist();
    const attackerChat = nextChatId++;
    await seedUser({ telegramChatId: attackerChat });

    for (const data of [`ay:${victim.specialist.id}`, `ar:${victim.specialist.id}`, `at:${victim.specialist.id}`]) {
      await post(buttonUpdate(attackerChat, data));
    }

    expect(await q.getAgent(victim.user.id, victim.specialist.id)).toBeDefined();
    expect(sentTexts(attackerChat).every((t) => t === msg.STALE_BUTTON)).toBe(true);
    expect(calls("answerCallbackQuery")).not.toHaveLength(0);
  });

  it("only answers button taps from unlinked chats", async () => {
    const chatId = nextChatId++;

    await post(buttonUpdate(chatId, "al"));

    expect(sentTexts(chatId)).toEqual([]);
    expect(calls("answerCallbackQuery")).toHaveLength(1);
  });
});

// ─── Scheduled tasks ────────────────────────────────────────────────────────

describe("scheduled tasks", () => {
  it("/briefing asks for a time and days, then schedules it on the main agent", async () => {
    const chatId = nextChatId++;
    const user = await seedUser({ telegramChatId: chatId });

    await post(textUpdate(chatId, "/briefing"));
    await post(textUpdate(chatId, "7:30am"));
    expect(lastSent(chatId)).toBe(msg.ASK_TASK_DAYS);
    await post(buttonUpdate(chatId, buttonData(chatId, "Weekdays")!));

    const [job] = await q.listJobs(user.id);
    expect(job).toMatchObject({
      cronExpression: "30 7 * * 1-5",
      agentId: (await q.ensurePrimaryAgent(user.id)).id,
      enabled: true,
    });
    expect(job.prompt).toContain("morning briefing");
    expect(lastSent(chatId)).toContain("✅ Scheduled your morning briefing weekdays at 07:30 (America/New_York)");
  });

  it("/newtask asks which agent when the user has several", async () => {
    const { chatId, user, specialist } = await seedWithSpecialist();

    await post(textUpdate(chatId, "/newtask Find new sleep research"));
    await post(textUpdate(chatId, "tomorrow"));
    expect(lastSent(chatId)).toBe(msg.TIME_INVALID);
    await post(textUpdate(chatId, "18:00"));
    await post(buttonUpdate(chatId, buttonData(chatId, "Every day")!));
    expect(lastSent(chatId)).toBe(msg.ASK_TASK_AGENT);
    await post(buttonUpdate(chatId, buttonData(chatId, "Researcher")!));

    const [job] = await q.listJobs(user.id);
    expect(job).toMatchObject({ prompt: "Find new sleep research", cronExpression: "0 18 * * *", agentId: specialist.id });
  });

  it("/tasks buttons pause, resume, run now and delete", async () => {
    const chatId = nextChatId++;
    const user = await seedUser({ telegramChatId: chatId });
    await post(textUpdate(chatId, "/newtask Check my inbox"));
    await post(textUpdate(chatId, "9"));
    await post(buttonUpdate(chatId, buttonData(chatId, "Every day")!));
    const [job] = await q.listJobs(user.id);

    await post(textUpdate(chatId, "/tasks"));
    expect(lastSent(chatId)).toContain("<b>Check my inbox</b>");
    expect(buttonData(chatId, /Check my inbox/)).toBe(`t:${job.id}`);

    await post(buttonUpdate(chatId, `tp:${job.id}`));
    expect((await q.getJob(user.id, job.id))?.enabled).toBe(false);
    expect(editedTexts(chatId).at(-1)).toContain("paused");

    await post(buttonUpdate(chatId, `tn:${job.id}`));
    expect(calls("answerCallbackQuery").at(-1)).toMatchObject({ text: msg.TASK_PAUSED_CANT_RUN });

    await post(buttonUpdate(chatId, `tr:${job.id}`));
    expect((await q.getJob(user.id, job.id))?.enabled).toBe(true);

    await post(buttonUpdate(chatId, `tn:${job.id}`));
    expect(calls("answerCallbackQuery").at(-1)).toMatchObject({ text: msg.TASK_QUEUED });
    expect((await q.getJob(user.id, job.id))!.nextRunAt!.getTime()).toBeLessThanOrEqual(Date.now());

    await post(buttonUpdate(chatId, `ty:${job.id}`));
    expect(await q.listJobs(user.id)).toEqual([]);
  });

  it("ignores task button ids that belong to another user", async () => {
    const ownerChat = nextChatId++;
    const owner = await seedUser({ telegramChatId: ownerChat });
    await post(textUpdate(ownerChat, "/newtask Secret task"));
    await post(textUpdate(ownerChat, "9"));
    await post(buttonUpdate(ownerChat, buttonData(ownerChat, "Every day")!));
    const [job] = await q.listJobs(owner.id);

    const attackerChat = nextChatId++;
    await seedUser({ telegramChatId: attackerChat });
    await post(buttonUpdate(attackerChat, `ty:${job.id}`));
    await post(buttonUpdate(attackerChat, `t:${job.id}`));

    expect(await q.getJob(owner.id, job.id)).toBeDefined();
    expect(editedTexts(attackerChat)).toEqual([]);
  });

  it("a days button from an abandoned flow is stale", async () => {
    const chatId = nextChatId++;
    const user = await seedUser({ telegramChatId: chatId });
    await post(textUpdate(chatId, "/briefing 7"));
    const days = buttonData(chatId, "Every day")!;
    await post(textUpdate(chatId, "/cancel"));

    await post(buttonUpdate(chatId, days));

    expect(await q.listJobs(user.id)).toEqual([]);
    expect(lastSent(chatId)).toBe(msg.STALE_BUTTON);
  });
});

// ─── Account ────────────────────────────────────────────────────────────────

describe("account commands", () => {
  it("/timezone shows the zone, and changes it case-insensitively", async () => {
    const chatId = nextChatId++;
    const user = await seedUser({ telegramChatId: chatId });

    await post(textUpdate(chatId, "/timezone"));
    expect(lastSent(chatId)).toContain("<b>America/New_York</b>");
    await post(textUpdate(chatId, "/timezone europe/london"));
    expect((await getUser(user.id))?.timezone).toBe("Europe/London");
    await post(textUpdate(chatId, "/timezone Mars/Base"));
    expect(lastSent(chatId)).toContain("I don't know the timezone");
    expect((await getUser(user.id))?.timezone).toBe("Europe/London");
  });

  it("/usage reports this month's share of the allowance", async () => {
    const chatId = nextChatId++;
    const user = await seedUser({ telegramChatId: chatId });
    await q.incrementUsage(user.id, q.currentMonth(), { inputTokens: 40_000, outputTokens: 10_000, messageCount: 12 });

    await post(textUpdate(chatId, "/usage"));

    expect(lastSent(chatId)).toContain("25% of your allowance: 50,000 of 200,000 tokens, across 12 messages");
  });

  it("/connections shows status and points to the web hub", async () => {
    const chatId = nextChatId++;
    await seedUser({ telegramChatId: chatId });
    listConnectionsMock.mockResolvedValueOnce([
      {
        slug: "GMAIL",
        name: "Gmail",
        description: "",
        access: [{ id: "draft", label: "Read and draft", description: "" }],
        currentAccess: "draft",
        status: "ACTIVE",
      },
      { slug: "GOOGLECALENDAR", name: "Google Calendar", description: "", access: [], currentAccess: "read" },
    ]);

    await post(textUpdate(chatId, "/connections"));

    const text = lastSent(chatId);
    expect(text).toContain("<b>Gmail</b>: ✅ connected · read and draft");
    expect(text).toContain("<b>Google Calendar</b>: ⚪️ not connected");
    expect(text).toContain('href="http://localhost:3000/settings/integrations"');
  });

  it("registers the command menu once", async () => {
    const chatId = nextChatId++;
    await seedUser({ telegramChatId: chatId });
    h.redis.store.delete("tg:commands:v1");

    await post(textUpdate(chatId, "/help"));
    await post(textUpdate(chatId, "/help"));

    expect(calls("setMyCommands")).toHaveLength(1);
    expect(lastSent(chatId)).toBe(msg.HELP);
  });
});
