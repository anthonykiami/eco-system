"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  disconnectToolkit,
  isToolkitSlug,
  startToolkitConnection,
} from "@/lib/agents/composio";
import { requireActiveUser } from "@/lib/auth/session";
import { env } from "@/lib/env";

const SETTINGS_PATH = "/settings/integrations";

/** Sends the user to the provider's consent screen; Composio returns them here afterwards. */
export async function connectToolkit(formData: FormData) {
  const session = await requireActiveUser();
  const slug = String(formData.get("slug") ?? "");
  if (!isToolkitSlug(slug)) redirect(`${SETTINGS_PATH}?error=unknown`);

  let redirectUrl: string;
  try {
    redirectUrl = await startToolkitConnection(
      session.user.id,
      slug,
      new URL(SETTINGS_PATH, env.APP_URL).toString(),
    );
  } catch (err) {
    console.error("[integrations] could not start connection", err);
    redirect(`${SETTINGS_PATH}?error=start`);
  }
  redirect(redirectUrl);
}

export async function removeToolkit(formData: FormData) {
  const session = await requireActiveUser();
  const connectedAccountId = String(formData.get("connectedAccountId") ?? "");
  if (!connectedAccountId) return;

  try {
    await disconnectToolkit(session.user.id, connectedAccountId);
  } catch (err) {
    console.error("[integrations] could not disconnect", err);
    redirect(`${SETTINGS_PATH}?error=disconnect`);
  }
  revalidatePath(SETTINGS_PATH);
}
