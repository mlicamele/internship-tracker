"use client";

import type { ColumnDef, Row } from "@tanstack/react-table";
import type { ApplicationRow } from "@/lib/db/applications";
import type {
  ApplicationStatus,
  RelocationAssistance,
  TargetSeason,
  WorkModel,
} from "@/lib/db/types";
import { ArrowUpDown, ExternalLink } from "@/components/icons";
import { updateRoleFieldAction } from "@/app/(app)/app/[id]/actions";
import { LocationsCell } from "./locations-cell";
import { RevertButton } from "./revert-button";
import { TableEnumField, TableTextField } from "./table-cells";
import {
  RelocationAssistanceCell,
  WorkModelCell,
  formatDate,
  formatDistance,
} from "./cell-formatters";
import { InterviewsCell } from "./interviews-cell";
import { StatusCell } from "./status-cell";

export interface PipelineRow extends ApplicationRow {
  distance_miles: number | null;
}

/** True iff current value differs from the snapshot's value for that field. */
function isDirty(row: PipelineRow, field: string, current: unknown): boolean {
  const snap = (row.role.extraction_snapshot?.values ?? {}) as Record<
    string,
    unknown
  >;
  if (!(field in snap)) return false;
  const snapVal = snap[field];
  // Locations: snapshot is string[] of texts, current is RoleLocation[]
  if (field === "locations") {
    const currentTexts = Array.isArray(current)
      ? (current as { text: string }[]).map((l) => l.text)
      : [];
    const snapTexts = Array.isArray(snapVal) ? (snapVal as string[]) : [];
    return JSON.stringify(currentTexts) !== JSON.stringify(snapTexts);
  }
  // Dates: compare just YYYY-MM-DD (Postgres timestamps may add seconds)
  if (field === "deadline_at" || field === "posted_at") {
    const a = typeof current === "string" ? current.slice(0, 10) : current;
    const b = typeof snapVal === "string" ? snapVal.slice(0, 10) : snapVal;
    return a !== b;
  }
  return snapVal !== current;
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
    cell: ({ row }) => {
      const jdUrl = row.original.role.jd_url;
      const name = row.original.role.company.name;
      return (
        <span className="block h-10 overflow-y-auto whitespace-normal break-words font-medium leading-tight">
          {jdUrl ? (
            <a
              href={jdUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-baseline gap-1 hover:underline"
              title={`Open posting: ${jdUrl}`}
            >
              {name}
              <ExternalLink className="size-3 shrink-0 translate-y-0.5 opacity-60 group-hover:opacity-100" />
            </a>
          ) : (
            name
          )}
        </span>
      );
    },
    enableHiding: false,
  },
  {
    id: "role",
    accessorFn: (row) => row.role.title,
    header: SORT_HEADER("Role"),
    cell: ({ row }) => (
      <span className="inline-flex w-full items-start">
        <TableTextField
          multiline
          value={row.original.role.title}
          onSave={(v) => updateRoleFieldAction(row.original.id, "title", v)}
          className="w-full"
        />
        <RevertButton
          applicationId={row.original.id}
          field="title"
          visible={isDirty(row.original, "title", row.original.role.title)}
        />
      </span>
    ),
    enableHiding: false,
  },
  {
    id: "status",
    accessorKey: "status",
    header: SORT_HEADER("Status"),
    cell: ({ row }) => (
      <StatusCell applicationId={row.original.id} status={row.original.status} />
    ),
    filterFn: (
      row: Row<PipelineRow>,
      columnId: string,
      filterValue: ApplicationStatus[] | undefined
    ) => {
      // undefined ⇒ "All" (show every row)
      if (filterValue === undefined) return true;
      // [] ⇒ "None" (show no rows)
      if (filterValue.length === 0) return false;
      return filterValue.includes(row.getValue(columnId) as ApplicationStatus);
    },
    enableHiding: false,
  },
  {
    id: "target",
    accessorFn: (row) => row.role.target_year ?? 0,
    header: SORT_HEADER("Target"),
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-0">
        <TableTextField
          type="number"
          min={2024}
          max={2032}
          value={row.original.role.target_year ? String(row.original.role.target_year) : ""}
          onSave={(v) => updateRoleFieldAction(row.original.id, "target_year", v)}
          inputClassName="w-10 text-right"
          placeholder="—"
        />
        <RevertButton
          applicationId={row.original.id}
          field="target_year"
          visible={isDirty(row.original, "target_year", row.original.role.target_year)}
        />
        <TableEnumField<TargetSeason>
          value={row.original.role.target_season}
          options={[
            { value: "summer", label: "Summer" },
            { value: "fall", label: "Fall" },
            { value: "winter", label: "Winter" },
            { value: "spring", label: "Spring" },
          ]}
          renderValue={(v) => (
            <span className="capitalize text-muted-foreground">{v}</span>
          )}
          onSave={(v) =>
            updateRoleFieldAction(row.original.id, "target_season", v ?? "summer")
          }
        />
        <RevertButton
          applicationId={row.original.id}
          field="target_season"
          visible={isDirty(row.original, "target_season", row.original.role.target_season)}
        />
      </span>
    ),
  },
  {
    id: "deadline",
    accessorFn: (row) =>
      row.role.deadline_at ? new Date(row.role.deadline_at).getTime() : Number.POSITIVE_INFINITY,
    header: SORT_HEADER("Deadline"),
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-0">
        <TableTextField
          type="date"
          value={row.original.role.deadline_at ? row.original.role.deadline_at.slice(0, 10) : ""}
          onSave={(v) => updateRoleFieldAction(row.original.id, "deadline_at", v)}
          inputClassName="w-32"
        />
        <RevertButton
          applicationId={row.original.id}
          field="deadline_at"
          visible={isDirty(row.original, "deadline_at", row.original.role.deadline_at)}
        />
      </span>
    ),
  },
  {
    id: "location",
    accessorFn: (row) => row.role.locations[0]?.text ?? "",
    header: SORT_HEADER("Location"),
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-0">
        <LocationsCell
          applicationId={row.original.id}
          locations={row.original.role.locations}
        />
        <RevertButton
          applicationId={row.original.id}
          field="locations"
          visible={isDirty(row.original, "locations", row.original.role.locations)}
        />
      </span>
    ),
  },
  {
    id: "work_model",
    accessorFn: (row) => row.role.work_model,
    header: SORT_HEADER("Mode"),
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-0">
        <TableEnumField<WorkModel>
          value={row.original.role.work_model}
          options={[
            { value: "remote", label: "Remote" },
            { value: "hybrid", label: "Hybrid" },
            { value: "onsite", label: "Onsite" },
          ]}
          placeholder="—"
          renderValue={(v) => <WorkModelCell model={v} />}
          onSave={(v) =>
            updateRoleFieldAction(row.original.id, "work_model", v ?? "")
          }
        />
        <RevertButton
          applicationId={row.original.id}
          field="work_model"
          visible={isDirty(row.original, "work_model", row.original.role.work_model)}
        />
      </span>
    ),
  },
  {
    id: "compensation",
    accessorFn: (row) => row.role.compensation_hourly_dollars ?? 0,
    header: SORT_HEADER("$/hr"),
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-0">
        <TableTextField
          type="number"
          min={0}
          max={9999}
          prefix="$"
          suffix="/hr"
          inputClassName="w-10 text-right"
          value={
            row.original.role.compensation_hourly_dollars !== null
              ? String(row.original.role.compensation_hourly_dollars)
              : ""
          }
          onSave={(v) =>
            updateRoleFieldAction(row.original.id, "compensation_hourly_dollars", v)
          }
        />
        <RevertButton
          applicationId={row.original.id}
          field="compensation_hourly_dollars"
          visible={isDirty(
            row.original,
            "compensation_hourly_dollars",
            row.original.role.compensation_hourly_dollars
          )}
        />
      </span>
    ),
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
    cell: ({ row }) => (
      <InterviewsCell
        applicationId={row.original.id}
        interviews={row.original.interviews}
        nextInterview={row.original.next_interview}
      />
    ),
  },
  {
    id: "grad_year_window",
    accessorFn: (row) => row.role.max_grad_year ?? Number.POSITIVE_INFINITY,
    header: SORT_HEADER("Grad year"),
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-0">
        <TableTextField
          type="number"
          min={2024}
          max={2034}
          placeholder="min"
          inputClassName="w-10 text-center"
          value={row.original.role.min_grad_year ? String(row.original.role.min_grad_year) : ""}
          onSave={(v) => updateRoleFieldAction(row.original.id, "min_grad_year", v)}
        />
        <RevertButton
          applicationId={row.original.id}
          field="min_grad_year"
          visible={isDirty(row.original, "min_grad_year", row.original.role.min_grad_year)}
        />
        <span className="text-muted-foreground">–</span>
        <TableTextField
          type="number"
          min={2024}
          max={2034}
          placeholder="max"
          inputClassName="w-10 text-center"
          value={row.original.role.max_grad_year ? String(row.original.role.max_grad_year) : ""}
          onSave={(v) => updateRoleFieldAction(row.original.id, "max_grad_year", v)}
        />
        <RevertButton
          applicationId={row.original.id}
          field="max_grad_year"
          visible={isDirty(row.original, "max_grad_year", row.original.role.max_grad_year)}
        />
      </span>
    ),
  },
  {
    id: "relocation_assistance",
    accessorFn: (row) => row.role.relocation_assistance,
    header: SORT_HEADER("Relocation"),
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-0">
        <TableEnumField<RelocationAssistance>
          value={row.original.role.relocation_assistance}
          options={[
            { value: "provided", label: "Provided" },
            { value: "not_provided", label: "Not provided" },
          ]}
          placeholder="—"
          renderValue={(v) => <RelocationAssistanceCell value={v} />}
          onSave={(v) =>
            updateRoleFieldAction(row.original.id, "relocation_assistance", v ?? "")
          }
        />
        <RevertButton
          applicationId={row.original.id}
          field="relocation_assistance"
          visible={isDirty(
            row.original,
            "relocation_assistance",
            row.original.role.relocation_assistance
          )}
        />
      </span>
    ),
  },
  {
    id: "resume",
    accessorFn: (row) => row.resume_version_id ?? "",
    header: SORT_HEADER("Resume"),
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

/** Columns hidden on small screens. Mobile is mostly for adding apps;
 *  the rest of the columns become visible by scrolling. */
export const MOBILE_HIDDEN_COLUMNS = [
  "posted",
  "created",
  "source",
];
