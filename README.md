# ECO-SYSTEM

**A multi-agent personal assistant you live with in Telegram and manage on the web.**

ECO-SYSTEM gives each user a team of AI agents: a main agent that answers everything and hands work to specialists (a news agent, a coach, a researcher…) that the user creates in plain language. Agents read your email and calendar, remember what you tell them, browse the web, run tasks on a schedule, and reach you in Telegram, including voice messages, photos, reminders and live-streaming replies. The web app is the hub for connecting accounts, managing agents and tasks, chatting, and (for the owner) running the system.

It's multi-tenant from the ground up: every row of data belongs to exactly one user, and two users can never see or touch each other's data.

---

## What it does

### In Telegram (where it's used day to day)
- **Talk to your main agent**, which hands work to your specialists when it fits.
- **Talk to any agent directly**: `@news_guy what moved markets today?`, reply to an agent's message, or `/talk` to switch.
- **Each agent can have its own bot**, so it's its own contact with its own chat. A **group chat** with you and all your agent bots lets each one answer as itself.
- **Voice messages** (transcribed by Groq Whisper) and **photos** (read by Claude).
- **Replies stream in** as they're written (Telegram's Threaded Mode).
- **Reminders and tasks**: "remind me at 6 to call mom", "every weekday at 8, summarize my inbox", "tomorrow at 9, check flight prices". Tasks an agent creates wait for a ✅ Turn on tap.
- **Commands**: `/agents`, `/newagent`, `/tasks`, `/newtask`, `/briefing`, `/connections`, `/timezone`, `/usage`, `/new`, `/help`, `/cancel`.

### On the web (the hub)
- **Home**: an orchestrator view of your agents, a live clock, today's calendar progress, active agents, the latest reply, today's calendar and unread email, upcoming tasks, usage and connected accounts.
- **Chat**: talk to any agent, browse each one's conversations (including Telegram ones), stream replies, attach photos.
- **Agents**: create, edit and delete agents, give each its own Telegram bot, pause all of an agent's tasks.
- **Tasks**: morning briefings, custom recurring tasks, reminders and one-offs.
- **Integrations**: connect Gmail and Google Calendar (more than one account each) plus any app the owner adds, and choose what agents may do with each (read only, read and write, full access).
- **Admin** (owner only): system health (AI provider, Telegram webhook, Redis, voice), users with plan, usage and per-user monthly caps, and an **App catalog** to offer more of Composio's one-click integrations (Notion, GitHub, Slack, Drive, Outlook…).
- **Installable** as an app on iPhone (Add to Home Screen) and on laptops (Chrome or Safari).

---

## How it works

```
        Telegram (main bot, agents' own bots, group)          Web (Next.js)
                      │                                             │
          /api/telegram, /api/telegram/bot/[botId]        pages, /api/chat (streamed)
                      └──────────────────────┬──────────────────────┘
                                             ▼
                                runAgent()  (lib/agents)
             ┌──────────────┬───────────────┼────────────────┬──────────────────┐
             ▼              ▼               ▼                ▼                  ▼
      Claude (AI SDK)   Specialists     Composio tools    Supermemory       Schedule tools
      + web search      (delegation)    Gmail, Calendar,  (per-user         (tasks, reminders,
                                        added apps        memory)           create agents)
                                             │
               Neon Postgres (Drizzle) · Upstash Redis · Langfuse tracing

  QStash ── every 5 min ──▶ /api/cron/heartbeat ── due tasks ──▶ /api/jobs/run ──▶ runAgent()
```

- **One entry point.** Every turn, from Telegram, the web or a schedule, goes through `runAgent`, which enforces rate limits and the monthly token budget, loads the user's tools, memory and agents, runs Claude, and records usage.
- **Agents.** The main agent gets delegation tools for each specialist. Specialists have their own instructions and can be addressed directly.
- **Integrations.** Composio provides per-user OAuth and tools, filtered by the access level the user chose, so a tool outside it never reaches the model.
- **Scheduling.** A QStash schedule pings the heartbeat every 5 minutes. Due tasks are fanned out to a worker, each run is claimed exactly once, and the result is delivered to Telegram.
- **Safety.** Agent-created tasks start switched off. Agents' bot tokens are encrypted at rest, and each bot's webhook has its own secret. Only the owner gets answers in groups. When the AI account is out of credit, the app says so plainly and flags it on the dashboard.

