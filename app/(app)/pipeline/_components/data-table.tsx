"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import {
  type ColumnFiltersState,
  type ExpandedState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { ChevronRight, ChevronDown, ExternalLink } from "@/components/icons";
import { ExpandedRow } from "./expanded-row";
import {
  DEFAULT_HIDDEN_COLUMNS,
  MOBILE_HIDDEN_COLUMNS,
  pipelineColumns,
  type PipelineRow,
} from "./columns";
import { ColumnVisibilityMenu } from "./column-visibility-menu";
import { StatusFilter } from "./status-filter";

export function PipelineTable({
  rows,
  emptyState,
}: {
  rows: PipelineRow[];
  emptyState?: React.ReactNode;
}) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "deadline", desc: false },
  ]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    DEFAULT_HIDDEN_COLUMNS
  );
  const [expanded, setExpanded] = useState<ExpandedState>({});

  const table = useReactTable({
    data: rows,
    columns: pipelineColumns,
    state: { sorting, columnFilters, columnVisibility, expanded },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onExpandedChange: setExpanded,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: () => true,
  });

  const statusColumn = table.getColumn("status");
  const visibleRows = table.getRowModel().rows;

  const mobileHiddenSet = useMemo(() => new Set(MOBILE_HIDDEN_COLUMNS), []);

  return (
    <div className="space-y-4">
      {statusColumn && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <StatusFilter column={statusColumn} />
          <ColumnVisibilityMenu table={table} />
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-background">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-border">
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className={cn(
                      "h-9 whitespace-nowrap px-3 text-left align-middle",
                      mobileHiddenSet.has(header.column.id) && "hidden md:table-cell"
                    )}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </th>
                ))}
                <th aria-hidden className="w-8" />
              </tr>
            ))}
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td
                  colSpan={table.getAllLeafColumns().length + 1}
                  className="p-8 text-center text-sm text-muted-foreground"
                >
                  {emptyState ?? "No applications match the current filters."}
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => {
                const isExpanded = row.getIsExpanded();
                return (
                  <Fragment key={row.id}>
                    <tr
                      className={cn(
                        "border-b border-border last:border-b-0 transition-colors hover:bg-muted/20",
                        isExpanded && "bg-muted/40"
                      )}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td
                          key={cell.id}
                          className={cn(
                            "px-3 py-2 align-middle whitespace-nowrap",
                            mobileHiddenSet.has(cell.column.id) && "hidden md:table-cell"
                          )}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                      <td className="w-16 pr-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            aria-label={isExpanded ? "Collapse row" : "Expand row"}
                            onClick={() => row.toggleExpanded()}
                            className="inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            {isExpanded ? (
                              <ChevronDown className="size-4" />
                            ) : (
                              <ChevronRight className="size-4" />
                            )}
                          </button>
                          <Link
                            href={`/app/${row.original.id}`}
                            aria-label="Open full detail page"
                            className="inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                            title="Open detail page"
                          >
                            <ExternalLink className="size-3.5" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b border-border last:border-b-0 bg-muted/10">
                        <td colSpan={row.getVisibleCells().length + 1} className="p-0">
                          <ExpandedRow
                            application={row.original}
                            onClose={() => row.toggleExpanded(false)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        {visibleRows.length} of {rows.length} application
        {rows.length === 1 ? "" : "s"} shown
      </p>
    </div>
  );
}
