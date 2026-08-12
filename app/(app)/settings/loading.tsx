// Settings is a narrower, form-heavy page — max-w-lg with header, form
// fields, and a resume section. Skeleton mirrors that shape.

export default function SettingsLoading() {
  return (
    <div className="mx-auto max-w-lg animate-pulse space-y-6">
      <header className="space-y-2">
        <div className="h-7 w-32 rounded bg-muted" />
        <div className="h-3 w-72 rounded bg-muted/60" />
      </header>

      <div className="space-y-4 rounded-md border border-border p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="h-3 w-24 rounded bg-muted/60" />
            <div className="h-9 rounded bg-muted/70" />
          </div>
        ))}
        <div className="h-9 w-20 rounded bg-muted" />
      </div>

      <div className="space-y-3 rounded-md border border-border p-4">
        <div className="h-5 w-40 rounded bg-muted" />
        <div className="h-3 w-full rounded bg-muted/60" />
        <div className="h-24 rounded bg-muted/40" />
      </div>
    </div>
  );
}
