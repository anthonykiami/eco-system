import Link from "next/link";
import { Chat, type ChatMessage } from "@/components/chat";
import { SignOutButton } from "@/components/sign-out-button";
import { requireActiveUser } from "@/lib/auth/session";
import { ensurePrimaryAgent, getUser, listChats, listMessages } from "@/lib/db/queries";

const HISTORY_LIMIT = 50;

export default async function Home() {
  const session = await requireActiveUser();
  const userId = session.user.id;

  const [agent, user] = await Promise.all([ensurePrimaryAgent(userId), getUser(userId)]);
  // Continue the most recent web conversation, the same one runAgent would pick up.
  const [latest] = await listChats(userId, { agentId: agent.id, channel: "web" });
  const history = latest ? await listMessages(userId, latest.id, { limit: HISTORY_LIMIT }) : [];

  const initialMessages: ChatMessage[] = history.flatMap((m) =>
    m.role === "user" || m.role === "assistant"
      ? [{ id: m.id, role: m.role, content: m.content }]
      : [],
  );

  return (
    <div className="flex min-h-full flex-1 flex-col">
      {!user?.telegramChatId && (
        <p className="border-b border-neutral-200 px-4 py-2 text-center text-sm dark:border-neutral-800">
          Your agents live in Telegram.{" "}
          <Link href="/settings/telegram" className="underline">
            Connect Telegram
          </Link>{" "}
          to talk to them from your phone.
        </p>
      )}
      <Chat
        initialMessages={initialMessages}
        initialChatId={latest?.id}
        agentName={agent.name}
      />
      <nav className="flex justify-center gap-4 border-t border-neutral-200 py-3 text-sm text-neutral-500 dark:border-neutral-800">
        <Link href="/settings" className="underline">
          Settings
        </Link>
        {session.user.isAdmin && (
          <Link href="/admin" className="underline">
            Admin
          </Link>
        )}
        <SignOutButton />
      </nav>
    </div>
  );
}
