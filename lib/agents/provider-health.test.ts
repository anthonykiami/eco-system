import { APICallError, RetryError } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceUnavailableError } from "./errors";
import { asServiceError, clearProviderProblem, getProviderProblem, providerProblemOf } from "./provider-health";

const store = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/upstash", () => ({
  redis: {
    set: async (key: string, value: unknown) => store.set(key, value),
    get: async (key: string) => store.get(key) ?? null,
    del: async (key: string) => store.delete(key),
  },
}));

const apiError = (statusCode: number, message: string) =>
  new APICallError({ message, url: "https://api.anthropic.com/v1/messages", requestBodyValues: {}, statusCode });

const CREDIT = apiError(400, "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing.");

beforeEach(() => store.clear());

describe("provider health", () => {
  it("recognizes owner-side failures, including after retries", () => {
    expect(providerProblemOf(CREDIT)).toBe("credit");
    expect(providerProblemOf(apiError(401, "invalid x-api-key"))).toBe("auth");
    expect(
      providerProblemOf(new RetryError({ message: "failed", reason: "maxRetriesExceeded", errors: [CREDIT] })),
    ).toBe("credit");
    expect(providerProblemOf(apiError(529, "Overloaded"))).toBeUndefined();
    expect(providerProblemOf(new Error("credit balance is too low"))).toBeUndefined();
  });

  it("turns them into a clear error and flags them until a turn succeeds", async () => {
    const err = await asServiceError(CREDIT);
    expect(err).toBeInstanceOf(ServiceUnavailableError);
    expect((err as ServiceUnavailableError).userMessage).toMatch(/out of credit/);
    expect(await getProviderProblem()).toMatchObject({ reason: "credit" });

    await clearProviderProblem();
    expect(await getProviderProblem()).toBeUndefined();

    const other = new Error("boom");
    expect(await asServiceError(other)).toBe(other);
    expect(await getProviderProblem()).toBeUndefined();
  });
});