---

## Tech stack

| Area | Choice |
|---|---|
| App | Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind CSS 4 |
| AI | Vercel AI SDK 7, Anthropic Claude (with web search and fetch) |
| Data | Neon Postgres + Drizzle ORM |
| Auth | Auth.js v5, Google sign-in, database sessions, waitlist mode |
| Queue, cache, limits | Upstash Redis, Ratelimit and QStash |
| Integrations | Composio (Gmail, Google Calendar and catalog apps) |
| Memory | Supermemory |
| Voice | Groq Whisper (optional) |
| Messaging | Telegram Bot API (no SDK) |
| Observability | Langfuse via OpenTelemetry |
| Tests | Vitest, with in-memory PGlite for database tests |
| Hosting | Vercel |

---

## Project structure

```
app/
  (app)/            signed-in web app: home, chat, agents, settings, admin
  api/chat/         streamed web chat
  api/telegram/     main bot webhook, and bot/[botId] for agents' own bots
  api/cron/         heartbeat (called by QStash)
  api/jobs/         scheduled-task worker
  login/, waitlist/
components/         UI: design system (ui.tsx), chat, orchestrator, today view…
lib/
  agents/           runAgent, main agent, specialists, Composio, memory, limits, tools
  telegram/         bot logic: routing, commands, buttons, topics, drafts, agents' bots
  heartbeat/        scheduling, fan-out, job runs
  db/               Drizzle schema and ALL queries (user-scoped)
  auth/, tracing/, env.ts, upstash.ts
drizzle/            SQL migrations
scripts/            webhook and QStash schedule setup
test/               test database helpers
```

See [CLAUDE.md](./CLAUDE.md) for the full contracts, data-access rules and conventions, and the READMEs in `lib/telegram`, `lib/heartbeat` and `app/api/telegram`.

---

## Getting started

### 1. Prerequisites
Node.js 22+, pnpm, and accounts for: Neon, Upstash (Redis and QStash), Google Cloud (OAuth client), Anthropic, Composio, Supermemory, Telegram (@BotFather), Langfuse, Vercel Blob, and optionally Groq.

### 2. Install and configure
```bash
pnpm install
cp .env.example .env.local    # fill in every value; lib/env.ts validates them
pnpm db:migrate               # create the database tables
pnpm dev                      # http://localhost:3000
```
Put your own email in `ADMIN_EMAILS` to get the Admin pages, and set `WAITLIST_MODE=false` locally so new sign-ins are let straight in.

### 3. Telegram
1. Create a bot with @BotFather and set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME`.
2. In the bot's BotFather settings, turn on **Threaded Mode** (for streaming replies) and **Disallow users to create new threads**.
3. Point the webhook at your deployment:
   ```bash
   APP_URL=https://your-app.vercel.app node --env-file=.env.local scripts/set-webhook.ts
   ```
4. In the web app, open **Settings → Telegram → Connect Telegram** to link your account.

### 4. Scheduled tasks
Create the QStash schedule that drives the heartbeat (once per deployment):
```bash
node scripts/create-qstash-schedule.ts
```

### 5. Deploy
Push to `main`; Vercel builds and deploys. Set the same environment variables in Vercel, with `APP_URL` set to the public URL (the build refuses a localhost URL in production). Run `pnpm db:migrate` against the production database whenever a new migration is added.

---

## Development

```bash
pnpm typecheck   # route types + tsc
pnpm lint
pnpm test        # Vitest; database tests use in-memory PGlite, never your real database
pnpm build
```

Ground rules (details in [CLAUDE.md](./CLAUDE.md)):
- All reads and writes of user data live in `lib/db/queries/`, and every one is scoped by `userId`. `lib/db/queries/isolation.test.ts` proves users can't reach each other's data, so extend it for every new query.
- Every page, route handler and server action checks the session (`requireActiveUser` / `requireAdmin`).
- `pnpm typecheck`, `pnpm lint` and `pnpm test` must pass before anything ships. CI runs them on every push.

---

## Status

Private project, in active development. Built first for the owner's daily use, with the multi-tenant foundations (isolation, plans, caps, waitlist, admin) in place to offer it to others.
