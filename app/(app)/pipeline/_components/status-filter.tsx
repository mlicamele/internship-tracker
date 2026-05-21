"use client";

import type { Column } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import type { ApplicationStatus } from "@/lib/db/types";
import { STATUS_OPTIONS, StatusPill } from "./cell-formatters";

export function StatusFilter<TData>({
  column,
}: {
  column: Column<TData, unknown>;
}) {
  const value = (column.getFilterValue() as ApplicationStatus[]) ?? [];
  const isAllSelected = value.length === 0;

  function toggle(status: ApplicationStatus) {
    if (value.includes(status)) {
      const next = value.filter((s) => s !== status);
      column.setFilterValue(next.length === 0 ? undefined : next);
    } else {
      column.setFilterValue([...value, status]);
    }
  }

  function reset() {
    column.setFilterValue(undefined);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={reset}
        className={cn(
          "rounded-sm border px-2 py-1 text-xs transition-colors",
          isAllSelected
            ? "border-foreground bg-foreground text-background"
            : "border-border text-muted-foreground hover:text-foreground"
        )}
      >
        All
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
              !isAllSelected && !selected && "opacity-50 hover:opacity-100"
            )}
          >
            <StatusPill status={status} />
          </button>
        );
      })}
    </div>
  );
}
