// Route-level loading skeleton for /inbox. Mirrors InboxPage layout:
// header + resume picker row + a few card placeholders.

export default function InboxLoading() {
  return (
    <div className="animate-pulse space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <div className="h-6 w-24 rounded bg-muted" />
          <div className="h-3 w-56 rounded bg-muted/60" />
        </div>
        <div className="h-9 w-20 rounded bg-muted" />
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="h-8 w-56 rounded bg-muted" />
        <div className="h-8 w-32 rounded bg-muted" />
      </div>

      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="space-y-3 rounded-lg border border-border bg-card/40 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 space-y-2">
                <div className="h-5 w-40 rounded bg-muted" />
                <div className="h-3 w-56 rounded bg-muted/60" />
              </div>
              <div className="space-y-1">
                <div className="h-6 w-24 rounded bg-muted" />
                <div className="h-5 w-20 rounded bg-muted/70" />
                <div className="h-5 w-20 rounded bg-muted/70" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3 md:grid-cols-4">
              {Array.from({ length: 8 }).map((_, j) => (
                <div key={j} className="space-y-1">
                  <div className="h-3 w-16 rounded bg-muted/50" />
                  <div className="h-4 w-24 rounded bg-muted/70" />
                </div>
              ))}
            </div>
            <div className="flex gap-2 border-t border-border pt-3">
              <div className="h-8 flex-1 rounded bg-muted" />
              <div className="h-8 flex-1 rounded bg-muted/70" />
              <div className="h-8 flex-1 rounded bg-muted/50" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
