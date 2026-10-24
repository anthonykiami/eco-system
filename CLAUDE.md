@AGENTS.md

# Agent Eco: multi-user, multi-agent personal assistant

This is a multi-tenant product sold to other people. It has two interfaces: the Next.js web UI and one shared Telegram bot that every user links to. Treat every piece of data as belonging to exactly one user.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Start the dev server (http://localhost:3000) |
| `pnpm build` | Production build (needs a valid `.env.local`) |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | Generate Next route types, then `tsc --noEmit` |
| `pnpm test` | Vitest (`vitest run`). DB tests use in-memory PGlite, not Neon |
| `pnpm db:generate` | Generate a SQL migration from `lib/db/schema.ts` into `drizzle/` |
| `pnpm db:migrate` | Apply migrations to `DATABASE_URL` from `.env.local` |
| `./setup-worktrees.sh` | Create the three feature worktrees next to this repo |

## Stack

- **App:** Next.js 16 (App Router, TS strict). Middleware is **`proxy.ts`** in Next 16; there is no `middleware.ts`.
- **AI:** Vercel AI SDK 7 with `@ai-sdk/anthropic`.
- **Database:** Neon Postgres + Drizzle (`drizzle-orm/neon-http`). There are no interactive transactions; use `db.batch([...])`.
- **Auth:** Auth.js v5 (`next-auth@beta`), Google, Drizzle adapter, database sessions.
- **Upstash:** Redis, Ratelimit and QStash. Use the shared clients in `lib/upstash.ts` and don't construct your own.
- **Storage:** Vercel Blob.
- **Composio:** per-user tools. Use `new Composio({ provider: new VercelProvider() })`, then `composio.create(userId)` and `session.tools()`. Always pass our `userId`.
- **Supermemory:** use the core `supermemory` SDK wrapped in our own AI SDK `tool()`s. Scope every call with `containerTag: \`user-${userId}\``. `@supermemory/tools` is **not** installed because it's incompatible with AI SDK 7.
- **Langfuse:** via OpenTelemetry (`@langfuse/otel`, `@langfuse/vercel-ai-sdk`). Pass `LANGFUSE_HOST` as `baseUrl`. In serverless handlers, flush with `after(() => spanProcessor.forceFlush())`.
- **Telegram:** no SDK. `lib/telegram/api.ts` wraps the Bot API with `fetch`, and `lib/telegram/types.ts` has zod schemas for updates. Extend those instead of adding a dependency.
- **Groq:** transcribes Telegram voice messages (Whisper, `lib/telegram/media.ts`) through its HTTP API with `fetch`; no SDK. `GROQ_API_KEY` is optional: without it the bot says voice isn't available.
- **Other:** zod 4, cron-parser, Vitest.

## Deployment notes

- **Long-running routes:** the Vercel default timeout is 10s. Any route that calls `runAgent` sets `export const maxDuration = 60;` in its own `route.ts`. Don't add a shared `vercel.json`.
- **Scheduling:** Vercel Cron on the Hobby plan only runs about once a day, so it can't drive the heartbeat. Use a **QStash schedule** pointed at `${APP_URL}/api/cron/heartbeat` instead, and verify the QStash signature with `qstashReceiver` from `lib/upstash.ts`.
- **Waitlist:** production runs with `WAITLIST_MODE=true`, so new sign-ups land on `/waitlist` until an admin activates them at `/admin`. Local development runs with it `false`.
- **CI:** `.github/workflows/ci.yml` runs typecheck, lint and test on every push and PR. It never touches the real database — the DB tests use PGlite.

## Directory map and branch ownership

```
auth.ts                      Auth.js config (shared, main only)
proxy.ts                     Route protection (shared, main only)
lib/env.ts                   Env validation (LOCKED)
lib/db/schema.ts             Drizzle schema (LOCKED)
lib/db/index.ts              Neon client (shared, main only)
lib/db/queries/              ALL reads and writes of user-owned tables (shared, main only)
lib/upstash.ts               Shared Redis / Ratelimit / QStash clients (shared, main only)
lib/auth/                    Session guards + admin check (shared, main only)
lib/agents/types.ts          runAgent contract (LOCKED)
lib/agents/errors.ts         Agent error contract (LOCKED)
lib/agents/index.ts          runAgent (currently an echo stub)           → feature/agent-core
lib/agents/defaults.ts       Default primary agent soul                   → feature/agent-core
lib/agents/primary/          Primary agent                                → feature/agent-core
lib/agents/specialized/      Specialized sub-agents                       → feature/agent-core
lib/tracing/                 Langfuse / OTel (+ root instrumentation.ts)  → feature/agent-core
lib/telegram/                Telegram bot logic                           → feature/telegram-bot
app/api/telegram/            Telegram webhook                             → feature/telegram-bot
app/settings/telegram/       Telegram linking UI                          → feature/telegram-bot
lib/heartbeat/               Scheduling / fan-out logic                   → feature/heartbeat
app/api/cron/heartbeat/      Heartbeat endpoint                           → feature/heartbeat
app/api/jobs/run/            QStash job worker                            → feature/heartbeat
```

**Each feature branch only changes its own folders** (marked `→` above). Anything marked shared or LOCKED changes only on `main`. If your branch needs a new query helper, a new env var, a schema change, or a new dependency, stop and ask.

Public routes (no session; each must authenticate itself): `/login`, `/api/auth/*`, `/api/telegram` (Telegram secret-token header), `/api/cron/*` and `/api/jobs/*` (QStash signature via `qstashReceiver` in `lib/upstash.ts`).

## Contracts

### `runAgent` (`lib/agents/types.ts`, implemented in `lib/agents/index.ts`)

```ts
runAgent(input: {
  userId: string;
  chatId?: string;   // continue a chat; omitted → latest chat for agent + channel (scheduled → new chat)
  agentId?: string;  // omitted → the user's primary agent
  message: string;
  images?: { data: Uint8Array; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' }[]; // photos sent with the message; history keeps a "[Sent a photo]" note
  channel: 'web' | 'telegram' | 'scheduled';
  onDelegate?: (agent: { id: string; name: string }) => void; // fired when the primary agent hands work to a specialist
  onTaskScheduled?: (task: { id: string }) => void;          // fired when the agent creates a task; it starts switched off until the user turns it on
}): Promise<{ text: string; chatId: string }>
```

Import it with `import { runAgent } from "@/lib/agents"`.

### Errors (`lib/agents/errors.ts`)

`runAgent` may throw these. Catch them and show `err.userMessage` to the user verbatim.

- `AgentError` (abstract base): `code: string` and `userMessage: string`.
- `RateLimitError`: `code = "RATE_LIMITED"`, optional `retryAfterSeconds`. Message: "You're sending messages too quickly…"
- `BudgetExceededError`: `code = "BUDGET_EXCEEDED"`. Message: "You've reached your usage limit for this month…"
- `isAgentError(err)` is a type guard.

## Data access rules

Never query user-owned tables outside lib/db/queries/. Every query must be scoped by userId.

- Every helper takes `userId` as its first argument and filters by it in every `WHERE`, including updates and deletes.
- Creating a row that references another row (a chat's agent, a message's chat, a job's agent) checks ownership first. If the check fails it throws `NotFoundError`.
- Cross-user exceptions are named explicitly and are the only ones allowed:
  - `getUserByTelegramChatId`: webhook resolves chat → user.
  - `listDueJobs`: heartbeat scan. It returns ids only.
  - `admin*` in `lib/db/queries/admin.ts`: call only after `requireAdmin()`.
- `lib/db/queries/isolation.test.ts` proves two users can't see or modify each other's data. Extend it whenever you add a helper.
- DB tests replace `@/lib/db` with PGlite using `vi.mock("@/lib/db", async () => (await import("@/test/db")).createTestDbModule())`.
- Pages, route handlers and server actions must call `requireSession()`, `requireActiveUser()` or `requireAdmin()` from `lib/auth/session.ts`. `proxy.ts` is not a security boundary.

## Rules

- Never modify package.json, lib/db/schema.ts, or lib/env.ts on a feature branch. If a change is needed there, stop and tell me.
- Before finishing any task, run pnpm typecheck, pnpm lint, and pnpm test, and fix all failures.
