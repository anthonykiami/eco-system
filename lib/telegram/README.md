Telegram bot logic (feature/telegram-bot). Telegram is where users use the product day to day; connecting accounts stays on the web (Settings → Integrations).

- `handle-update.ts`: entry point. Routes messages, commands and button taps (callback queries).
- `conversation.ts`: plain messages. `@name …` goes to one agent, `/talk` switches agents, replies are labeled by agent, delegations are announced.
- `agent-commands.ts`, `task-commands.ts`, `account-commands.ts`: `/agents`, `/newagent`, `/tasks`, `/newtask`, `/briefing`, `/connections`, `/timezone`, `/usage`.
- `media.ts`: photos go to the agent as images (the largest Telegram size up to 1568 px); voice messages, audio and round videos are transcribed by Groq and then handled like typed text. Videos and other files get a "not supported" reply.
- `agent-bots.ts`: an agent's own bot. The user makes it in @BotFather and pastes the token on the web; it's checked, pointed at `/api/telegram/bot/[botId]` (with a per-bot secret) and stored encrypted (`secret-box.ts`). Updates to it run inside `asBot(token)` (`api.ts`), so every handler answers through that bot, as that agent.
- The group: `/linkgroup` links a group to the user. There the main bot answers plain messages, an agent's bot answers @mentions of it and replies to it, and only the owner gets answers.
- `topics.ts`: Threaded Mode, which streams replies. Agents used to get a topic each; ones that have one still answer there.
- `draft.ts`: streams replies as a live preview (`sendMessageDraft`) while the agent writes, then the final reply is sent as normal messages.
- `state.ts`: per-user Redis state (active agent, the multi-step flow in progress).
- `api.ts` (Bot API via fetch), `types.ts` (zod update schemas), `format.ts`/`split.ts` (HTML), `linking.ts` (one-time link codes), `bot-commands.ts` (the "/" menu, registered automatically).

Button `callback_data` carries raw ids; every handler re-checks them against the tapping user's own rows.
