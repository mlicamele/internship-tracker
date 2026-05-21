"use client";

import type { Column } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import type { ApplicationStatus } from "@/lib/db/types";
import { STATUS_OPTIONS, StatusPill } from "./cell-formatters";

/**
 * Three-state status filter:
 *   - undefined value  → "All"  (no filter, all rows shown)
 *   - [] value         → "None" (explicit empty, no rows shown)
 *   - [status, …]      → only those statuses shown
 *
 * Clicking the All button toggles between the All and None states.
 */
export function StatusFilter<TData>({
  column,
}: {
  column: Column<TData, unknown>;
}) {
  const raw = column.getFilterValue() as ApplicationStatus[] | undefined;
  const isAll = raw === undefined;
  const isNone = Array.isArray(raw) && raw.length === 0;
  const value = raw ?? [];

  function toggle(status: ApplicationStatus) {
    // Picking an individual status leaves None / All states
    const base = isAll || isNone ? [] : value;
    if (base.includes(status)) {
      const next = base.filter((s) => s !== status);
      // Falling back to zero selected from individual selection ⇒ "All"
      column.setFilterValue(next.length === 0 ? undefined : next);
    } else {
      column.setFilterValue([...base, status]);
    }
  }

  function toggleAll() {
    if (isAll) {
      column.setFilterValue([]); // → None
    } else {
      column.setFilterValue(undefined); // → All
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={toggleAll}
        className={cn(
          "rounded-sm border px-2 py-1 text-xs transition-colors",
          isAll && "border-foreground bg-foreground text-background",
          isNone && "border-destructive bg-destructive/10 text-destructive",
          !isAll && !isNone && "border-border text-muted-foreground hover:text-foreground"
        )}
      >
        {isNone ? "None" : "All"}
      </button>
      {STATUS_OPTIONS.map(({ value: status }) => {
        const selected = value.includes(status);
        return (
          <button
            key={status}
            type="button"
            onClick={() => toggle(status)}
            className={cn(
              "rounded-sm transition-opacity",
              (isNone || (!isAll && !selected)) && "opacity-40 hover:opacity-100"
            )}
          >
            <StatusPill status={status} />
          </button>
        );
      })}
    </div>
  );
}
