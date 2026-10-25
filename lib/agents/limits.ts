import type { Ratelimit } from "@upstash/ratelimit";
import type { User } from "@/lib/db/schema";
import { currentMonth, getUsage, getUser, NotFoundError } from "@/lib/db/queries";
import { createRatelimit } from "@/lib/upstash";
import { BudgetExceededError, RateLimitError } from "./errors";

export type PlanLimits = {
  messagesPerMinute: number;
  /** Input + output tokens per calendar month (UTC), unless an admin sets the user's own cap. */
  monthlyTokens: number;
  /** Model steps (tool calls plus the final answer) per agent turn. */
  maxSteps: number;
};

/** Models per plan live in ./models. A user's plan is set from the admin page. */
export const PLAN_LIMITS = {
  free: { messagesPerMinute: 10, monthlyTokens: 200_000, maxSteps: 10 },
  // Generous, but still capped so a runaway loop can't drain the API account.
  max: { messagesPerMinute: 30, monthlyTokens: 5_000_000, maxSteps: 20 },
} as const satisfies Record<string, PlanLimits>;

export type Plan = keyof typeof PLAN_LIMITS;

/** The user's monthly token allowance: the cap an admin set for them, or their plan's default. */
export function monthlyTokenLimit(user: Pick<User, "plan" | "monthlyTokenLimit">): number {
  return user.monthlyTokenLimit ?? PLAN_LIMITS[resolvePlan(user.plan)].monthlyTokens;
}

/** Unknown plan names fall back to the free tier. */
export function resolvePlan(plan: string): Plan {
  return Object.hasOwn(PLAN_LIMITS, plan) ? (plan as Plan) : "free";
}

const limiters = new Map<Plan, Ratelimit>();

function limiterFor(plan: Plan): Ratelimit {
  let limiter = limiters.get(plan);
  if (!limiter) {
    limiter = createRatelimit(`agent:${plan}`, PLAN_LIMITS[plan].messagesPerMinute, "1 m");
    limiters.set(plan, limiter);
  }
  return limiter;
}

/**
 * Checks the per-minute rate limit and the monthly token budget for the user's plan.
 * Returns the user, which the caller needs anyway (timezone, plan).
 * @throws RateLimitError | BudgetExceededError
 */
export async function enforceLimits(userId: string, now: Date = new Date()): Promise<User> {
  const user = await getUser(userId);
  if (!user) throw new NotFoundError("User", userId);
  const plan = resolvePlan(user.plan);
  const limits = PLAN_LIMITS[plan];

  const { success, reset } = await limiterFor(plan).limit(userId);
  if (!success) {
    const retryAfterSeconds = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
    throw new RateLimitError(retryAfterSeconds, `User ${userId} exceeded ${limits.messagesPerMinute}/min`);
  }

  const usage = await getUsage(userId, currentMonth(now));
  const used = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
  const cap = monthlyTokenLimit(user);
  if (used >= cap) {
    throw new BudgetExceededError(`User ${userId} used ${used}/${cap} tokens`);
  }

  return user;
}
