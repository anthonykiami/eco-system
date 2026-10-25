import { AppNav } from "@/components/app-nav";
import { SignOutButton } from "@/components/sign-out-button";
import { requireActiveUser } from "@/lib/auth/session";

/** The signed-in app: a sidebar on wide screens, a top bar on phones. */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await requireActiveUser();
  const { name, email, image, isAdmin } = session.user;
  const label = name ?? email ?? "You";

  return (
    <div className="flex min-h-dvh flex-1">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 border-r border-line bg-surface px-3 py-5 md:flex">
        <div className="flex items-center gap-2 px-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-sm font-bold text-accent-foreground">
            A
          </span>
          <span className="font-semibold tracking-tight">Assistant</span>
        </div>
        <AppNav isAdmin={Boolean(isAdmin)} layout="sidebar" />
        <div className="flex items-center gap-3 border-t border-line px-3 pt-4">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element -- Google avatar, tiny and external
            <img src={image} alt="" className="h-8 w-8 rounded-full" referrerPolicy="no-referrer" />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-muted text-sm">
              {label.slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{label}</p>
            <p className="text-xs text-muted">{isAdmin ? "Owner · admin" : "Member"}</p>
          </div>
          <SignOutButton />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b border-line bg-surface md:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="font-semibold tracking-tight">Assistant</span>
            <SignOutButton />
          </div>
          <AppNav isAdmin={Boolean(isAdmin)} layout="bar" />
        </header>
        {children}
      </div>
    </div>
  );
}
