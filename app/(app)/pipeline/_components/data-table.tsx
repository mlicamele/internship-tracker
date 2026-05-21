"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { Eye } from "@/components/icons";
import {
  DEFAULT_HIDDEN_COLUMNS,
  MOBILE_HIDDEN_COLUMNS,
  pipelineColumns,
  type PipelineRow,
} from "./columns";
import { ColumnVisibilityMenu } from "./column-visibility-menu";
import { StatusFilter } from "./status-filter";

// Sticky-column widths (must match the <th>/<td> widths)
const EDIT_COL_W = 76; // px — fits "👁 Edit"
const COMPANY_COL_W = 180; // px
const ROLE_COL_MAX_W = 280; // px — max width before role-title wraps

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

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns: pipelineColumns,
    state: { sorting, columnFilters, columnVisibility },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const statusColumn = table.getColumn("status");
  const visibleRows = table.getRowModel().rows;

  const mobileHiddenSet = useMemo(() => new Set(MOBILE_HIDDEN_COLUMNS), []);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {statusColumn && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <StatusFilter column={statusColumn} />
          <ColumnVisibilityMenu table={table} />
        </div>
      )}

      <div className="flex-1 overflow-auto rounded-md border border-border">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-30 bg-background shadow-[0_1px_0_0_var(--color-border)]">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-border">
                {/* Sticky: edit-button column header */}
                <th
                  className="sticky left-0 z-30 h-9 bg-background px-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
                  style={{ width: EDIT_COL_W, minWidth: EDIT_COL_W }}
                >
                  Edit
                </th>
                {headerGroup.headers.map((header) => {
                  const isCompany = header.column.id === "company";
                  const isRole = header.column.id === "role";
                  return (
                    <th
                      key={header.id}
                      className={cn(
                        "h-9 whitespace-nowrap px-3 text-left align-middle border-r border-border/40 last:border-r-0",
                        mobileHiddenSet.has(header.column.id) &&
                          "hidden md:table-cell",
                        isCompany &&
                          "sticky z-20 bg-background shadow-[2px_0_0_0_var(--color-foreground)]"
                      )}
                      style={
                        isCompany
                          ? { left: EDIT_COL_W, minWidth: COMPANY_COL_W }
                          : isRole
                            ? { maxWidth: ROLE_COL_MAX_W }
                            : undefined
                      }
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </th>
                  );
                })}
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
              visibleRows.map((row) => (
                <tr
                  key={row.id}
                  className="group/row border-b border-border last:border-b-0 transition-colors hover:bg-muted"
                >
                  {/* Sticky: open-detail button */}
                  <td
                    className="sticky left-0 z-20 bg-background px-1 py-2 group-hover/row:bg-muted"
                    style={{ width: EDIT_COL_W, minWidth: EDIT_COL_W }}
                  >
                    <Link
                      href={`/app/${row.original.id}`}
                      aria-label="Open detail page"
                      title="Open detail page"
                      className="inline-flex items-center gap-1 rounded-sm border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    >
                      <Eye className="size-3.5" />
                      Edit
                    </Link>
                  </td>
                  {row.getVisibleCells().map((cell) => {
                    const isCompany = cell.column.id === "company";
                    const isRole = cell.column.id === "role";
                    const allowWrap = isCompany || isRole;
                    return (
                      <td
                        key={cell.id}
                        className={cn(
                          "px-3 py-2 align-middle border-r border-border/40 last:border-r-0",
                          !allowWrap && "whitespace-nowrap",
                          allowWrap && "whitespace-normal break-words",
                          mobileHiddenSet.has(cell.column.id) &&
                            "hidden md:table-cell",
                          isCompany &&
                            "sticky z-10 bg-background shadow-[2px_0_0_0_var(--color-foreground)] group-hover/row:bg-muted"
                        )}
                        style={
                          isCompany
                            ? { left: EDIT_COL_W, minWidth: COMPANY_COL_W, maxWidth: COMPANY_COL_W }
                            : isRole
                              ? { maxWidth: ROLE_COL_MAX_W }
                              : undefined
                        }
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="shrink-0 text-xs text-muted-foreground">
        {visibleRows.length} of {rows.length} application
        {rows.length === 1 ? "" : "s"} shown
      </p>
    </div>
  );
}
