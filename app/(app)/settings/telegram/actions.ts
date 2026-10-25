"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/auth/session";
import { clearTelegramChatId } from "@/lib/db/queries";
import { createLinkCode } from "@/lib/telegram/linking";

export type ConnectState =
  | { status: "idle" }
  | { status: "ok"; code: string; deepLink: string; expiresAt: string }
  | { status: "error"; message: string };

export async function connectTelegram(): Promise<ConnectState> {
  const session = await requireActiveUser();
  try {
    const { code, deepLink, expiresAt } = await createLinkCode(session.user.id);
    return { status: "ok", code, deepLink, expiresAt: expiresAt.toISOString() };
  } catch (err) {
    console.error("[telegram] failed to create link code", err);
    return { status: "error", message: "Couldn't create a link code. Please try again." };
  }
}

export async function unlinkTelegram(): Promise<void> {
  const session = await requireActiveUser();
  await clearTelegramChatId(session.user.id);
  revalidatePath("/settings/telegram");
}
