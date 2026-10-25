import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { adminListUsage, adminSetUserPlan } from "./admin";
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
