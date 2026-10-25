import { Chat, type ChatMessage } from "@/components/chat";
import { requireActiveUser } from "@/lib/auth/session";
import { ensurePrimaryAgent, listChats, listMessages } from "@/lib/db/queries";

const HISTORY_LIMIT = 50;

export default async function ChatPage() {
  const session = await requireActiveUser();
  const userId = session.user.id;

  const agent = await ensurePrimaryAgent(userId);
  // Continue the most recent web conversation, the same one runAgent would pick up.
  const [latest] = await listChats(userId, { agentId: agent.id, channel: "web", fromTask: false });
  const history = latest ? await listMessages(userId, latest.id, { limit: HISTORY_LIMIT }) : [];

  const initialMessages: ChatMessage[] = history.flatMap((m) =>
    m.role === "user" || m.role === "assistant" ? [{ id: m.id, role: m.role, content: m.content }] : [],
  );

  return (
    <div className="flex h-[calc(100dvh-7rem)] flex-col md:h-dvh">
      <Chat initialMessages={initialMessages} initialChatId={latest?.id} agentName={agent.name} />
    </div>
  );
}
