"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { describeOneClickApp } from "@/lib/agents/composio";
import { requireAdmin } from "@/lib/auth/session";
import { adminAddIntegration, adminRemoveIntegration } from "@/lib/db/queries/admin";

const PATH = "/admin/integrations";

const slugOf = (formData: FormData) => String(formData.get("slug") ?? "").toUpperCase();

/** Offers an app to every user, or refreshes its tool lists if it's already offered. */
export async function addIntegration(formData: FormData) {
  await requireAdmin();
  const entry = await describeOneClickApp(slugOf(formData));
  if (!entry) redirect(`${PATH}?error=unknown`);
  await adminAddIntegration(entry);
  revalidatePath(PATH);
  revalidatePath("/settings/integrations");
  redirect(`${PATH}?added=${encodeURIComponent(entry.name)}`);
}

/** Stops offering an app. Existing connections stay in Composio, but agents no longer use them. */
export async function removeIntegration(formData: FormData) {
  await requireAdmin();
  await adminRemoveIntegration(slugOf(formData));
  revalidatePath(PATH);
  revalidatePath("/settings/integrations");
  redirect(`${PATH}?removed=1`);
}
