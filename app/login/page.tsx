import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const session = await auth();
  if (session?.user) redirect("/");

  const { callbackUrl } = await searchParams;
  // Only allow same-origin relative redirects.
  const redirectTo =
    typeof callbackUrl === "string" && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")
      ? callbackUrl
      : "/";

  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-lg font-bold text-accent-foreground">
          A
        </span>
        <div className="text-center">
          <h1 className="text-xl font-semibold">Sign in to Assistant</h1>
          <p className="mt-1 text-sm text-muted">Your agents, in Telegram and on the web.</p>
        </div>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo });
          }}
          className="w-full"
        >
          <button
            type="submit"
            className="w-full rounded-lg bg-accent px-4 py-2.5 font-medium text-accent-foreground transition hover:opacity-90"
          >
            Continue with Google
          </button>
        </form>
      </div>
    </main>
  );
}
