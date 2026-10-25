"use client";

import { useActionState } from "react";
import { buttonClass } from "@/components/ui";
import { connectTelegram, type ConnectState } from "./actions";

export function ConnectForm() {
  const [state, action, pending] = useActionState<ConnectState>(connectTelegram, {
    status: "idle",
  });

  return (
    <div className="flex flex-col gap-4">
      <form action={action}>
        <button type="submit" disabled={pending} className={buttonClass("primary")}>
          {pending ? "Generating…" : state.status === "ok" ? "Get a new code" : "Connect Telegram"}
        </button>
      </form>

      {state.status === "error" && <p className="text-sm text-danger">{state.message}</p>}

      {state.status === "ok" && (
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-muted p-4 text-sm">
          <p>
            <a href={state.deepLink} target="_blank" rel="noopener noreferrer" className="font-medium text-accent underline">
              Open Telegram to link
            </a>{" "}
            and tap <b>Start</b>. Or send this to the bot:
          </p>
          <code className="self-start rounded-lg bg-surface px-3 py-2 font-mono text-lg tracking-widest">
            /link {state.code}
          </code>
          <p className="text-muted">
            This code works once and expires at{" "}
            {new Date(state.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Reload this page
            once the bot confirms.
          </p>
        </div>
      )}
    </div>
  );
}
