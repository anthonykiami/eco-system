import { beforeEach, describe, expect, it, vi } from "vitest";
import { asSchema, jsonSchema, type ToolSet } from "ai";
import {
  disconnectToolkit,
  isAccessLevel,
  isToolkitSlug,
  listToolkitConnections,
  loadComposioTools,
  resolveAccess,
  startToolkitConnection,
  TOOLKITS,
  toObjectSchema,
  withObjectInputSchemas,
} from "./composio";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  del: vi.fn(),
  link: vi.fn(),
  authList: vi.fn(),
  authCreate: vi.fn(),
  createSession: vi.fn(),
  listAccess: vi.fn(),
  redisGet: vi.fn(),
  redisSet: vi.fn(),
}));

vi.mock("@composio/core", () => ({
  Composio: class {
    connectedAccounts = { list: mocks.list, delete: mocks.del, link: mocks.link };
    authConfigs = { list: mocks.authList, create: mocks.authCreate };
    create = mocks.createSession;
  },
}));
vi.mock("@/lib/db/queries", () => ({ listIntegrationAccess: mocks.listAccess }));
vi.mock("@composio/vercel", () => ({ VercelProvider: class {} }));
vi.mock("@/lib/upstash", () => ({ redis: { get: mocks.redisGet, set: mocks.redisSet } }));

const ACCOUNT = {
  id: "ca_1",
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00Z",
  toolkit: { slug: "gmail" },
  data: { displayName: "me@gmail.com" },
};
const WORK_ACCOUNT = { ...ACCOUNT, id: "ca_2", createdAt: "2026-02-01T00:00:00Z", data: { displayName: "me@work.com" } };

beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue({ items: [ACCOUNT] });
  mocks.del.mockReset().mockResolvedValue({});
  mocks.link.mockReset().mockResolvedValue({ id: "ca_2", redirectUrl: "https://oauth.example" });
  mocks.authList.mockReset().mockResolvedValue({ items: [{ id: "ac_existing" }] });
  mocks.authCreate.mockReset().mockResolvedValue({ id: "ac_new" });
  mocks.listAccess.mockReset().mockResolvedValue([]);
  mocks.redisGet.mockReset().mockResolvedValue(null);
  mocks.redisSet.mockReset().mockResolvedValue("OK");
  mocks.createSession.mockReset().mockResolvedValue({ tools: async () => toolsNamed(EVERY_GMAIL_TOOL) });
});

/** What Composio might hand back if it ignored our restrictions entirely. */
const EVERY_GMAIL_TOOL = [
  "GMAIL_FETCH_EMAILS",
  "GMAIL_CREATE_EMAIL_DRAFT",
  "GMAIL_SEND_EMAIL",
  "GMAIL_REPLY_TO_THREAD",
  "GMAIL_SEND_DRAFT",
  "GMAIL_DELETE_MESSAGE",
  "COMPOSIO_MULTI_EXECUTE_TOOL",
];
const toolsNamed = (names: string[]): ToolSet =>
  Object.fromEntries(names.map((n) => [n, { description: n, inputSchema: jsonSchema({ type: "object", properties: {} }) } as unknown as ToolSet[string]]));
const savedGmail = (access: string) => mocks.listAccess.mockResolvedValue([{ toolkit: "GMAIL", access }]);

describe("toolkit catalog", () => {
  it("accepts only known slugs", () => {
    expect(isToolkitSlug("GMAIL")).toBe(true);
    expect(isToolkitSlug("gmail")).toBe(false);
    expect(isToolkitSlug("SLACK")).toBe(false);
  });
});

describe("access levels", () => {
  it("falls back to the toolkit default for missing or retired levels", () => {
    expect(resolveAccess("GMAIL").id).toBe("draft");
    expect(resolveAccess("GMAIL", "retired-level").id).toBe("draft");
    expect(resolveAccess("GMAIL", "full").id).toBe("full");
    expect(resolveAccess("GOOGLECALENDAR").id).toBe("edit");
  });

  it("validates level ids per toolkit", () => {
    expect(isAccessLevel("GMAIL", "draft")).toBe(true);
    expect(isAccessLevel("GOOGLECALENDAR", "draft")).toBe(false);
  });

  it("no restricted level allows sending or deleting", () => {
    for (const toolkit of TOOLKITS) {
      for (const level of toolkit.access) {
        if (!("tools" in level)) continue;
        expect(level.tools.filter((t) => /SEND|DELETE|FORWARD|REPLY|TRASH|ACL/.test(t))).toEqual([]);
      }
    }
  });
});

