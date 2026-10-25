import { ChatWorkspace, type AgentOption, type ConversationItem } from "@/components/chat";
import { preview } from "@/components/format";
import { requireActiveUser } from "@/lib/auth/session";
import { ensurePrimaryAgent, getUser, listAgents, listConversationSummaries, listMessages } from "@/lib/db/queries";
import type { Chat } from "@/lib/db/schema";
import { env } from "@/lib/env";

const HISTORY_LIMIT = 100;

const whereFrom = (chat: Chat): ConversationItem["where"] =>
  chat.fromTask ? "task" : chat.channel === "web" ? "web" : "telegram";

/**
 * Chat with any of your agents. ?agent= picks the agent (default: the main one) and ?c= the
 * conversation: its latest one by default, or "new" for a fresh start.
 */
export default async function ChatPage({ searchParams }: PageProps<"/chat">) {
  const session = await requireActiveUser();
  const userId = session.user.id;
  const params = await searchParams;

  const primary = await ensurePrimaryAgent(userId);
  const [all, user] = await Promise.all([listAgents(userId), getUser(userId)]);
  const agents = [primary, ...all.filter((a) => a.id !== primary.id)];
  const agent = agents.find((a) => a.id === params.agent) ?? primary;

  const summaries = await listConversationSummaries(userId, agent.id);
  const conversations: ConversationItem[] = summaries.map(({ chat, opening, lastAt }) => ({
    id: chat.id,
    title: opening ? preview(opening, 60) : "New conversation",
    where: whereFrom(chat),
    lastAt: lastAt.toISOString(),
  }));

  const requested = typeof params.c === "string" ? params.c : undefined;
  const chat =
    requested === "new"
      ? undefined
      : requested
        ? summaries.find((s) => s.chat.id === requested)?.chat
        : summaries.find((s) => !s.chat.fromTask)?.chat;
  const history = chat ? await listMessages(userId, chat.id, { limit: HISTORY_LIMIT }) : [];

  const options: AgentOption[] = agents.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.role === "primary" ? "Your main agent. Hands work to the others." : (a.description ?? ""),
    primary: a.role === "primary",
    telegramUrl: `https://t.me/${a.role === "primary" ? env.TELEGRAM_BOT_USERNAME : (a.telegramBotUsername ?? env.TELEGRAM_BOT_USERNAME)}`,
  }));

  return (
    <ChatWorkspace
      key={`${agent.id}:${chat?.id ?? "new"}`}
      agents={options}
      agentId={agent.id}
      conversations={conversations}
      chatId={chat?.id}
      readOnly={Boolean(chat?.fromTask)}
      timezone={user?.timezone ?? session.user.timezone}
      initialMessages={history.flatMap((m) =>
        m.role === "user" || m.role === "assistant"
          ? [{ id: m.id, role: m.role, content: m.content, at: m.createdAt.toISOString() }]
          : [],
      )}
    />
  );
}
