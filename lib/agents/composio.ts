import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";
import { asSchema, jsonSchema, type JSONSchema7, type ToolSet } from "ai";
import { listIntegrationAccess } from "@/lib/db/queries";
import { env } from "@/lib/env";
import { redis } from "@/lib/upstash";

let client: Composio<VercelProvider> | undefined;
const composio = () =>
  (client ??= new Composio({ apiKey: env.COMPOSIO_API_KEY, provider: new VercelProvider() }));

export type AccessLevel = {
  id: string;
  label: string;
  description: string;
  /** Composio tool slugs this level allows. Omitted means every tool in the toolkit. */
  tools?: readonly string[];
  /** Tells the agent what it can't do, so it explains instead of fumbling. */
  agentNote?: string;
};

const GMAIL_READ = [
  "GMAIL_FETCH_EMAILS",
  "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
  "GMAIL_FETCH_MESSAGE_BY_THREAD_ID",
  "GMAIL_GET_ATTACHMENT",
  "GMAIL_LIST_THREADS",
  "GMAIL_LIST_LABELS",
  "GMAIL_GET_LABEL",
  "GMAIL_LIST_DRAFTS",
  "GMAIL_GET_DRAFT",
  "GMAIL_GET_CONTACTS",
  "GMAIL_GET_PEOPLE",
  "GMAIL_SEARCH_PEOPLE",
  "GMAIL_GET_PROFILE",
  "GMAIL_WHO_AM_I",
];

const CALENDAR_READ = [
  "GOOGLECALENDAR_EVENTS_LIST",
  "GOOGLECALENDAR_EVENTS_LIST_ALL_CALENDARS",
  "GOOGLECALENDAR_EVENTS_GET",
  "GOOGLECALENDAR_EVENTS_INSTANCES",
  "GOOGLECALENDAR_FIND_EVENT",
  "GOOGLECALENDAR_FIND_FREE_SLOTS",
  "GOOGLECALENDAR_FREE_BUSY_QUERY",
  "GOOGLECALENDAR_LIST_CALENDARS",
  "GOOGLECALENDAR_GET_CALENDAR",
  "GOOGLECALENDAR_GET_CURRENT_DATE_TIME",
  "GOOGLECALENDAR_SETTINGS_LIST",
  "GOOGLECALENDAR_GET_CURRENT_USER",
];

/**
 * Toolkits a user can connect from settings. Slugs are Composio's, uppercase is canonical.
 * Each has access levels from least to most; the user picks one per toolkit.
 */
export const TOOLKITS = [
  {
    slug: "GMAIL",
    name: "Gmail",
    description: "Read and search your email, and optionally draft or send.",
    defaultAccess: "draft",
    access: [
      {
        id: "read",
        label: "Read only",
        description: "Search and read your email. Can't write anything.",
        tools: GMAIL_READ,
        agentNote: "Gmail is read-only: you can't draft, send or change email. Say so and offer to write the text here instead.",
      },
      {
        id: "draft",
        label: "Read and draft",
        description: "Also saves drafts in Gmail for you to review and send yourself. Never sends.",
        tools: [...GMAIL_READ, "GMAIL_CREATE_EMAIL_DRAFT", "GMAIL_UPDATE_DRAFT"],
        agentNote: "Gmail is drafts-only: you can't send. When asked to send, save a draft and tell the user it's waiting in their Gmail Drafts.",
      },
      {
        id: "full",
        label: "Full access",
        description: "Can also send, reply, forward, label and delete email as you.",
      },
    ],
  },
  {
    slug: "GOOGLECALENDAR",
    name: "Google Calendar",
    description: "See your schedule, and optionally add or change events.",
    defaultAccess: "edit",
    access: [
      {
        id: "read",
        label: "Read only",
        description: "See your calendars and events. Can't change anything.",
        tools: CALENDAR_READ,
        agentNote: "Google Calendar is read-only: you can't create or change events. Say so if asked.",
      },
      {
        id: "edit",
        label: "Read and add events",
        description: "Also creates and updates events. Anyone it adds as a guest gets an invite. Never deletes.",
        tools: [
          ...CALENDAR_READ,
          "GOOGLECALENDAR_CREATE_EVENT",
          "GOOGLECALENDAR_QUICK_ADD",
          "GOOGLECALENDAR_UPDATE_EVENT",
          "GOOGLECALENDAR_PATCH_EVENT",
        ],
        agentNote: "Google Calendar can't delete: you can create and update events but not remove them. Say so if asked.",
      },
      {
        id: "full",
        label: "Full access",
        description: "Can also delete events and change calendars and who they're shared with.",
      },
    ],
  },
] as const satisfies readonly {
  slug: string;
  name: string;
  description: string;
  defaultAccess: string;
  access: readonly AccessLevel[];
}[];

