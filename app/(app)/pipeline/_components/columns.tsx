"use client";

import type { ColumnDef, Row } from "@tanstack/react-table";
import type { ApplicationRow } from "@/lib/db/applications";
import type {
  ApplicationStatus,
  RelocationAssistance,
  TargetSeason,
  WorkModel,
} from "@/lib/db/types";
import { ArrowUpDown } from "@/components/icons";
import { updateRoleFieldAction } from "@/app/(app)/app/[id]/actions";
import { LocationsCell } from "./locations-cell";
import { RevertButton } from "./revert-button";
import { TableInlineCell } from "./table-inline-cell";
import {
  RelocationAssistanceCell,
  WorkModelCell,
  formatCompensation,
  formatDate,
  formatDistance,
} from "./cell-formatters";
import { InterviewsCell } from "./interviews-cell";
import { StatusCell } from "./status-cell";

export interface PipelineRow extends ApplicationRow {
  distance_miles: number | null;
}

const INPUT_CLS =
  "h-7 w-full min-w-20 rounded-sm border border-input bg-background px-1.5 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

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
    cell: ({ row }) => (
      <span className="font-medium">{row.original.role.company.name}</span>
    ),
    enableHiding: false,
  },
  {
    id: "role",
    accessorFn: (row) => row.role.title,
    header: SORT_HEADER("Role"),
    cell: ({ row }) => (
      <span className="inline-flex items-center">
        <TableInlineCell<string>
          value={row.original.role.title}
          display={(v) => <span>{v}</span>}
          renderInput={({ draft, setDraft, commit, inputRef }) => (
            <input
              ref={inputRef as React.MutableRefObject<HTMLInputElement>}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              className={INPUT_CLS}
            />
          )}
          onSave={(v) => updateRoleFieldAction(row.original.id, "title", v)}
        />
        {isDirty(row.original, "title", row.original.role.title) && (
          <RevertButton applicationId={row.original.id} field="title" />
        )}
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
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-1">
        <TableInlineCell<string>
          value={row.original.role.target_year ? String(row.original.role.target_year) : ""}
          display={(v) => (
            <span className={v ? "" : "text-muted-foreground"}>
              {v || "—"}
            </span>
          )}
          renderInput={({ draft, setDraft, commit, inputRef }) => (
            <input
              ref={inputRef as React.MutableRefObject<HTMLInputElement>}
              type="number"
              min={2024}
              max={2032}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              className={`${INPUT_CLS} w-20`}
            />
          )}
          onSave={(v) => updateRoleFieldAction(row.original.id, "target_year", v)}
        />
        {isDirty(row.original, "target_year", row.original.role.target_year) && (
          <RevertButton applicationId={row.original.id} field="target_year" />
        )}
        <TableInlineCell<TargetSeason>
          value={row.original.role.target_season}
          display={(v) => (
            <span className="capitalize text-muted-foreground">{v}</span>
          )}
          renderInput={({ draft, setDraft, commit, inputRef }) => (
            <select
              ref={inputRef as React.MutableRefObject<HTMLSelectElement>}
              value={draft}
              onChange={(e) => setDraft(e.target.value as TargetSeason)}
              onBlur={commit}
              className={INPUT_CLS}
            >
              <option value="summer">Summer</option>
              <option value="fall">Fall</option>
              <option value="winter">Winter</option>
              <option value="spring">Spring</option>
            </select>
          )}
          onSave={(v) => updateRoleFieldAction(row.original.id, "target_season", v)}
        />
        {isDirty(row.original, "target_season", row.original.role.target_season) && (
          <RevertButton applicationId={row.original.id} field="target_season" />
        )}
      </span>
    ),
  },
  {
    id: "deadline",
    accessorFn: (row) =>
      row.role.deadline_at ? new Date(row.role.deadline_at).getTime() : Number.POSITIVE_INFINITY,
    header: SORT_HEADER("Deadline"),
    cell: ({ row }) => (
      <span className="inline-flex items-center">
        <TableInlineCell<string>
          value={row.original.role.deadline_at ? row.original.role.deadline_at.slice(0, 10) : ""}
          display={(v) => <span>{formatDate(v ? v + "T00:00:00Z" : null)}</span>}
          renderInput={({ draft, setDraft, commit, inputRef }) => (
            <input
              ref={inputRef as React.MutableRefObject<HTMLInputElement>}
              type="date"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              className={INPUT_CLS}
            />
          )}
          onSave={(v) => updateRoleFieldAction(row.original.id, "deadline_at", v)}
        />
        {isDirty(row.original, "deadline_at", row.original.role.deadline_at) && (
          <RevertButton applicationId={row.original.id} field="deadline_at" />
        )}
      </span>
    ),
  },
  {
    id: "location",
    accessorFn: (row) => row.role.locations[0]?.text ?? "",
    header: SORT_HEADER("Location"),
    cell: ({ row }) => (
      <span className="inline-flex items-center">
        <LocationsCell
          applicationId={row.original.id}
          locations={row.original.role.locations}
        />
        {isDirty(row.original, "locations", row.original.role.locations) && (
          <RevertButton applicationId={row.original.id} field="locations" />
        )}
      </span>
    ),
  },
  {
    id: "work_model",
    accessorFn: (row) => row.role.work_model,
    header: SORT_HEADER("Mode"),
    cell: ({ row }) => (
      <span className="inline-flex items-center">
        <TableInlineCell<string>
          value={row.original.role.work_model ?? ""}
          display={() => <WorkModelCell model={row.original.role.work_model} />}
          renderInput={({ draft, setDraft, commit, inputRef }) => (
            <select
              ref={inputRef as React.MutableRefObject<HTMLSelectElement>}
              value={draft}
              onChange={(e) => setDraft(e.target.value as WorkModel | "")}
              onBlur={commit}
              className={INPUT_CLS}
            >
              <option value="">—</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">Onsite</option>
            </select>
          )}
          onSave={(v) => updateRoleFieldAction(row.original.id, "work_model", v)}
        />
        {isDirty(row.original, "work_model", row.original.role.work_model) && (
          <RevertButton applicationId={row.original.id} field="work_model" />
        )}
      </span>
    ),
  },
  {
    id: "compensation",
    accessorFn: (row) => row.role.compensation_hourly_dollars ?? 0,
    header: SORT_HEADER("$/hr"),
    cell: ({ row }) => (
      <span className="inline-flex items-center">
        <TableInlineCell<string>
          value={
            row.original.role.compensation_hourly_dollars !== null
              ? String(row.original.role.compensation_hourly_dollars)
              : ""
          }
          display={(v) => formatCompensation(v ? Number(v) : null)}
          renderInput={({ draft, setDraft, commit, inputRef }) => (
            <input
              ref={inputRef as React.MutableRefObject<HTMLInputElement>}
              type="number"
              min={0}
              max={9999}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              className={`${INPUT_CLS} w-20`}
            />
          )}
          onSave={(v) =>
            updateRoleFieldAction(row.original.id, "compensation_hourly_dollars", v)
          }
        />
        {isDirty(
          row.original,
          "compensation_hourly_dollars",
          row.original.role.compensation_hourly_dollars
        ) && (
          <RevertButton
            applicationId={row.original.id}
            field="compensation_hourly_dollars"
          />
        )}
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
      <span className="inline-flex items-center gap-1">
        <TableInlineCell<string>
          value={row.original.role.min_grad_year ? String(row.original.role.min_grad_year) : ""}
          display={(v) => (
            <span className={v ? "" : "text-muted-foreground"}>
              {v || "min"}
            </span>
          )}
          renderInput={({ draft, setDraft, commit, inputRef }) => (
            <input
              ref={inputRef as React.MutableRefObject<HTMLInputElement>}
              type="number"
              min={2024}
              max={2034}
              placeholder="min"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              className={`${INPUT_CLS} w-16`}
            />
          )}
          onSave={(v) => updateRoleFieldAction(row.original.id, "min_grad_year", v)}
        />
        {isDirty(row.original, "min_grad_year", row.original.role.min_grad_year) && (
          <RevertButton applicationId={row.original.id} field="min_grad_year" />
        )}
        <span className="text-muted-foreground">–</span>
        <TableInlineCell<string>
          value={row.original.role.max_grad_year ? String(row.original.role.max_grad_year) : ""}
          display={(v) => (
            <span className={v ? "" : "text-muted-foreground"}>
              {v || "max"}
            </span>
          )}
          renderInput={({ draft, setDraft, commit, inputRef }) => (
            <input
              ref={inputRef as React.MutableRefObject<HTMLInputElement>}
              type="number"
              min={2024}
              max={2034}
              placeholder="max"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              className={`${INPUT_CLS} w-16`}
            />
          )}
          onSave={(v) => updateRoleFieldAction(row.original.id, "max_grad_year", v)}
        />
        {isDirty(row.original, "max_grad_year", row.original.role.max_grad_year) && (
          <RevertButton applicationId={row.original.id} field="max_grad_year" />
        )}
      </span>
    ),
  },
  {
    id: "relocation_assistance",
    accessorFn: (row) => row.role.relocation_assistance,
    header: SORT_HEADER("Relocation"),
    cell: ({ row }) => (
      <span className="inline-flex items-center">
        <TableInlineCell<string>
          value={row.original.role.relocation_assistance ?? ""}
          display={() => (
            <RelocationAssistanceCell value={row.original.role.relocation_assistance} />
          )}
          renderInput={({ draft, setDraft, commit, inputRef }) => (
            <select
              ref={inputRef as React.MutableRefObject<HTMLSelectElement>}
              value={draft}
              onChange={(e) => setDraft(e.target.value as RelocationAssistance | "")}
              onBlur={commit}
              className={INPUT_CLS}
            >
              <option value="">—</option>
              <option value="provided">Provided</option>
              <option value="not_provided">Not provided</option>
            </select>
          )}
          onSave={(v) =>
            updateRoleFieldAction(row.original.id, "relocation_assistance", v)
          }
        />
        {isDirty(
          row.original,
          "relocation_assistance",
          row.original.role.relocation_assistance
        ) && (
          <RevertButton
            applicationId={row.original.id}
            field="relocation_assistance"
          />
        )}
      </span>
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
