// Archive uses the same PipelineTable as /pipeline, so its skeleton mirrors
// the pipeline skeleton — header + filter bar + 10-row table shell.

export default function ArchiveLoading() {
  return (
    <div className="flex h-[calc(100dvh-8rem)] animate-pulse flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <div className="h-6 w-24 rounded bg-muted" />
          <div className="h-3 w-56 rounded bg-muted/60" />
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="h-8 w-24 rounded bg-muted" />
        <div className="h-8 w-32 rounded bg-muted" />
      </div>

      <div className="flex-1 overflow-hidden rounded-md border border-border">
        <div className="h-10 border-b border-border bg-muted/30" />
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="flex h-10 items-center gap-4 border-b border-border/40 px-4"
          >
            <div className="h-3 w-24 rounded bg-muted/50" />
            <div className="h-3 w-32 rounded bg-muted/50" />
            <div className="h-3 w-16 rounded bg-muted/50" />
            <div className="ml-auto h-3 w-16 rounded bg-muted/50" />
          </div>
        ))}
      </div>
    </div>
  );
}
