import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { adminSetUserPlan } from "./admin";
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