export type ToolkitSlug = (typeof TOOLKITS)[number]["slug"];

export const isToolkitSlug = (value: string): value is ToolkitSlug =>
  TOOLKITS.some((t) => t.slug === value);

const toolkitBySlug = (slug: string) => TOOLKITS.find((t) => t.slug === slug.toUpperCase());

export const isAccessLevel = (slug: ToolkitSlug, level: string): boolean =>
  toolkitBySlug(slug)!.access.some((a: AccessLevel) => a.id === level);

/** The saved level for a toolkit, or its default when none is saved or the saved one is gone. */
export function resolveAccess(slug: ToolkitSlug, saved?: string): AccessLevel {
  const toolkit = toolkitBySlug(slug)!;
  const levels: readonly AccessLevel[] = toolkit.access;
  return levels.find((a) => a.id === saved) ?? levels.find((a) => a.id === toolkit.defaultAccess)!;
}

async function savedAccess(userId: string): Promise<Map<string, string>> {
  const rows = await listIntegrationAccess(userId);
  return new Map(rows.map((row) => [row.toolkit, row.access]));
}

/** One working connection. `email` is missing only when the provider couldn't be asked. */
export type ConnectedAccount = { id: string; email?: string };

export type ToolkitConnection = {
  slug: ToolkitSlug;
  name: string;
  description: string;
  access: readonly AccessLevel[];
  /** The level in effect for this user. */
  currentAccess: string;
  /** Working connections, oldest first. The first is the one agents use unless told otherwise. */
  accounts: ConnectedAccount[];
  /**
   * "ACTIVE" when any account works; otherwise the state of an unfinished or broken attempt.
   * undefined when the user has never started a connection for this toolkit.
   */
  status?: string;
};

type ComposioAccount = {
  id: string;
  status: string;
  createdAt?: string;
  toolkit: { slug: string };
  data?: Record<string, unknown>;
};

const byCreation = (a: ComposioAccount, b: ComposioAccount) =>
  (a.createdAt ?? "").localeCompare(b.createdAt ?? "");

/** Asked for an account's email when Composio doesn't store one. Both return it in `data.email*`. */
const PROFILE_TOOLS: Record<ToolkitSlug, string> = {
  GMAIL: "GMAIL_GET_PROFILE",
  GOOGLECALENDAR: "GOOGLECALENDAR_GET_CURRENT_USER",
};

const EMAIL_CACHE_SECONDS = 30 * 24 * 60 * 60;
const emailKey = (userId: string, accountId: string) => `composio:account-email:${userId}:${accountId}`;

const asEmail = (value: unknown) => (typeof value === "string" && value.includes("@") ? value : undefined);

export type ToolResult = { successful?: boolean; error?: unknown; data?: Record<string, unknown> };

/**
 * Runs one Composio tool for the app itself (not the agent) on one of this user's connections.
 * `accountId` must come from this user's own connections; Composio also refuses others.
 */
export async function executeForAccount(
  userId: string,
  slug: ToolkitSlug,
  accountId: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const session = await composio().create(userId, {
    toolkits: [slug.toLowerCase()],
    tools: { [slug.toLowerCase()]: { enable: [tool] } },
    connectedAccounts: { [slug.toLowerCase()]: accountId },
    sessionPreset: "direct_tools",
    manageConnections: false,
    sandbox: { enable: false },
  });
  const tools = (await session.tools()) as ToolSet;
  const run = tools[tool]?.execute;
  if (!run) throw new Error(`Composio didn't offer ${tool}`);
  return (await run(args, { toolCallId: tool, messages: [], context: {} })) as ToolResult;
}

/** Asks the provider which address this connection belongs to. */
async function fetchAccountEmail(userId: string, slug: ToolkitSlug, accountId: string): Promise<string | undefined> {
  const result = await executeForAccount(userId, slug, accountId, PROFILE_TOOLS[slug], {});
  return asEmail(result.data?.email) ?? asEmail(result.data?.emailAddress);
}

