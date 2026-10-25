import { revalidatePath } from "next/cache";
import { Suspense } from "react";
import { formatCompact } from "@/components/format";
import { SystemHealth } from "@/components/system-health";
import { Badge, Button, Card, Meter, PageHeader } from "@/components/ui";
import { PLAN_LIMITS, resolvePlan } from "@/lib/agents/limits";
import { requireAdmin } from "@/lib/auth/session";
import { currentMonth } from "@/lib/db/queries";
import { adminListUsage, adminListUsers, adminSetUserPlan, adminSetUserStatus } from "@/lib/db/queries/admin";
import type { UserStatus } from "@/lib/db/schema";

async function setStatus(formData: FormData) {
  "use server";
  await requireAdmin();
  const userId = formData.get("userId");
  const status = formData.get("status");
  if (typeof userId !== "string" || (status !== "active" && status !== "waitlist")) return;
  await adminSetUserStatus(userId, status satisfies UserStatus);
  revalidatePath("/admin");
}

const PLANS = Object.keys(PLAN_LIMITS);

async function setPlan(formData: FormData) {
  "use server";
  await requireAdmin();
  const userId = formData.get("userId");
  const plan = formData.get("plan");
  if (typeof userId !== "string" || typeof plan !== "string" || !PLANS.includes(plan)) return;
  await adminSetUserPlan(userId, plan);
  revalidatePath("/admin");
}

export default async function AdminPage() {
  const session = await requireAdmin();
  const month = currentMonth();
  const [users, usage] = await Promise.all([adminListUsers(), adminListUsage(month)]);
  const usageBy = new Map(usage.map((u) => [u.userId, u]));
  const totalTokens = usage.reduce((sum, u) => sum + u.inputTokens + u.outputTokens, 0);
  const totalMessages = usage.reduce((sum, u) => sum + u.messageCount, 0);
  const waitlist = users.filter((u) => u.status === "waitlist");

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-8">
      <PageHeader
        title="System & users"
        description="Owner only. Everything on this page covers every account, not just yours."
        actions={<Badge tone="warning">admin</Badge>}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Health" className="lg:col-span-1">
          <Suspense fallback={<p className="text-sm text-muted">Checking…</p>}>
            <SystemHealth />
          </Suspense>
        </Card>
        <div className="grid gap-6 sm:grid-cols-3 lg:col-span-2 lg:grid-cols-3 lg:content-start">
          <Stat label="Users" value={users.length.toString()} note={`${waitlist.length} on the waitlist`} />
          <Stat label={`Tokens in ${month}`} value={formatCompact(totalTokens)} note="all users" />
          <Stat label={`Messages in ${month}`} value={formatCompact(totalMessages)} note="all users" />
        </div>
      </div>

      <Card title="Users">
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-5 py-2 font-medium">User</th>
                <th className="px-3 py-2 font-medium">Plan</th>
                <th className="px-3 py-2 font-medium">Usage this month</th>
                <th className="px-3 py-2 font-medium">Telegram</th>
                <th className="px-3 py-2 font-medium">Access</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.map((u) => {
                const row = usageBy.get(u.id);
                const used = (row?.inputTokens ?? 0) + (row?.outputTokens ?? 0);
                const limit = PLAN_LIMITS[resolvePlan(u.plan)].monthlyTokens;
                const next: UserStatus = u.status === "active" ? "waitlist" : "active";
                return (
                  <tr key={u.id} className="align-middle">
                    <td className="px-5 py-3">
                      <p className="font-medium">
                        {u.name ?? u.email}
                        {u.id === session.user.id && <span className="ml-2 text-xs font-normal text-muted">(you)</span>}
                      </p>
                      <p className="text-xs text-muted">
                        {u.email} · joined {u.createdAt.toISOString().slice(0, 10)}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <form action={setPlan} className="flex items-center gap-2">
                        <input type="hidden" name="userId" value={u.id} />
                        <select
                          name="plan"
                          defaultValue={u.plan}
                          aria-label={`Plan for ${u.email}`}
                          className="rounded-md border border-line bg-surface px-2 py-1 text-sm"
                        >
                          {PLANS.map((plan) => (
                            <option key={plan} value={plan}>
                              {plan}
                            </option>
                          ))}
                        </select>
                        <Button type="submit" size="sm">
                          Save
                        </Button>
                      </form>
                    </td>
                    <td className="w-48 px-3 py-3">
                      <div className="flex flex-col gap-1.5">
                        <Meter value={(used / limit) * 100} label={`Usage for ${u.email}`} />
                        <span className="text-xs text-muted">
                          {formatCompact(used)} / {formatCompact(limit)} · {row?.messageCount ?? 0} msgs
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {u.telegramChatId ? <Badge tone="success">linked</Badge> : <Badge>not linked</Badge>}
                    </td>
                    <td className="px-3 py-3">
                      <form action={setStatus} className="flex items-center gap-2">
                        <input type="hidden" name="userId" value={u.id} />
                        <input type="hidden" name="status" value={next} />
                        {u.status === "active" ? <Badge tone="success">active</Badge> : <Badge tone="warning">waitlist</Badge>}
                        {u.id !== session.user.id && (
                          <Button type="submit" size="sm" variant={next === "active" ? "primary" : "ghost"}>
                            {next === "active" ? "Let in" : "Move to waitlist"}
                          </Button>
                        )}
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </main>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-line bg-surface p-5">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-muted">{note}</span>
    </div>
  );
}
