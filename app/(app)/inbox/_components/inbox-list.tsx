"use client";

import { useState } from "react";
import type { PipelineRow } from "@/app/(app)/pipeline/_components/columns";
import { InboxCard } from "./inbox-card";

/**
 * Client wrapper that owns the "hide ineligible" toggle state. Server passes
 * the already-sorted full row list; this splits into eligible + ineligible
 * and hides the second group behind a click-to-reveal button.
 *
 * "Ineligible" = the fit score's class-year component was 0.0 (i.e. we know
 * the user's grad_year and it falls outside the role's stated bounds).
 * Null profile → no fit_details → treated as eligible (unknown).
 */
export function InboxList({ rows }: { rows: PipelineRow[] }) {
  const [showIneligible, setShowIneligible] = useState(false);

  const eligible: PipelineRow[] = [];
  const ineligible: PipelineRow[] = [];
  for (const row of rows) {
    if (row.fit_details?.ineligible) ineligible.push(row);
    else eligible.push(row);
  }

  return (
    <div className="space-y-3">
      {eligible.map((row) => (
        <InboxCard key={row.id} row={row} />
      ))}

      {ineligible.length > 0 && (
        <>
          <div className="flex items-center gap-3 pt-2">
            <hr className="flex-1 border-border" />
            <button
              type="button"
              onClick={() => setShowIneligible((v) => !v)}
              className="text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              {showIneligible ? "Hide" : "Show"} {ineligible.length} ineligible
            </button>
            <hr className="flex-1 border-border" />
          </div>
          {showIneligible &&
            ineligible.map((row) => <InboxCard key={row.id} row={row} />)}
        </>
      )}
    </div>
  );
}
