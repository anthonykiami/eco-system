import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  adminAddIntegration,
  adminListUsage,
  adminRemoveIntegration,
  adminSetUserPlan,
  adminSetUserTokenLimit,
} from "./admin";
import { listIntegrationCatalog } from "./catalog";
import { incrementUsage } from "./usage";
import { getUser } from "./users";

vi.mock("@/lib/db", async () => (await import("@/test/db")).createTestDbModule());

const seed = async (name: string) =>
  (await db.insert(users).values({ email: `${name}-${crypto.randomUUID()}@example.com` }).returning())[0];

describe("adminSetUserPlan", () => {
  it("changes only the target user's plan", async () => {
    const [target, other] = [await seed("target"), await seed("other")];

    const updated = await adminSetUserPlan(target.id, "max");

    expect(updated?.plan).toBe("max");
    expect((await getUser(other.id))?.plan).toBe("free");
  });
});

describe("adminListUsage", () => {
  it("lists every user's usage for that month only", async () => {
    const [a, b] = [await seed("usage-a"), await seed("usage-b")];
    await incrementUsage(a.id, "2026-09", { inputTokens: 5, outputTokens: 1 });
    await incrementUsage(b.id, "2026-10", { inputTokens: 7, outputTokens: 2 });

    const rows = await adminListUsage("2026-10");

    expect(rows.map((r) => r.userId)).toContain(b.id);
    expect(rows.map((r) => r.userId)).not.toContain(a.id);
  });
});

describe("integration catalog", () => {
  const notion = { slug: "NOTION", name: "Notion", description: "Docs", logo: null, fullTools: ["NOTION_SEARCH"], readTools: ["NOTION_SEARCH"], safeTools: ["NOTION_SEARCH"] };

  it("adds an app, refreshes it in place, lists it for everyone and removes it", async () => {
    await adminAddIntegration(notion);
    await adminAddIntegration({ ...notion, readTools: ["NOTION_SEARCH", "NOTION_FETCH"] });

    const list = await listIntegrationCatalog();
    expect(list.filter((e) => e.slug === "NOTION")).toEqual([
      expect.objectContaining({ readTools: ["NOTION_SEARCH", "NOTION_FETCH"] }),
    ]);

    expect(await adminRemoveIntegration("NOTION")).toBe(true);
    expect(await adminRemoveIntegration("NOTION")).toBe(false);
    expect((await listIntegrationCatalog()).some((e) => e.slug === "NOTION")).toBe(false);
  });
});

describe("adminSetUserTokenLimit", () => {
  it("sets and clears only the target user's cap", async () => {
    const [target, other] = [await seed("cap-target"), await seed("cap-other")];

    expect((await adminSetUserTokenLimit(target.id, 50_000_000))?.monthlyTokenLimit).toBe(50_000_000);
    expect((await getUser(other.id))?.monthlyTokenLimit).toBeNull();
    expect((await adminSetUserTokenLimit(target.id, null))?.monthlyTokenLimit).toBeNull();
  });
});
