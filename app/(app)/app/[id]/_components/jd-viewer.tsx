export function JdViewer({ body }: { body: string | null }) {
  if (!body || !body.trim()) {
    return (
      <div className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Job description
        </h2>
        <p className="text-sm text-muted-foreground italic">
          No JD body captured.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Job description
        </h2>
        <span className="text-xs text-muted-foreground">
          {body.length.toLocaleString()} chars
        </span>
      </div>
      <div className="max-h-[480px] overflow-y-auto rounded-md border border-border bg-card/40 p-4">
        <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
          {body}
        </pre>
      </div>
    </div>
  );
}