/** The address a connection belongs to, so the user and the agent can tell accounts apart. Cached. */
async function accountEmail(userId: string, slug: ToolkitSlug, account: ComposioAccount): Promise<string | undefined> {
  const stored = asEmail(account.data?.displayName);
  if (stored) return stored;
  try {
    const cached = await redis.get<string>(emailKey(userId, account.id));
    if (cached) return cached;
    const email = await fetchAccountEmail(userId, slug, account.id);
    if (email) await redis.set(emailKey(userId, account.id), email, { ex: EMAIL_CACHE_SECONDS });
    return email;
  } catch (err) {
    console.error(`[composio] could not look up the email for ${account.id}`, err);
    return undefined;
  }
}

/**
 * This user's working connections per catalog toolkit, oldest first, with their emails.
 * The same Google account connected twice counts once. With `onlyToTellApart`, a toolkit's
 * emails are looked up only when it has several accounts (agent turns don't need the rest).
 */
async function activeAccounts(
  userId: string,
  accounts: ComposioAccount[],
  { onlyToTellApart = false } = {},
): Promise<Map<ToolkitSlug, ConnectedAccount[]>> {
  const result = new Map<ToolkitSlug, ConnectedAccount[]>();
  await Promise.all(
    TOOLKITS.map(async ({ slug }) => {
      const mine = accounts
        .filter((a) => a.toolkit.slug.toUpperCase() === slug && a.status === "ACTIVE")
        .sort(byCreation);
      if (mine.length === 0) return;
      if (onlyToTellApart && mine.length === 1) {
        result.set(slug, [{ id: mine[0].id }]);
        return;
      }
      const withEmails = await Promise.all(
        mine.map(async (a) => ({ id: a.id, email: await accountEmail(userId, slug, a) })),
      );
      result.set(
        slug,
        withEmails.filter((a, i) => !a.email || withEmails.findIndex((b) => b.email === a.email) === i),
      );
    }),
  );
  return result;
}

// Auth config ids are stable per toolkit for the whole Composio account; cache per process.
const authConfigIds = new Map<ToolkitSlug, string>();

/**
 * The Composio-managed OAuth auth config for a toolkit, creating it on first use.
 * Composio holds the Google client credentials, so we register nothing with Google.
 */
async function authConfigIdFor(slug: ToolkitSlug): Promise<string> {
  const cached = authConfigIds.get(slug);
  if (cached) return cached;

  const { items } = await composio().authConfigs.list({ toolkit: slug, isComposioManaged: true, limit: 1 });
  const id =
    items[0]?.id ??
    (await composio().authConfigs.create(slug, { type: "use_composio_managed_auth" })).id;

  authConfigIds.set(slug, id);
  return id;
}

/** This user's working connections per toolkit, oldest first, with their emails. */
export async function listConnectedAccounts(userId: string): Promise<Map<ToolkitSlug, ConnectedAccount[]>> {
  const { items } = await composio().connectedAccounts.list({ userIds: [userId], statuses: ["ACTIVE"], limit: 100 });
  return activeAccounts(userId, items);
}

/** Every toolkit in the catalog with this user's connections, if any. */
export async function listToolkitConnections(userId: string): Promise<ToolkitConnection[]> {
  const saved = await savedAccess(userId);
  let accounts: ComposioAccount[] = [];
  try {
    const { items } = await composio().connectedAccounts.list({ userIds: [userId], limit: 100 });
    accounts = items;
  } catch (err) {
    console.error("[composio] could not list connections", err);
  }
  const active = await activeAccounts(userId, accounts);

  return TOOLKITS.map((toolkit) => {
    const working = active.get(toolkit.slug) ?? [];
    // With nothing working, show how far the latest attempt got.
    const attempt = accounts
      .filter((a) => a.toolkit.slug.toUpperCase() === toolkit.slug && a.status !== "REVOKED")
      .sort(byCreation)
      .at(-1);
    return {
      slug: toolkit.slug,
      name: toolkit.name,
      description: toolkit.description,
      access: toolkit.access,
      currentAccess: resolveAccess(toolkit.slug, saved.get(toolkit.slug)).id,
      accounts: working,
      status: working.length > 0 ? "ACTIVE" : attempt?.status,
    };
  });
}

/**
 * Starts an OAuth connection for this user and returns where to send their browser.
 * The connection is created against our userId, so tools stay scoped to them. Starting one
 * while another account is already connected adds a second account.
 */
