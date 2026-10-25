import { signOut } from "@/auth";

export function SignOutButton() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
    >
      <button type="submit" className="rounded-md px-2 py-1 text-xs text-muted transition hover:bg-surface-muted hover:text-foreground">
        Sign out
      </button>
    </form>
  );
}
