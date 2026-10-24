import { env } from "@/lib/env";
import { qstashReceiver } from "@/lib/upstash";

/**
 * Verifies the `upstash-signature` header against the raw body and the expected URL.
 * Returns the raw body on success, or null if the request is not from QStash.
 */
export async function verifyQStashRequest(req: Request, path: string): Promise<string | null> {
  const signature = req.headers.get("upstash-signature");
  if (!signature) return null;
  const body = await req.text();
  try {
    const valid = await qstashReceiver.verify({
      signature,
      body,
      url: new URL(path, env.APP_URL).toString(),
    });
    return valid ? body : null;
  } catch (err) {
    // Usually APP_URL not matching the URL QStash called, or stale signing keys.
    console.warn(`[qstash] rejected request to ${path}`, err instanceof Error ? err.message : err);
    return null;
  }
}
