/**
 * CONTRACT: errors runAgent may throw. Callers should catch AgentError and show
 * `userMessage` to the user verbatim (web toast, Telegram reply, etc.).
 */

export abstract class AgentError extends Error {
  abstract readonly code: string;
  readonly userMessage: string;

  constructor(userMessage: string, detail?: string) {
    super(detail ?? userMessage);
    this.name = new.target.name;
    this.userMessage = userMessage;
  }
}

export class RateLimitError extends AgentError {
  readonly code = "RATE_LIMITED";

  constructor(
    /** Seconds until the user may try again, if known. */
    readonly retryAfterSeconds?: number,
    detail?: string,
  ) {
    super(
      retryAfterSeconds
        ? `You're sending messages too quickly. Please try again in ${retryAfterSeconds} seconds.`
        : "You're sending messages too quickly. Please wait a moment and try again.",
      detail,
    );
  }
}

export class BudgetExceededError extends AgentError {
  readonly code = "BUDGET_EXCEEDED";

  constructor(detail?: string) {
    super(
      "You've reached your usage limit for this month. It resets at the start of next month.",
      detail,
    );
  }
}

/**
 * The AI provider refused the request for a reason on the owner's side, not the user's: the
 * account is out of credit, or the API key is wrong. Retrying won't help until the owner fixes it.
 */
export class ServiceUnavailableError extends AgentError {
  readonly code = "SERVICE_UNAVAILABLE";

  constructor(
    readonly reason: "credit" | "auth",
    detail?: string,
  ) {
    super(
      reason === "credit"
        ? "I can't reply right now: the AI account behind this assistant is out of credit. The owner needs to top it up."
        : "I can't reply right now: the AI account behind this assistant rejected its key. The owner needs to check it.",
      detail,
    );
  }
}

export function isAgentError(err: unknown): err is AgentError {
  return err instanceof AgentError;
}
