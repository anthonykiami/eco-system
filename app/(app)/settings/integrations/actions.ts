"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  disconnectToolkit,
  findToolkit,
  getToolkits,
  isAccessLevel,
  startToolkitConnection,
} from "@/lib/agents/composio";
import { requireActiveUser } from "@/lib/auth/session";
import { setIntegrationAccess } from "@/lib/db/queries";
import { env } from "@/lib/env";

const SETTINGS_PATH = "/settings/integrations";

/** Sends the user to the provider's consent screen; Composio returns them here afterwards. */
export async function connectToolkit(formData: FormData) {
  const session = await requireActiveUser();
  const toolkit = findToolkit(await getToolkits(), String(formData.get("slug") ?? ""));
  if (!toolkit) redirect(`${SETTINGS_PATH}?error=unknown`);

  let redirectUrl: string;
  try {
    redirectUrl = await startToolkitConnection(
      session.user.id,
      toolkit.slug,
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

/** Saves how much the agent may do with one toolkit. Takes effect on the next agent run. */
export async function setToolkitAccess(formData: FormData) {
  const session = await requireActiveUser();
  const toolkit = findToolkit(await getToolkits(), String(formData.get("slug") ?? ""));
  const access = String(formData.get("access") ?? "");
  if (!toolkit || !isAccessLevel(toolkit, access)) redirect(`${SETTINGS_PATH}?error=access`);

  await setIntegrationAccess(session.user.id, toolkit.slug, access);
  revalidatePath(SETTINGS_PATH);
  redirect(`${SETTINGS_PATH}?saved=1`);
}
