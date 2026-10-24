import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  disconnectToolkit,
  isToolkitSlug,
  listToolkitConnections,
  startToolkitConnection,
  TOOLKITS,
} from "./composio";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  del: vi.fn(),
  link: vi.fn(),
  authList: vi.fn(),
  authCreate: vi.fn(),
}));

vi.mock("@composio/core", () => ({
  Composio: class {
    connectedAccounts = { list: mocks.list, delete: mocks.del, link: mocks.link };
    authConfigs = { list: mocks.authList, create: mocks.authCreate };
  },
}));
vi.mock("@composio/vercel", () => ({ VercelProvider: class {} }));

const ACCOUNT = { id: "ca_1", status: "ACTIVE", toolkit: { slug: "gmail" } };

beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue({ items: [ACCOUNT] });
  mocks.del.mockReset().mockResolvedValue({});
  mocks.link.mockReset().mockResolvedValue({ id: "ca_2", redirectUrl: "https://oauth.example" });
  mocks.authList.mockReset().mockResolvedValue({ items: [{ id: "ac_existing" }] });
  mocks.authCreate.mockReset().mockResolvedValue({ id: "ac_new" });
});

describe("toolkit catalog", () => {
  it("accepts only known slugs", () => {
    expect(isToolkitSlug("GMAIL")).toBe(true);
    expect(isToolkitSlug("gmail")).toBe(false);
    expect(isToolkitSlug("SLACK")).toBe(false);
  });
});

describe("listToolkitConnections", () => {
  it("reports status per toolkit for that user only", async () => {
    const list = await listToolkitConnections("user-1");
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ userIds: ["user-1"] }));
    expect(list).toHaveLength(TOOLKITS.length);
    expect(list.find((t) => t.slug === "GMAIL")).toMatchObject({
      status: "ACTIVE",
      connectedAccountId: "ca_1",
    });
    expect(list.find((t) => t.slug === "GOOGLECALENDAR")?.status).toBeUndefined();
  });

  it("prefers the active connection over an abandoned attempt", async () => {
    mocks.list.mockResolvedValue({
      items: [{ id: "ca_0", status: "INITIATED", toolkit: { slug: "gmail" } }, ACCOUNT],
    });
    const list = await listToolkitConnections("user-1");
    expect(list.find((t) => t.slug === "GMAIL")).toMatchObject({
      status: "ACTIVE",
      connectedAccountId: "ca_1",
    });
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
