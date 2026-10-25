"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { discardTask, turnOnTask } from "@/app/(app)/chat-actions";
import type { ChatEvent } from "@/app/api/chat/route";
import { formatAgo } from "./format";
import { Markdown } from "./markdown";

export type AgentOption = { id: string; name: string; description: string; primary: boolean; telegramUrl: string };
export type ConversationItem = { id: string; title: string; where: "web" | "telegram" | "task"; lastAt: string };
export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  at?: string;
  /** Previews of photos sent with this message (only for ones sent in this session). */
  photos?: string[];
};

type TaskCard = { id: string; title: string; when: string; state: "off" | "on" | "gone" };
type Photo = { preview: string; data: string; mediaType: "image/jpeg" };

const WHERE_LABEL = { web: "Web", telegram: "Telegram", task: "Task run" } as const;
const MAX_PHOTOS = 3;
/** Claude uses images up to about this on the long side; bigger only costs more. */
const PHOTO_SIDE = 1568;

const url = (agentId: string, c?: string) => `/chat?agent=${agentId}${c ? `&c=${c}` : ""}`;

/** Shrinks a photo in the browser to what Claude uses, as JPEG, so uploads stay small. */
async function readPhoto(file: File): Promise<Photo> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, PHOTO_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const preview = canvas.toDataURL("image/jpeg", 0.85);
  return { preview, data: preview.slice(preview.indexOf(",") + 1), mediaType: "image/jpeg" };
}

function Avatar({ agent, size = "md" }: { agent: AgentOption; size?: "sm" | "md" }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${
        size === "sm" ? "h-7 w-7 text-xs" : "h-9 w-9 text-sm"
      } ${agent.primary ? "bg-accent text-accent-foreground" : "bg-accent-soft text-accent"}`}
    >
      {agent.name.slice(0, 1)}
    </span>
  );
}

export function ChatWorkspace({
  agents,
  agentId,
  conversations,
  chatId: initialChatId,
  readOnly,
  timezone,
  initialMessages,
}: {
  agents: AgentOption[];
  agentId: string;
  conversations: ConversationItem[];
  chatId?: string;
  readOnly: boolean;
  timezone: string;
  initialMessages: ChatMessage[];
}) {
  const agent = agents.find((a) => a.id === agentId)!;
  const live = conversations.filter((c) => c.where !== "task");
  const runs = conversations.filter((c) => c.where === "task");

  const sidebar = (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-3">
      <section className="flex flex-col gap-0.5">
        <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted">Agents</p>
        {agents.map((a) => (
          <Link
            key={a.id}
            href={url(a.id)}
            className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition ${
              a.id === agentId ? "bg-accent-soft font-medium text-accent" : "hover:bg-surface-muted"
            }`}
          >
            <Avatar agent={a} size="sm" />
            <span className="truncate">{a.name}</span>
          </Link>
        ))}
      </section>

      <section className="flex flex-col gap-0.5">
        <div className="flex items-center justify-between px-2 pb-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Conversations</p>
          <Link href={url(agentId, "new")} className="text-xs font-medium text-accent hover:underline">
            + New
          </Link>
        </div>
        {live.length === 0 && <p className="px-2 text-xs text-muted">None yet.</p>}
        {live.map((c) => (
          <ConversationLink key={c.id} item={c} agentId={agentId} active={c.id === initialChatId} />
        ))}
      </section>

      {runs.length > 0 && (
        <details className="flex flex-col gap-0.5">
          <summary className="cursor-pointer px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted">
            Task runs ({runs.length})
          </summary>
          {runs.map((c) => (
            <ConversationLink key={c.id} item={c} agentId={agentId} active={c.id === initialChatId} />
          ))}
        </details>
      )}
    </div>
  );

  return (
    <div className="flex h-[calc(100dvh-7rem)] min-h-0 md:h-dvh">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-surface md:flex">{sidebar}</aside>
      <ChatPane
        agent={agent}
        agents={agents}
        initialChatId={initialChatId}
        readOnly={readOnly}
        timezone={timezone}
        initialMessages={initialMessages}
        mobileSidebar={sidebar}
      />
    </div>
  );
}

function ConversationLink({ item, agentId, active }: { item: ConversationItem; agentId: string; active: boolean }) {
  return (
    <Link
      href={url(agentId, item.id)}
      className={`flex flex-col rounded-lg px-2 py-1.5 transition ${active ? "bg-surface-muted" : "hover:bg-surface-muted"}`}
    >
      <span className="truncate text-sm">{item.title}</span>
      <span className="text-xs text-muted">
        {WHERE_LABEL[item.where]} · {formatAgo(new Date(item.lastAt))}
      </span>
    </Link>
  );
}

