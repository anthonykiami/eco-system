import { z } from "zod";
import { auth } from "@/auth";
import { runAgent } from "@/lib/agents";
import { isAgentError } from "@/lib/agents/errors";
import { createChat, ensurePrimaryAgent, getAgent, getJob, getUser, NotFoundError } from "@/lib/db/queries";
import { describeJob } from "@/lib/heartbeat/briefing";

// The turn streams for up to 240s (lib/agents/primary).
export const maxDuration = 300;

/** Photos are resized in the browser first; this keeps the request under Vercel's 4.5 MB. */
const MAX_IMAGE_CHARS = 1_400_000;

const bodySchema = z
  .object({
    message: z.string().trim().max(8000),
    /** Continue this conversation. Without it, a new one starts with `agentId` (default: main agent). */
    chatId: z.string().min(1).optional(),
    agentId: z.string().min(1).optional(),
    images: z
      .array(
        z.object({
          data: z.string().max(MAX_IMAGE_CHARS),
          mediaType: z.enum(["image/jpeg", "image/png", "image/gif", "image/webp"]),
        }),
      )
      .max(3)
      .default([]),
  })
  .refine((b) => b.message.length > 0 || b.images.length > 0, "Say something or attach a photo");

/** What the browser receives, one JSON object per line. */
export type ChatEvent =
  | { type: "chat"; chatId: string }
  | { type: "partial"; text: string }
  | { type: "delegate"; name: string }
  | { type: "task"; id: string; title: string; when: string }
  | { type: "done"; text: string }
  | { type: "error"; message: string };

export async function POST(request: Request) {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (user.status !== "active") return Response.json({ error: "You're still on the waitlist." }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { message, images, agentId } = parsed.data;
  const userId = user.id;

  // A new conversation is created up front, so the browser can show it in the list right away.
  let chatId = parsed.data.chatId;
  if (!chatId) {
    const agent = agentId ? await getAgent(userId, agentId) : await ensurePrimaryAgent(userId);
    if (!agent) return Response.json({ error: "That agent no longer exists." }, { status: 404 });
    chatId = (await createChat(userId, { agentId: agent.id, channel: "web" })).id;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      send({ type: "chat", chatId });
      const taskIds: string[] = [];
      try {
        const result = await runAgent({
          userId,
          chatId,
          message,
          images: images.map((i) => ({ data: Buffer.from(i.data, "base64"), mediaType: i.mediaType })),
          channel: "web",
          onPartialText: (text) => send({ type: "partial", text }),
          onDelegate: ({ name }) => send({ type: "delegate", name }),
          onTaskScheduled: ({ id }) => taskIds.push(id),
        });
        // Tasks an agent creates start switched off; the browser offers to turn them on.
        const timezone = (await getUser(userId))?.timezone ?? "UTC";
        for (const id of taskIds) {
          const job = await getJob(userId, id);
          if (job) send({ type: "task", id, title: job.prompt.split("\n")[0].slice(0, 120), when: describeJob(job, timezone) });
        }
        send({ type: "done", text: result.text });
      } catch (err) {
        if (isAgentError(err)) send({ type: "error", message: err.userMessage });
        else if (err instanceof NotFoundError) send({ type: "error", message: "That conversation no longer exists." });
        else if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
          send({ type: "error", message: "That took too long and I had to stop. Try asking for something narrower." });
        } else {
          console.error("[api/chat] run failed", err);
          send({ type: "error", message: "Something went wrong. Please try again in a moment." });
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-cache" } });
}
