Telegram bot logic (feature/telegram-bot). Telegram is where users use the product day to day; connecting accounts stays on the web (Settings → Integrations).

- `handle-update.ts`: entry point. Routes messages, commands and button taps (callback queries).
- `conversation.ts`: plain messages. `@name …` goes to one agent, `/talk` switches agents, replies are labeled by agent, delegations are announced.
- `agent-commands.ts`, `task-commands.ts`, `account-commands.ts`: `/agents`, `/newagent`, `/tasks`, `/newtask`, `/briefing`, `/connections`, `/timezone`, `/usage`.
- `media.ts`: photos go to the agent as images (the largest Telegram size up to 1568 px); voice messages, audio and round videos are transcribed by Groq and then handled like typed text. Videos and other files get a "not supported" reply.
- `state.ts`: per-user Redis state (active agent, the multi-step flow in progress).
- `api.ts` (Bot API via fetch), `types.ts` (zod update schemas), `format.ts`/`split.ts` (HTML), `linking.ts` (one-time link codes), `bot-commands.ts` (the "/" menu, registered automatically).

Button `callback_data` carries raw ids; every handler re-checks them against the tapping user's own rows.
