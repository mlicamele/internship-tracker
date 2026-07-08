"use client";

import type { Column } from "@tanstack/react-table";
import { INTEREST_TAGS } from "@/lib/taxonomy";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * Multi-select tag filter. Semantics: "show roles matching ANY selected tag."
 * Empty selection = no filter (all rows visible). Column filterFn lives in
 * columns.tsx on the "tags" column.
 */
export function TagFilter<TData>({ column }: { column: Column<TData, unknown> }) {
  const raw = column.getFilterValue() as string[] | undefined;
  const selected = raw ?? [];

  function toggle(tag: string) {
    if (selected.includes(tag)) {
      const next = selected.filter((t) => t !== tag);
      column.setFilterValue(next.length === 0 ? undefined : next);
    } else {
      column.setFilterValue([...selected, tag]);
    }
  }

  function clear() {
    column.setFilterValue(undefined);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            selected.length > 0 && "border-foreground text-foreground"
          )}
        >
          Tags {selected.length > 0 && `(${selected.length})`}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-80 w-56 overflow-y-auto"
        >
          <DropdownMenuLabel>Filter by tag (any of)</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {INTEREST_TAGS.map((tag) => (
            <DropdownMenuCheckboxItem
              key={tag}
              checked={selected.includes(tag)}
              onCheckedChange={() => toggle(tag)}
              onSelect={(e) => e.preventDefault()}
            >
              {tag}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {selected.map((tag) => (
        <button
          key={tag}
          type="button"
          onClick={() => toggle(tag)}
          className="inline-flex items-center gap-1 rounded-sm bg-foreground px-2 py-1 text-xs font-medium text-background hover:opacity-90"
          title={`Remove ${tag} from filter`}
        >
          {tag} <span aria-hidden>×</span>
        </button>
      ))}
      {selected.length > 0 && (
        <button
          type="button"
          onClick={clear}
          className="rounded-sm px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Clear
        </button>
      )}
    </div>
  );
}
