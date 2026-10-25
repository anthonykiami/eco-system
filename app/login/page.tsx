import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { LogoMark, Wordmark } from "@/components/logo";

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
      <div className="glass flex w-full max-w-sm flex-col items-center gap-6 rounded-3xl border border-line p-10">
        <LogoMark className="h-16 w-16" />
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-lg">
            <Wordmark />
          </h1>
          <p className="eyebrow">Intelligence in balance</p>
          <p className="mt-2 text-sm text-muted">Your AI agents, working together in Telegram and on the web.</p>
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
            className="w-full rounded-full bg-accent px-4 py-2.5 font-medium text-accent-foreground shadow-[0_0_22px_-6px_rgba(94,230,168,0.7)] transition hover:brightness-110"
          >
            Continue with Google
          </button>
        </form>
      </div>
    </main>
  );
}