export async function startToolkitConnection(
  userId: string,
  slug: ToolkitSlug,
  callbackUrl: string,
): Promise<string> {
  const authConfigId = await authConfigIdFor(slug);
  // allowMultiple: connecting a second account (say, work and personal Gmail) is supported.
  const request = await composio().connectedAccounts.link(userId, authConfigId, {
    callbackUrl,
    allowMultiple: true,
  });

  if (!request.redirectUrl) {
    throw new Error(`Composio returned no redirect URL for ${slug}`);
  }
  return request.redirectUrl;
}

/**
 * Removes a connection. Refuses ids that don't belong to this user, so a forged id
 * can't disconnect someone else's account.
 */
export async function disconnectToolkit(userId: string, connectedAccountId: string): Promise<void> {
  const { items } = await composio().connectedAccounts.list({ userIds: [userId], limit: 100 });
  if (!items.some((account) => account.id === connectedAccountId)) {
    throw new Error(`Connection ${connectedAccountId} does not belong to user ${userId}`);
  }
  await composio().connectedAccounts.delete(connectedAccountId);
}

export type ComposioTools = {
  tools: ToolSet;
  /** One line per restricted toolkit, for the agent's system prompt. */
  notes: string[];
};

/**
 * Drops every tool the user's access levels don't allow. Composio is asked to restrict too,
 * but this is the guarantee: a tool not listed here never reaches the model. Tools outside
 * any known toolkit (e.g. Composio meta tools, which can run anything) pass only when every
 * connected toolkit has full access.
 */
export function filterToolsByAccess(tools: ToolSet, levels: Map<ToolkitSlug, AccessLevel>): ToolSet {
  const allFull = [...levels.values()].every((level) => !level.tools);
  return Object.fromEntries(
    Object.entries(tools).filter(([name]) => {
      const slug = TOOLKITS.find((t) => name.toUpperCase().startsWith(`${t.slug}_`))?.slug;
      if (!slug) return allFull;
      const level = levels.get(slug);
      if (!level) return false;
      return !level.tools || level.tools.includes(name.toUpperCase());
    }),
  );
}

/**
 * Claude rejects the whole request if any tool's input schema isn't a top-level object. Some
 * Composio schemas convert to `allOf: [{}, { type: "object", ... }]`; unwrap those to the object.
 * Returns undefined for a shape it can't fix.
 */
export function toObjectSchema(schema: JSONSchema7): JSONSchema7 | undefined {
  if (schema.type === "object") return schema;
  const { allOf, ...rest } = schema;
  const parts = (allOf ?? []).filter(
    (part): part is JSONSchema7 => typeof part === "object" && Object.keys(part).length > 0,
  );
  if (parts.length === 1 && parts[0].type === "object") return { ...rest, ...parts[0] };
  return undefined;
}

/** Rewrites each tool's input schema with toObjectSchema, keeping its validation; drops tools it can't fix. */
export async function withObjectInputSchemas(tools: ToolSet): Promise<ToolSet> {
  const entries = await Promise.all(
    Object.entries(tools).map(async ([name, tool]) => {
      try {
        const schema = asSchema(tool.inputSchema);
        const fixed = toObjectSchema(await schema.jsonSchema);
        if (fixed) return [[name, { ...tool, inputSchema: jsonSchema(fixed, { validate: schema.validate }) }]];
      } catch (err) {
        console.warn(`[agents] composio tool ${name} has an unreadable schema`, err);
        return [];
      }
      console.warn(`[agents] dropped composio tool ${name}: its input schema isn't an object`);
      return [];
    }),
  );
  return Object.fromEntries(entries.flat()) as ToolSet;
}

/**
 * One tool over the same tool from several accounts: adds an `account` field (an email, the
 * first account when omitted) and runs the call through that account's session.
 */
export async function withAccountChoice(
  toolkitName: string,
  variants: { email: string; tool: ToolSet[string] }[],
): Promise<ToolSet[string]> {
  const base = asSchema(variants[0].tool.inputSchema);
  const json = await base.jsonSchema;
  const emails = variants.map((v) => v.email);
  const schema: JSONSchema7 = {
    ...json,
    properties: {
      ...json.properties,
      account: {
        type: "string",
        enum: emails,
        description: `Which ${toolkitName} account to use. Defaults to ${emails[0]}.`,
      },
    },
  };

  return {
    ...variants[0].tool,
    inputSchema: jsonSchema(schema, {
      validate: async (value) => {
        const { account, ...rest } = (value ?? {}) as Record<string, unknown>;
        if (account !== undefined && !emails.includes(account as string)) {
          return { success: false, error: new Error(`account must be one of: ${emails.join(", ")}`) };
        }
        const result = base.validate ? await base.validate(rest) : { success: true as const, value: rest };
        return result.success ? { success: true, value: { ...(result.value as object), account } } : result;
      },
    }),
    execute: (input: Record<string, unknown>, options) => {
      const { account, ...rest } = input;
      const variant = variants.find((v) => v.email === account) ?? variants[0];
      return variant.tool.execute!(rest, options);
    },
  } as ToolSet[string];
}