function ChatPane({
  agent,
  agents,
  initialChatId,
  readOnly,
  timezone,
  initialMessages,
  mobileSidebar,
}: {
  agent: AgentOption;
  agents: AgentOption[];
  initialChatId?: string;
  readOnly: boolean;
  timezone: string;
  initialMessages: ChatMessage[];
  mobileSidebar: React.ReactNode;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [chatId, setChatId] = useState(initialChatId);
  const [input, setInput] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [pending, setPending] = useState(false);
  const [partial, setPartial] = useState("");
  const [helpers, setHelpers] = useState<string[]>([]);
  const [tasks, setTasks] = useState<TaskCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, partial, pending, tasks]);

  useEffect(() => {
    // Grow the box with what's typed, up to a limit.
    const box = inputRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 200)}px`;
    // Only show a scrollbar once the text is taller than the box can grow.
    box.style.overflowY = box.scrollHeight > 200 ? "auto" : "hidden";
  }, [input]);

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    setError(null);
    try {
      const read = await Promise.all([...files].slice(0, MAX_PHOTOS - photos.length).map(readPhoto));
      setPhotos((prev) => [...prev, ...read].slice(0, MAX_PHOTOS));
    } catch {
      setError("Couldn't read that image. Try a JPEG or PNG.");
    }
  }

  async function send(text = input.trim()) {
    if ((!text && photos.length === 0) || pending) return;
    const sending = photos;
    setInput("");
    setPhotos([]);
    setError(null);
    setPartial("");
    setHelpers([]);
    setPending(true);
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", content: text, photos: sending.map((p) => p.preview) },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: text,
          chatId,
          agentId: agent.id,
          images: sending.map(({ data, mediaType }) => ({ data, mediaType })),
        }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Something went wrong.");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      let gotTask = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line) as ChatEvent;
          if (event.type === "chat" && event.chatId !== chatId) {
            setChatId(event.chatId);
            window.history.replaceState(null, "", url(agent.id, event.chatId));
          } else if (event.type === "partial") setPartial(event.text);
          else if (event.type === "delegate") setHelpers((prev) => (prev.includes(event.name) ? prev : [...prev, event.name]));
          else if (event.type === "task") {
            gotTask = true;
            setTasks((prev) => [...prev, { ...event, state: "off" }]);
          }
          else if (event.type === "done") {
            setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: event.text, at: new Date().toISOString() }]);
          } else if (event.type === "error") setError(event.message);
        }
      }
      // Updates the conversation list (a new one, or this one moving to the top). Refreshing
      // reloads the conversation, so it waits until any new task has been turned on or discarded.
      if (!gotTask) router.refresh();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
      setPartial("");
      inputRef.current?.focus();
    }
  }

  async function decide(task: TaskCard, on: boolean) {
    if (on) {
      const ok = await turnOnTask(task.id);
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, state: ok ? "on" : "gone" } : t)));
    } else {
      await discardTask(task.id);
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, state: "gone" } : t)));
    }
    if (tasks.every((t) => t.id === task.id || t.state !== "off")) router.refresh();
  }

  const timeOf = (iso?: string) =>
    iso ? new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : "";

  const suggestions = agent.primary
    ? ["What's on my calendar today?", "Summarize my unread email", "Remind me at 6pm to call mom"]
    : [`What can you do, ${agent.name}?`, "Give me an update"];

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3 sm:px-6">
        <button
          type="button"
          onClick={() => setShowList((v) => !v)}
          className="rounded-md border border-line px-2 py-1 text-xs md:hidden"
          aria-expanded={showList}
        >
          Agents & chats
        </button>
        <Avatar agent={agent} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">{agent.name}</h1>
          <p className="truncate text-xs text-muted">{agent.description}</p>
        </div>
        <a href={agent.telegramUrl} target="_blank" rel="noreferrer" className="hidden text-xs text-muted hover:text-foreground sm:inline">
          Open in Telegram ↗
        </a>
        <Link href={url(agent.id, "new")} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm transition hover:bg-surface-muted">
          New chat
        </Link>
      </header>
      {showList && <div className="max-h-[50dvh] overflow-y-auto border-b border-line bg-surface md:hidden">{mobileSidebar}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 py-6">
          {messages.length === 0 && !pending && (
            <div className="flex flex-col items-center gap-4 py-12 text-center">
              <Avatar agent={agent} />
              <div>
                <p className="font-medium">Chat with {agent.name}</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted">{agent.description}</p>
              </div>
              {!readOnly && (
                <div className="flex flex-wrap justify-center gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void send(s)}
                      className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm transition hover:border-accent/50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={m.role === "user" ? "flex flex-col items-end gap-1" : "flex gap-3"}>
              {m.role === "assistant" && <Avatar agent={agent} size="sm" />}
              <div className={m.role === "user" ? "flex max-w-[85%] flex-col items-end gap-1" : "min-w-0 flex-1"}>
                {m.photos && m.photos.length > 0 && (
                  <div className="flex gap-2">
                    {m.photos.map((src, i) => (
                      // eslint-disable-next-line @next/next/no-img-element -- local preview of an upload
                      <img key={i} src={src} alt="" className="h-24 w-24 rounded-xl object-cover" />
                    ))}
                  </div>
                )}
                {m.content &&
                  (m.role === "user" ? (
                    <div className="rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-accent-foreground">
                      {m.content}
                    </div>
                  ) : (
                    <div className="text-[15px] leading-relaxed">
                      <Markdown text={m.content} />
                    </div>
                  ))}
                {m.at && <span className="text-[11px] text-muted">{timeOf(m.at)}</span>}
              </div>
            </div>
          ))}

          {pending && (
            <div className="flex gap-3">
              <Avatar agent={agent} size="sm" />
              <div className="min-w-0 flex-1 text-[15px] leading-relaxed">
                {helpers.map((name) => (
                  <p key={name} className="mb-1 text-sm text-muted italic">
                    ↪ {agent.name} asked {name} to help…
                  </p>
                ))}
                {partial ? (
                  <Markdown text={partial} />
                ) : (
                  <span className="flex gap-1 py-2" aria-label="Thinking">
                    {[0, 150, 300].map((delay) => (
                      <span key={delay} className="h-2 w-2 animate-bounce rounded-full bg-muted" style={{ animationDelay: `${delay}ms` }} />
                    ))}
                  </span>
                )}
              </div>
            </div>
          )}

          {tasks.map((t) => (
            <div key={t.id} className="ml-10 flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4 text-sm">
              <p className="font-medium">🗓 New task: {t.title}</p>
              <p className="text-muted">{t.when}</p>
              {t.state === "off" ? (
                <div className="flex gap-2">
                  <button type="button" onClick={() => void decide(t, true)} className="rounded-lg bg-accent px-3 py-1.5 text-accent-foreground">
                    ✅ Turn on
                  </button>
                  <button type="button" onClick={() => void decide(t, false)} className="rounded-lg border border-line px-3 py-1.5">
                    Discard
                  </button>
                </div>
              ) : (
                <p className="text-muted">{t.state === "on" ? "On. It'll run on schedule." : "Discarded."}</p>
              )}
            </div>
          ))}

          {error && (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-center text-sm text-danger">
              {error}
            </p>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {readOnly ? (
        <div className="border-t border-line bg-surface px-4 py-4 text-center text-sm text-muted">
          This is a scheduled task&apos;s run, kept for reference.{" "}
          <Link href={url(agent.id, "new")} className="text-accent underline">
            Start a new chat
          </Link>{" "}
          to follow up.
        </div>
      ) : (
        <div className="border-t border-line bg-surface px-4 py-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="mx-auto flex w-full max-w-3xl flex-col gap-2"
          >
            {photos.length > 0 && (
              <div className="flex gap-2">
                {photos.map((p, i) => (
                  <div key={i} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local preview of an upload */}
                    <img src={p.preview} alt="" className="h-16 w-16 rounded-lg object-cover" />
                    <button
                      type="button"
                      onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                      className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-xs text-background"
                      aria-label="Remove photo"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  void addPhotos(e.target.files);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={pending || photos.length >= MAX_PHOTOS}
                className="rounded-xl border border-line px-3 py-3 text-sm text-muted transition hover:text-foreground disabled:opacity-40"
                aria-label="Attach a photo"
                title="Attach a photo"
              >
                📎
              </button>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  // Enter sends; Shift+Enter starts a new line.
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                placeholder={`Message ${agent.name}…`}
                aria-label="Message"
                className="flex-1 resize-none overflow-hidden rounded-xl border border-line bg-background px-4 py-3 outline-none transition focus:border-accent"
              />
              <button
                type="submit"
                disabled={pending || (!input.trim() && photos.length === 0)}
                className="rounded-xl bg-accent px-4 py-3 font-medium text-accent-foreground transition hover:opacity-90 disabled:opacity-40"
              >
                Send
              </button>
            </div>
            {agents.length > 1 && agent.primary && (
              <p className="text-center text-[11px] text-muted">
                {agent.name} hands work to your other agents when it fits, or pick one on the left to talk to it directly.
              </p>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
