"use client";

import Link from "next/link";
import { buttonClass } from "@/components/ui";

/** Shown instead of a broken page when something on it fails to load. */
export default function AppError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold">This page couldn&apos;t load</h1>
      <p className="text-sm text-muted">
        One of the services behind it may be having trouble. Your agents and data are fine. Try again in a moment.
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={retry} className={buttonClass("primary")}>
          Try again
        </button>
        <Link href="/" className={buttonClass("secondary")}>
          Dashboard
        </Link>
      </div>
    </main>
  );
}