describe("loadComposioTools", () => {
  it("defaults Gmail to read and draft: no sending, even if Composio returns send tools", async () => {
    const { tools, notes } = await loadComposioTools("user-1");

    expect(Object.keys(tools).sort()).toEqual(["GMAIL_CREATE_EMAIL_DRAFT", "GMAIL_FETCH_EMAILS"]);
    expect(notes).toEqual([expect.stringMatching(/drafts-only/)]);
    const [userId, config] = mocks.createSession.mock.calls[0];
    expect(userId).toBe("user-1");
    expect(config.sessionPreset).toBe("direct_tools");
    expect(config.connectedAccounts).toEqual({ gmail: "ca_1" });
    expect(config.tools.gmail.enable).toContain("GMAIL_CREATE_EMAIL_DRAFT");
    expect(config.tools.gmail.enable).not.toContain("GMAIL_SEND_EMAIL");
  });

  it("read only withholds drafting too", async () => {
    savedGmail("read");
    const { tools } = await loadComposioTools("user-1");
    expect(Object.keys(tools)).toEqual(["GMAIL_FETCH_EMAILS"]);
  });

  it("full access passes everything and asks Composio for no restriction", async () => {
    savedGmail("full");
    const { tools, notes } = await loadComposioTools("user-1");

    expect(Object.keys(tools).sort()).toEqual([...EVERY_GMAIL_TOOL].sort());
    expect(notes).toEqual([]);
    expect(mocks.createSession.mock.calls[0][1].tools).toEqual({});
  });

  it("with several accounts, each tool takes an account and runs through that account's session", async () => {
    mocks.list.mockResolvedValue({ items: [ACCOUNT, WORK_ACCOUNT] });
    const runs: string[] = [];
    const sessionTools = (account: string): ToolSet => ({
      GMAIL_FETCH_EMAILS: {
        description: "fetch",
        inputSchema: jsonSchema({ type: "object", properties: { query: { type: "string" } } }),
        execute: async (input: unknown) => {
          runs.push(`${account}:${JSON.stringify(input)}`);
          return "ok";
        },
      } as unknown as ToolSet[string],
    });
    mocks.createSession.mockImplementation(async (_userId, config) => ({
      tools: async () => sessionTools(config.connectedAccounts.gmail),
    }));

    const { tools, notes } = await loadComposioTools("user-1");

    expect(mocks.createSession.mock.calls.map((c) => c[1].connectedAccounts)).toEqual([
      { gmail: "ca_1" },
      { gmail: "ca_2" },
    ]);
    const schema = asSchema(tools.GMAIL_FETCH_EMAILS.inputSchema);
    expect((await schema.jsonSchema).properties?.account).toMatchObject({ enum: ["me@gmail.com", "me@work.com"] });
    expect((await schema.validate!({ query: "x", account: "someone@else.com" })).success).toBe(false);

    const opts = { toolCallId: "t", messages: [], context: {} };
    await tools.GMAIL_FETCH_EMAILS.execute!({ query: "a", account: "me@work.com" }, opts);
    await tools.GMAIL_FETCH_EMAILS.execute!({ query: "b" }, opts);
    expect(runs).toEqual(['ca_2:{"query":"a"}', 'ca_1:{"query":"b"}']);
    expect(notes.join("\n")).toMatch(/2 Gmail accounts connected: me@gmail.com, me@work.com/);
  });

  it("ignores toolkits outside the catalog", async () => {
    mocks.list.mockResolvedValue({ items: [{ id: "ca_9", status: "ACTIVE", toolkit: { slug: "github" } }] });
    expect(await loadComposioTools("user-1")).toEqual({ tools: {}, notes: [] });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("returns no tools when Composio refuses the session", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.createSession.mockRejectedValue(new Error("403 session_management"));
    expect(await loadComposioTools("user-1")).toEqual({ tools: {}, notes: [] });
  });
});

describe("listToolkitConnections", () => {
  it("reports status per toolkit for that user only", async () => {
    const list = await listToolkitConnections("user-1");
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ userIds: ["user-1"] }));
    expect(list).toHaveLength(TOOLKITS.length);
    expect(list.find((t) => t.slug === "GMAIL")).toMatchObject({
      status: "ACTIVE",
      accounts: [{ id: "ca_1", email: "me@gmail.com" }],
      currentAccess: "draft",
    });
    expect(list.find((t) => t.slug === "GOOGLECALENDAR")?.status).toBeUndefined();
    expect(mocks.listAccess).toHaveBeenCalledWith("user-1");
  });

  it("prefers the active connection over an abandoned attempt", async () => {
    mocks.list.mockResolvedValue({
      items: [{ id: "ca_0", status: "INITIATED", toolkit: { slug: "gmail" } }, ACCOUNT],
    });
    const list = await listToolkitConnections("user-1");
    expect(list.find((t) => t.slug === "GMAIL")).toMatchObject({
      status: "ACTIVE",
      accounts: [{ id: "ca_1", email: "me@gmail.com" }],
    });
  });

  it("lists every working account oldest first, counting the same address once", async () => {
    mocks.list.mockResolvedValue({ items: [WORK_ACCOUNT, ACCOUNT, { ...ACCOUNT, id: "ca_3", createdAt: "2026-03-01" }] });
    const gmail = (await listToolkitConnections("user-1")).find((t) => t.slug === "GMAIL");
    expect(gmail?.accounts).toEqual([
      { id: "ca_1", email: "me@gmail.com" },
      { id: "ca_2", email: "me@work.com" },
    ]);
  });

  it("asks the provider for the address when Composio doesn't store it, and caches it", async () => {
    const calendar = { id: "ca_c", status: "ACTIVE", toolkit: { slug: "googlecalendar" }, data: {} };
    mocks.list.mockResolvedValue({ items: [calendar] });
    const execute = vi.fn().mockResolvedValue({ data: { email: "me@gmail.com" } });
    mocks.createSession.mockResolvedValue({ tools: async () => ({ GOOGLECALENDAR_GET_CURRENT_USER: { execute } }) });

    const list = await listToolkitConnections("user-1");

    expect(list.find((t) => t.slug === "GOOGLECALENDAR")?.accounts).toEqual([{ id: "ca_c", email: "me@gmail.com" }]);
    expect(mocks.createSession.mock.calls[0][1].connectedAccounts).toEqual({ googlecalendar: "ca_c" });
    expect(mocks.redisSet).toHaveBeenCalledWith("composio:account-email:user-1:ca_c", "me@gmail.com", expect.anything());

    mocks.redisGet.mockResolvedValue("me@gmail.com");
    execute.mockClear();
    await listToolkitConnections("user-1");
    expect(execute).not.toHaveBeenCalled();
  });

  it("degrades to an unconnected list when Composio is down", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.list.mockRejectedValue(new Error("down"));
    const list = await listToolkitConnections("user-1");
    expect(list.every((t) => t.status === undefined)).toBe(true);
  });
});

