"use client";

import type { ColumnDef, Row } from "@tanstack/react-table";
import type { ApplicationRow } from "@/lib/db/applications";
import type { ApplicationStatus } from "@/lib/db/types";
import { ArrowUpDown } from "@/components/icons";
import {
  RelocationAssistanceCell,
  WorkModelCell,
  formatCompensation,
  formatDate,
  formatDistance,
  formatLocations,
  formatMaxGradYear,
  formatNextInterview,
  formatTargetTerm,
} from "./cell-formatters";
import { StatusCell } from "./status-cell";

export interface PipelineRow extends ApplicationRow {
  distance_miles: number | null;
}

const SORT_HEADER = (label: string) => {
  function SortHeader({
    column,
  }: {
    column: { toggleSorting: (desc?: boolean) => void; getIsSorted: () => false | "asc" | "desc" };
  }) {
    const sorted = column.getIsSorted();
    return (
      <button
        type="button"
        onClick={() => column.toggleSorting(sorted === "asc")}
        className="-mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-xs font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
      >
        {label}
        <ArrowUpDown
          className="size-3 opacity-50"
          direction={sorted === false ? "both" : sorted}
        />
      </button>
    );
  }
  return SortHeader;
};

export const pipelineColumns: ColumnDef<PipelineRow>[] = [
  {
    id: "company",
    accessorFn: (row) => row.role.company.name,
    header: SORT_HEADER("Company"),
    cell: ({ row }) => (
      <span className="font-medium">{row.original.role.company.name}</span>
    ),
    enableHiding: false,
  },
  {
    id: "role",
    accessorFn: (row) => row.role.title,
    header: SORT_HEADER("Role"),
    cell: ({ row }) => row.original.role.title,
    enableHiding: false,
  },
  {
    id: "status",
    accessorKey: "status",
    header: SORT_HEADER("Status"),
    cell: ({ row }) => (
      <StatusCell applicationId={row.original.id} status={row.original.status} />
    ),
    filterFn: (row: Row<PipelineRow>, columnId: string, filterValue: ApplicationStatus[]) => {
      if (!filterValue || filterValue.length === 0) return true;
      return filterValue.includes(row.getValue(columnId) as ApplicationStatus);
    },
    enableHiding: false,
  },
  {
    id: "target",
    accessorFn: (row) => row.role.target_year ?? 0,
    header: SORT_HEADER("Target"),
    cell: ({ row }) =>
      formatTargetTerm(row.original.role.target_year, row.original.role.target_season),
  },
  {
    id: "deadline",
    accessorFn: (row) =>
      row.role.deadline_at ? new Date(row.role.deadline_at).getTime() : Number.POSITIVE_INFINITY,
    header: SORT_HEADER("Deadline"),
    cell: ({ row }) => formatDate(row.original.role.deadline_at),
  },
  {
    id: "location",
    accessorFn: (row) => row.role.locations[0]?.text ?? "",
    header: SORT_HEADER("Location"),
    cell: ({ row }) => formatLocations(row.original.role.locations),
  },
  {
    id: "work_model",
    accessorFn: (row) => row.role.work_model,
    header: SORT_HEADER("Mode"),
    cell: ({ row }) => <WorkModelCell model={row.original.role.work_model} />,
  },
  {
    id: "compensation",
    accessorFn: (row) => row.role.compensation_hourly_dollars ?? 0,
    header: SORT_HEADER("$/hr"),
    cell: ({ row }) =>
      formatCompensation(row.original.role.compensation_hourly_dollars),
  },
  {
    id: "distance",
    accessorFn: (row) => row.distance_miles ?? Number.POSITIVE_INFINITY,
    header: SORT_HEADER("Distance"),
    cell: ({ row }) => formatDistance(row.original.distance_miles),
  },
  {
    id: "next_interview",
    accessorFn: (row) =>
      row.next_interview?.scheduled_at
        ? new Date(row.next_interview.scheduled_at).getTime()
        : row.next_interview
          ? Number.POSITIVE_INFINITY - 1
          : Number.POSITIVE_INFINITY,
    header: SORT_HEADER("Next interview"),
    cell: ({ row }) => formatNextInterview(row.original.next_interview),
  },
  {
    id: "max_grad_year",
    accessorFn: (row) => row.role.max_grad_year ?? Number.POSITIVE_INFINITY,
    header: SORT_HEADER("Grad ≤"),
    cell: ({ row }) => formatMaxGradYear(row.original.role.max_grad_year),
  },
  {
    id: "relocation_assistance",
    accessorFn: (row) => row.role.relocation_assistance,
    header: SORT_HEADER("Relocation"),
    cell: ({ row }) => (
      <RelocationAssistanceCell value={row.original.role.relocation_assistance} />
    ),
  },
  {
    id: "resume",
    accessorFn: (row) => row.resume_version_id ?? "",
    header: "Resume",
    cell: ({ row }) =>
      row.original.resume_version_id ? (
        <span className="text-xs text-muted-foreground">attached</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  // Hidden by default
  {
    id: "posted",
    accessorFn: (row) =>
      row.role.posted_at ? new Date(row.role.posted_at).getTime() : 0,
    header: SORT_HEADER("Posted"),
    cell: ({ row }) => formatDate(row.original.role.posted_at),
  },
  {
    id: "created",
    accessorFn: (row) => new Date(row.created_at).getTime(),
    header: SORT_HEADER("Created"),
    cell: ({ row }) => formatDate(row.original.created_at),
  },
  {
    id: "source",
    accessorFn: (row) => row.role.source,
    header: SORT_HEADER("Source"),
    cell: ({ row }) => row.original.role.source.replace(/_/g, " "),
  },
];

/** Columns hidden by default (toggleable via Columns menu). */
export const DEFAULT_HIDDEN_COLUMNS = {
  posted: false,
  created: false,
  source: false,
};

/** Columns hidden on small screens. */
export const MOBILE_HIDDEN_COLUMNS = [
  "target",
  "deadline",
  "location",
  "work_model",
  "compensation",
  "distance",
  "next_interview",
  "class_year",
  "resume",
  "posted",
  "created",
  "source",
];
