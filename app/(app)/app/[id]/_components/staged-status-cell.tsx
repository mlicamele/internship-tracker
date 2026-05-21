"use client";

import type { ApplicationStatus } from "@/lib/db/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  StatusPill,
  STATUS_OPTIONS,
} from "@/app/(app)/pipeline/_components/cell-formatters";

/**
 * Controlled clone of the pipeline's StatusCell — same pill-dropdown visual,
 * but on selection it just calls `onChange` (no server action). Persistence
 * is handled by the outer Save button on the detail page.
 */
export function StagedStatusCell({
  value,
  onChange,
}: {
  value: ApplicationStatus;
  onChange: (next: ApplicationStatus) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Status: ${value}`}
        className="cursor-pointer rounded-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <StatusPill status={value} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {STATUS_OPTIONS.map(({ value: v, label }) => (
          <DropdownMenuItem
            key={v}
            disabled={v === value}
            onClick={(e) => {
              e.stopPropagation();
              if (v !== value) onChange(v);
            }}
          >
            <StatusPill status={v} />
            <span className="ml-2 text-sm">{label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
