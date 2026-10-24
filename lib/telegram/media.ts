import type { AgentImage } from "@/lib/agents";
import { env } from "@/lib/env";
import { createRatelimit } from "@/lib/upstash";
import { downloadFile, TELEGRAM_DOWNLOAD_LIMIT } from "./api";
import type { TelegramMessage } from "./types";

/**
 * Turning what users send into something the agent reads: photos go to Claude as images, and
 * voice messages are transcribed by Groq's Whisper (Claude can't hear audio).
 */

/** Claude scales anything larger down to about this on its long side, so bigger costs more for nothing. */
export const MAX_IMAGE_SIDE = 1568;
/** Claude's per-image limit. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Longer recordings are refused rather than transcribed. */
export const MAX_VOICE_SECONDS = 10 * 60;
const VOICE_PER_DAY = 100;

const GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL = "whisper-large-v3-turbo";

/** Caps transcription spend per user. */
const voiceLimit = createRatelimit("telegram-voice", VOICE_PER_DAY, "1 d");

export type Media =
  | { kind: "photo"; fileId: string; mediaType: AgentImage["mediaType"] }
  | { kind: "voice"; fileId: string; duration: number; size?: number; filename: string }
  | { kind: "video" }
  | { kind: "file" };

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
const isImageType = (type: string | undefined): type is AgentImage["mediaType"] =>
  IMAGE_TYPES.includes(type as AgentImage["mediaType"]);

/** What kind of non-text content a message carries, if any. */
export function mediaOf(message: TelegramMessage): Media | undefined {
  if (message.photo?.length) {
    // The largest size Claude would use in full; Telegram photos are always JPEG.
    const fits = message.photo.filter((p) => Math.max(p.width, p.height) <= MAX_IMAGE_SIDE);
    const best = fits.at(-1) ?? message.photo[0];
    return { kind: "photo", fileId: best.file_id, mediaType: "image/jpeg" };
  }
  const audio = message.voice ?? message.video_note ?? message.audio;
  if (audio) {
    // Groq tells formats apart by file name.
    const filename = message.voice ? "voice.ogg" : message.video_note ? "video.mp4" : (message.audio?.file_name ?? "audio.mp3");
    return { kind: "voice", fileId: audio.file_id, duration: audio.duration, size: audio.file_size, filename };
  }
  if (message.video) return { kind: "video" };
  if (message.document) {
    const { mime_type, file_size, file_id } = message.document;
    if (isImageType(mime_type) && (file_size ?? 0) <= MAX_IMAGE_BYTES) {
      return { kind: "photo", fileId: file_id, mediaType: mime_type };
    }
    return { kind: "file" };
  }
  return undefined;
}

export async function downloadImage(media: Extract<Media, { kind: "photo" }>): Promise<AgentImage> {
  return { data: await downloadFile(media.fileId), mediaType: media.mediaType };
}

export type Transcription =
  | { ok: true; text: string }
  | { ok: false; reason: "unavailable" | "too_long" | "daily_limit" | "empty" };

/** Transcribes a voice message for `userId`, within the length and daily limits. */
export async function transcribe(userId: string, media: Extract<Media, { kind: "voice" }>): Promise<Transcription> {
  if (!env.GROQ_API_KEY) return { ok: false, reason: "unavailable" };
  if (media.duration > MAX_VOICE_SECONDS || (media.size ?? 0) > TELEGRAM_DOWNLOAD_LIMIT) {
    return { ok: false, reason: "too_long" };
  }
  if (!(await voiceLimit.limit(userId)).success) return { ok: false, reason: "daily_limit" };

  const audio = await downloadFile(media.fileId);
  const form = new FormData();
  form.append("file", new Blob([audio as BlobPart]), media.filename);
  form.append("model", GROQ_MODEL);
  form.append("response_format", "json");
  const res = await fetch(GROQ_TRANSCRIBE_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${env.GROQ_API_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Groq transcription failed (${res.status}): ${await res.text().catch(() => "")}`);
  const text = ((await res.json()) as { text?: string }).text?.trim() ?? "";
  return text ? { ok: true, text } : { ok: false, reason: "empty" };
}
