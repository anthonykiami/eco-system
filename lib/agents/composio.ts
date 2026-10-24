import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";
import type { ToolSet } from "ai";
import { env } from "@/lib/env";

let client: Composio<VercelProvider> | undefined;
const composio = () =>
  (client ??= new Composio({ apiKey: env.COMPOSIO_API_KEY, provider: new VercelProvider() }));

/** Toolkits a user can connect from settings. Slugs are Composio's, uppercase is canonical. */
export const TOOLKITS = [
  {
    slug: "GMAIL",
    name: "Gmail",
    description: "Read, search, draft and send email.",
  },
  {
    slug: "GOOGLECALENDAR",
    name: "Google Calendar",
    description: "See your schedule and create or update events.",
  },
] as const;

export type ToolkitSlug = (typeof TOOLKITS)[number]["slug"];

export const isToolkitSlug = (value: string): value is ToolkitSlug =>
  TOOLKITS.some((t) => t.slug === value);

export type ToolkitConnection = {
  slug: ToolkitSlug;
  name: string;
  description: string;
  /** undefined when the user has never started a connection for this toolkit. */
  status?: string;
  connectedAccountId?: string;
};

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

/** Every toolkit in the catalog with this user's connection status, if any. */
export async function listToolkitConnections(userId: string): Promise<ToolkitConnection[]> {
  let accounts: { toolkit: { slug: string }; status: string; id: string }[] = [];
  try {
    const { items } = await composio().connectedAccounts.list({ userIds: [userId], limit: 100 });
    accounts = items;
  } catch (err) {
    console.error("[composio] could not list connections", err);
  }

  return TOOLKITS.map((toolkit) => {
    const candidates = accounts.filter(
      (a) => a.toolkit.slug.toUpperCase() === toolkit.slug && a.status !== "REVOKED",
    );
    // An abandoned earlier attempt can sit next to a working connection; the working one wins.
    const account = candidates.find((a) => a.status === "ACTIVE") ?? candidates[0];
    return { ...toolkit, status: account?.status, connectedAccountId: account?.id };
  });
}

/**
 * Starts an OAuth connection for this user and returns where to send their browser.
 * The connection is created against our userId, so tools stay scoped to them.
 */
export async function startToolkitConnection(
  userId: string,
  slug: ToolkitSlug,
  callbackUrl: string,
): Promise<string> {
  const authConfigId = await authConfigIdFor(slug);
  const request = await composio().connectedAccounts.link(userId, authConfigId, { callbackUrl });

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

/**
 * Composio tools for the toolkits this user has actively connected, using our userId as the
 * Composio entity id. Returns {} if the user has no connections or Composio is unavailable.
 */
export async function loadComposioTools(userId: string): Promise<ToolSet> {
  try {
    const { items } = await composio().connectedAccounts.list({
      userIds: [userId],
      statuses: ["ACTIVE"],
      limit: 100,
    });
    const toolkits = [...new Set(items.map((account) => account.toolkit.slug))];
    if (toolkits.length === 0) return {};

    const session = await composio().create(userId, {
      toolkits,
      // Only expose what's already connected; don't let the agent start new OAuth flows.
      manageConnections: false,
      sandbox: { enable: false },
    });
    return (await session.tools()) as ToolSet;
  } catch (err) {
    console.error("[agents] composio tools unavailable", err);
    return {};
  }
}