describe("startToolkitConnection", () => {
  it("links the connection to our userId and returns the redirect", async () => {
    const url = await startToolkitConnection("user-1", "GMAIL", "https://app.test/cb");
    expect(url).toBe("https://oauth.example");
    expect(mocks.link).toHaveBeenCalledWith("user-1", "ac_existing", {
      callbackUrl: "https://app.test/cb",
      allowMultiple: true,
    });
  });

  it("creates a Composio-managed auth config when none exists", async () => {
    mocks.authList.mockResolvedValue({ items: [] });
    await startToolkitConnection("user-1", "GOOGLECALENDAR", "https://app.test/cb");
    expect(mocks.authCreate).toHaveBeenCalledWith("GOOGLECALENDAR", {
      type: "use_composio_managed_auth",
    });
  });

  it("throws when Composio returns no redirect", async () => {
    mocks.link.mockResolvedValue({ id: "ca_2", redirectUrl: null });
    await expect(startToolkitConnection("user-1", "GMAIL", "https://app.test/cb")).rejects.toThrow();
  });
});

describe("disconnectToolkit", () => {
  it("deletes a connection the user owns", async () => {
    await disconnectToolkit("user-1", "ca_1");
    expect(mocks.del).toHaveBeenCalledWith("ca_1");
  });

  it("refuses an id that isn't in the user's own connections", async () => {
    await expect(disconnectToolkit("user-1", "ca_someone_else")).rejects.toThrow(/does not belong/);
    expect(mocks.del).not.toHaveBeenCalled();
  });
});

describe("tool input schemas", () => {
  const draft = { type: "object" as const, properties: { to: { type: "string" as const } }, required: ["to"] };

  it("unwraps Composio's allOf wrapper to the object schema Claude requires", () => {
    expect(toObjectSchema({ allOf: [{}, draft], description: "Draft an email" })).toEqual({
      ...draft,
      description: "Draft an email",
    });
    expect(toObjectSchema(draft)).toBe(draft);
  });

  it("gives up on shapes it can't turn into an object", () => {
    expect(toObjectSchema({ anyOf: [draft, { type: "string" }] })).toBeUndefined();
    expect(toObjectSchema({ allOf: [draft, draft] })).toBeUndefined();
  });

  it("rewrites wrapped schemas, keeps validation and drops tools it can't fix", async () => {
    const validate = vi.fn(() => ({ success: true as const, value: { to: "a@b.c" } }));
    const tools = {
      WRAPPED: { description: "w", inputSchema: jsonSchema({ allOf: [{}, draft] }, { validate }) },
      BROKEN: { description: "b", inputSchema: jsonSchema({ type: "string" }) },
    } as unknown as ToolSet;

    const fixed = await withObjectInputSchemas(tools);

    expect(Object.keys(fixed)).toEqual(["WRAPPED"]);
    const schema = asSchema(fixed.WRAPPED.inputSchema);
    expect(await schema.jsonSchema).toEqual(draft);
    await schema.validate?.({ to: "a@b.c" });
    expect(validate).toHaveBeenCalled();
  });
});
