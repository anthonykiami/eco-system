import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { SignOutButton } from "@/components/sign-out-button";

export default async function WaitlistPage() {
  const session = await requireSession();
  if (session.user.status === "active") redirect("/");

  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div className="flex max-w-md flex-col items-center gap-4 rounded-2xl border border-line bg-surface p-8 text-center">
        <h1 className="text-2xl font-semibold">You&apos;re on the waitlist</h1>
        <p className="text-muted">
          Thanks for signing up{session.user.email ? ` as ${session.user.email}` : ""}. We&apos;re
          letting people in gradually and will email you as soon as your account is ready.
        </p>
        <SignOutButton />
      </div>
    </main>
  );
}
