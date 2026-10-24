/**
 * CONTRACT between the agent core and its callers (web UI, Telegram, heartbeat).
 * Do not change these signatures on a feature branch.
 */

export type AgentChannel = "web" | "telegram" | "scheduled";

export interface RunAgentInput {
  userId: string;
  /** Continue an existing chat. Omit to use/create the default chat for the agent + channel. */
  chatId?: string;
  /** Defaults to the user's primary agent. */
  agentId?: string;
  message: string;
  channel: AgentChannel;
  /** Called when the primary agent hands part of the turn to a specialized agent, e.g. to show it in chat. */
  onDelegate?: (agent: { id: string; name: string }) => void;
  /**
   * Called when the agent creates a scheduled task. Such tasks start switched off, so text the
   * agent read (an email, a web page) can't plant a recurring job; the caller lets the user turn it on.
   */
  onTaskScheduled?: (task: { id: string }) => void;
}

export interface RunAgentResult {
  text: string;
  chatId: string;
}

/**
 * Runs one agent turn for a user.
 * @throws RateLimitError | BudgetExceededError (lib/agents/errors.ts) — show `err.userMessage` to the user.
 */
export type RunAgent = (input: RunAgentInput) => Promise<RunAgentResult>;
