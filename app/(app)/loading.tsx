/** Shown while a page's data loads (Integrations asks Composio, which can take a few seconds). */
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-8" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-48 animate-pulse rounded-lg bg-surface-muted" />
      <div className="grid gap-6 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-40 animate-pulse rounded-2xl border border-line bg-surface" />
        ))}
      </div>
    </main>
  );
}
