import { APICallError, RetryError } from "ai";
import { redis } from "@/lib/upstash";
import { ServiceUnavailableError } from "./errors";

/**
 * Whether the AI provider (Anthropic) is refusing our requests for a reason only the owner can fix:
 * no credit, or a bad API key. Recorded when a turn fails that way and cleared by the next turn
 * that succeeds, so the dashboard can show it. Redis trouble never breaks a turn.
 */

const PROBLEM_KEY = "system:ai-provider-problem";
const PROBLEM_TTL_SECONDS = 7 * 24 * 60 * 60;

export type ProviderProblem = { reason: "credit" | "auth"; at: string };

/** Runs a Redis call, turning any failure into undefined: this is reporting, never worth failing a turn over. */
async function quietly<T>(call: () => Promise<T>): Promise<T | undefined> {
  try {
    return await call();
  } catch {
    return undefined;
  }
}

/** The owner-side problem behind a failed model call, if that's what it was. */
export function providerProblemOf(err: unknown): ProviderProblem["reason"] | undefined {
  // After retries, the SDK wraps the last failure.
  if (RetryError.isInstance(err)) return providerProblemOf(err.lastError);
  if (!APICallError.isInstance(err)) return undefined;
  const text = `${err.message} ${err.responseBody ?? ""}`;
  if (/credit balance is too low/i.test(text)) return "credit";
  if (err.statusCode === 401 || /invalid x-api-key|authentication_error/i.test(text)) return "auth";
  return undefined;
}

/**
 * Turns an owner-side provider failure into a ServiceUnavailableError (and records it); returns
 * any other error unchanged.
 */
export async function asServiceError(err: unknown): Promise<unknown> {
  const reason = providerProblemOf(err);
  if (!reason) return err;
  const problem: ProviderProblem = { reason, at: new Date().toISOString() };
  await quietly(() => redis.set(PROBLEM_KEY, problem, { ex: PROBLEM_TTL_SECONDS }));
  return new ServiceUnavailableError(reason, err instanceof Error ? err.message : undefined);
}

/** A turn went through, so any recorded problem is over. */
export async function clearProviderProblem(): Promise<void> {
  await quietly(() => redis.del(PROBLEM_KEY));
}

export async function getProviderProblem(): Promise<ProviderProblem | undefined> {
  return (await quietly(() => redis.get<ProviderProblem>(PROBLEM_KEY))) ?? undefined;
}
