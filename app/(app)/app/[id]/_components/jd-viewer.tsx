"use client";

import { useState } from "react";

const COLLAPSE_THRESHOLD = 1500;

export function JdViewer({ body }: { body: string | null }) {
  const [expanded, setExpanded] = useState(false);

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

  const shouldCollapse = body.length > COLLAPSE_THRESHOLD;
  const visibleBody = shouldCollapse && !expanded ? body.slice(0, COLLAPSE_THRESHOLD) : body;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Job description
        </h2>
        {shouldCollapse && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {expanded ? "Collapse" : `Show full (${body.length.toLocaleString()} chars)`}
          </button>
        )}
      </div>
      <div className="rounded-md border border-border bg-card/40 p-4">
        <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
          {visibleBody}
          {shouldCollapse && !expanded && (
            <span className="text-muted-foreground">…</span>
          )}
        </pre>
      </div>
    </div>
  );
}