/**
 * Composio tools for the catalog toolkits this user has actively connected, limited to the
 * access level they chose for each, using our userId as the Composio entity id.
 * A toolkit with several connected accounts gets one session per account; its tools then take
 * an `account` argument. Returns no tools if the user has no connections or Composio is unavailable.
 */
export async function loadComposioTools(userId: string): Promise<ComposioTools> {
  try {
    const [{ items }, saved] = await Promise.all([
      composio().connectedAccounts.list({ userIds: [userId], statuses: ["ACTIVE"], limit: 100 }),
      savedAccess(userId),
    ]);
    const accounts = await activeAccounts(userId, items, { onlyToTellApart: true });
    if (accounts.size === 0) return { tools: {}, notes: [] };

    const levels = new Map<ToolkitSlug, AccessLevel>(
      [...accounts.keys()].map((slug) => [slug, resolveAccess(slug, saved.get(slug))]),
    );

    // Session i uses each toolkit's i-th account. Naming the accounts also matters with just one:
    // otherwise Composio looks on its own default auth config, which may not be the one the user
    // connected through, and reports the toolkit as not connected.
    const sessionCount = Math.max(...[...accounts.values()].map((a) => a.length));
    const sessions = await Promise.all(
      Array.from({ length: sessionCount }, async (_, i) => {
        const slugs = [...accounts.keys()].filter((slug) => accounts.get(slug)!.length > i);
        const toolsConfig: Record<string, { enable: string[] }> = {};
        for (const slug of slugs) {
          const level = levels.get(slug)!;
          if (level.tools) toolsConfig[slug.toLowerCase()] = { enable: [...level.tools] };
        }
        const session = await composio().create(userId, {
          toolkits: slugs.map((slug) => slug.toLowerCase()),
          tools: toolsConfig,
          connectedAccounts: Object.fromEntries(
            slugs.map((slug) => [slug.toLowerCase(), accounts.get(slug)![i].id]),
          ),
          // Expose the toolkit tools themselves, so each one can be checked against the allowlist.
          sessionPreset: "direct_tools",
          // Only expose what's already connected; don't let the agent start new OAuth flows.
          manageConnections: false,
          sandbox: { enable: false },
        });
        const all = (await session.tools()) as ToolSet;
        const tools = await withObjectInputSchemas(filterToolsByAccess(all, levels));
        const dropped = Object.keys(all).length - Object.keys(tools).length;
        if (dropped > 0) console.warn(`[agents] withheld ${dropped} composio tools`);
        return tools;
      }),
    );

    const tools: ToolSet = { ...sessions[0] };
    const notes = [...levels.values()].flatMap((level) => (level.agentNote ? [level.agentNote] : []));
    for (const [slug, list] of accounts) {
      if (list.length < 2) continue;
      const name = TOOLKITS.find((t) => t.slug === slug)!.name;
      const labeled = list.map((account, i) => ({ email: account.email ?? `account ${i + 1}`, i }));
      for (const toolName of Object.keys(tools)) {
        if (!toolName.toUpperCase().startsWith(`${slug}_`)) continue;
        const variants = labeled.flatMap(({ email, i }) =>
          sessions[i][toolName] ? [{ email, tool: sessions[i][toolName] }] : [],
        );
        tools[toolName] = await withAccountChoice(name, variants);
      }
      notes.push(
        `The user has ${list.length} ${name} accounts connected: ${labeled.map((l) => l.email).join(", ")}. ` +
          `Every ${name} tool takes an \`account\` argument; without one it uses ${labeled[0].email}. ` +
          "When the user doesn't say which account, check all of them for anything they'd want to know about (like their schedule or new email), and say which account each result came from.",
      );
    }
    return { tools, notes };
  } catch (err) {
    console.error("[agents] composio tools unavailable", err);
    return { tools: {}, notes: [] };
  }
}
