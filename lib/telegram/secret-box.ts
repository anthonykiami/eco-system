import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Encryption for agents' bot tokens at rest (AES-256-GCM), with a key derived from AUTH_SECRET,
 * plus the per-bot webhook secret. Rotating AUTH_SECRET makes stored tokens unreadable: the
 * agents' bots then need connecting again.
 */

const key = () => createHash("sha256").update(`telegram-bot-token:${env.AUTH_SECRET}`).digest();

/** "v1.<iv>.<tag>.<ciphertext>", base64url. */
export function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

/** Throws if the value was tampered with or encrypted under another AUTH_SECRET. */
export function decryptToken(sealed: string): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unrecognized encrypted token");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/**
 * The secret Telegram sends with every update for one agent bot, so a webhook call can't be
 * forged for a bot id. Hex, which Telegram's secret_token allows.
 */
export function botWebhookSecret(botId: string): string {
  return createHmac("sha256", env.TELEGRAM_WEBHOOK_SECRET).update(`bot:${botId}`).digest("hex");
}
