import { AppNav } from "@/components/app-nav";
import { LogoMark, Wordmark } from "@/components/logo";
import { SignOutButton } from "@/components/sign-out-button";
import { requireActiveUser } from "@/lib/auth/session";

/** The signed-in app: a floating glass sidebar on wide screens, a top bar on phones. */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await requireActiveUser();
  const { name, email, image, isAdmin } = session.user;
  const label = name ?? email ?? "You";

  return (
    <div className="flex min-h-dvh flex-1">
      <div className="sticky top-0 hidden h-dvh w-64 shrink-0 p-3 md:block">
        <aside className="glass flex h-full flex-col gap-7 rounded-3xl border border-line px-3 py-6">
          <div className="flex flex-col items-center gap-3 px-3">
            <LogoMark className="h-14 w-14" />
            <Wordmark className="text-sm" />
          </div>
          <AppNav isAdmin={Boolean(isAdmin)} layout="sidebar" />
          <div className="flex items-center gap-3 border-t border-line px-2 pt-4">
            <span className="relative">
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element -- Google avatar, tiny and external
                <img src={image} alt="" className="h-9 w-9 rounded-full" referrerPolicy="no-referrer" />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
                  {label.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#0b1511] bg-accent" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{label}</p>
              <p className="text-xs text-muted">{isAdmin ? "Owner · admin" : "Member"}</p>
            </div>
            <SignOutButton />
          </div>
        </aside>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-0 z-10 border-b border-line md:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="flex items-center gap-2">
              <LogoMark className="h-7 w-7" />
              <Wordmark className="text-xs" />
            </span>
            <SignOutButton />
          </div>
          <AppNav isAdmin={Boolean(isAdmin)} layout="bar" />
        </header>
        {children}
      </div>
    </div>
  );
}
