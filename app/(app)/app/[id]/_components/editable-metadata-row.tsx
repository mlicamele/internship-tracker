"use client";

import type { ApplicationRow } from "@/lib/db/applications";
import {
  RelocationAssistanceCell,
  WorkModelCell,
  formatCompensation,
  formatDate,
  formatMaxGradYear,
} from "@/app/(app)/pipeline/_components/cell-formatters";
import { ExternalLink } from "@/components/icons";
import {
  updateRoleFieldAction,
  type RoleEditableField,
} from "../actions";
import { ConfidenceBadge } from "./confidence-badge";
import { InlineEdit } from "./inline-edit";
import type {
  RelocationAssistance,
  TargetSeason,
  WorkModel,
} from "@/lib/db/types";

const SELECT_CLS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const INPUT_CLS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** Convert ISO timestamp to YYYY-MM-DD for date input */
function isoToDateInput(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function makeSaver(applicationId: string, field: RoleEditableField) {
  return async (value: string | null) =>
    updateRoleFieldAction(applicationId, field, value);
}

export function EditableMetadataRow({
  application,
}: {
  application: ApplicationRow;
}) {
  const r = application.role;
  const appId = application.id;
  const conf = r.extraction_confidences ?? {};

  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-4 rounded-md border border-border bg-card/40 p-4 sm:grid-cols-2 lg:grid-cols-3">
      {/* Target year + season — two adjacent inline edits */}
      <div className="space-y-0.5">
        <div className="flex items-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          <span>Target</span>
          <ConfidenceBadge confidence={conf.target_year ?? conf.target_season} />
        </div>
        <div className="flex items-center gap-1">
          <InlineEdit<string>
            value={r.target_year ? String(r.target_year) : ""}
            display={(v) => (
              <span className="text-sm">
                {v || <span className="text-muted-foreground">—</span>}
              </span>
            )}
            edit={({ draft, setDraft, inputRef }) => (
              <input
                ref={inputRef as React.MutableRefObject<HTMLInputElement>}
                type="number"
                min={2024}
                max={2032}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className={INPUT_CLS}
                style={{ width: "5rem" }}
              />
            )}
            onSave={makeSaver(appId, "target_year")}
          />
          <InlineEdit<TargetSeason>
            value={r.target_season}
            display={(v) => (
              <span className="text-sm capitalize text-muted-foreground">
                {v}
              </span>
            )}
            edit={({ draft, setDraft, inputRef }) => (
              <select
                ref={inputRef as React.MutableRefObject<HTMLSelectElement>}
                value={draft}
                onChange={(e) => setDraft(e.target.value as TargetSeason)}
                className={SELECT_CLS}
              >
                <option value="summer">Summer</option>
                <option value="fall">Fall</option>
                <option value="winter">Winter</option>
                <option value="spring">Spring</option>
              </select>
            )}
            onSave={makeSaver(appId, "target_season")}
          />
        </div>
      </div>

      <ItemWithLabel
        label="Grad year ≤"
        confidence={conf.max_grad_year}
      >
        <InlineEdit<string>
          value={r.max_grad_year ? String(r.max_grad_year) : ""}
          display={(v) => formatMaxGradYear(v ? Number(v) : null)}
          edit={({ draft, setDraft, inputRef }) => (
            <input
              ref={inputRef as React.MutableRefObject<HTMLInputElement>}
              type="number"
              min={2024}
              max={2034}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className={INPUT_CLS}
              style={{ width: "6rem" }}
              placeholder="2029"
            />
          )}
          onSave={makeSaver(appId, "max_grad_year")}
        />
      </ItemWithLabel>

      <ItemWithLabel
        label="Relocation"
        confidence={conf.relocation_assistance}
      >
        <InlineEdit<RelocationAssistance>
          value={r.relocation_assistance}
          display={(v) => <RelocationAssistanceCell value={v} />}
          edit={({ draft, setDraft, inputRef }) => (
            <select
              ref={inputRef as React.MutableRefObject<HTMLSelectElement>}
              value={draft}
              onChange={(e) => setDraft(e.target.value as RelocationAssistance)}
              className={SELECT_CLS}
            >
              <option value="unspecified">Unspecified</option>
              <option value="provided">Provided</option>
              <option value="not_provided">Not provided</option>
            </select>
          )}
          onSave={makeSaver(appId, "relocation_assistance")}
        />
      </ItemWithLabel>

      <ItemWithLabel label="Deadline" confidence={conf.deadline_at}>
        <InlineEdit<string>
          value={isoToDateInput(r.deadline_at)}
          display={(v) => <span className="text-sm">{formatDate(v ? v + "T00:00:00Z" : null)}</span>}
          edit={({ draft, setDraft, inputRef }) => (
            <input
              ref={inputRef as React.MutableRefObject<HTMLInputElement>}
              type="date"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className={INPUT_CLS}
            />
          )}
          onSave={makeSaver(appId, "deadline_at")}
        />
      </ItemWithLabel>

      <ItemWithLabel label="Posted" confidence={conf.posted_at}>
        <InlineEdit<string>
          value={isoToDateInput(r.posted_at)}
          display={(v) => <span className="text-sm">{formatDate(v ? v + "T00:00:00Z" : null)}</span>}
          edit={({ draft, setDraft, inputRef }) => (
            <input
              ref={inputRef as React.MutableRefObject<HTMLInputElement>}
              type="date"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className={INPUT_CLS}
            />
          )}
          onSave={makeSaver(appId, "posted_at")}
        />
      </ItemWithLabel>

      <ItemWithLabel label="Locations" confidence={conf.locations}>
        <InlineEdit<string>
          value={r.locations.map((l) => l.text).join("\n")}
          display={(v) =>
            v ? (
              <ul className="space-y-0.5 text-sm">
                {v.split("\n").filter(Boolean).map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )
          }
          edit={({ draft, setDraft, inputRef }) => (
            <textarea
              ref={inputRef as React.MutableRefObject<HTMLTextAreaElement>}
              rows={Math.max(2, draft.split("\n").length)}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="San Francisco, CA&#10;New York, NY&#10;Remote"
            />
          )}
          onSave={makeSaver(appId, "locations")}
        />
      </ItemWithLabel>

      <ItemWithLabel label="Mode" confidence={conf.work_model}>
        <InlineEdit<WorkModel>
          value={r.work_model}
          display={(v) => <WorkModelCell model={v} />}
          edit={({ draft, setDraft, inputRef }) => (
            <select
              ref={inputRef as React.MutableRefObject<HTMLSelectElement>}
              value={draft}
              onChange={(e) => setDraft(e.target.value as WorkModel)}
              className={SELECT_CLS}
            >
              <option value="unspecified">Unspecified</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">Onsite</option>
            </select>
          )}
          onSave={makeSaver(appId, "work_model")}
        />
      </ItemWithLabel>

      <ItemWithLabel label="$/hr" confidence={conf.compensation_hourly_dollars}>
        <InlineEdit<string>
          value={
            r.compensation_hourly_dollars !== null
              ? String(r.compensation_hourly_dollars)
              : ""
          }
          display={(v) => formatCompensation(v ? Number(v) : null)}
          edit={({ draft, setDraft, inputRef }) => (
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                $
              </span>
              <input
                ref={inputRef as React.MutableRefObject<HTMLInputElement>}
                type="number"
                min={0}
                max={9999}
                step={1}
                inputMode="numeric"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className={`${INPUT_CLS} pl-6 pr-12`}
                placeholder="50"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                /hr
              </span>
            </div>
          )}
          onSave={makeSaver(appId, "compensation_hourly_dollars")}
        />
      </ItemWithLabel>

      <ItemWithLabel label="Source">
        <span className="text-sm capitalize">
          {r.source.replace(/_/g, " ")}
        </span>
      </ItemWithLabel>

      {r.jd_url && (
        <ItemWithLabel label="JD URL">
          <a
            href={r.jd_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-foreground underline-offset-4 hover:underline"
          >
            View
            <ExternalLink className="size-3" />
          </a>
        </ItemWithLabel>
      )}
    </div>
  );
}

function ItemWithLabel({
  label,
  children,
  confidence,
}: {
  label: string;
  children: React.ReactNode;
  confidence?: number;
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        <ConfidenceBadge confidence={confidence} />
      </div>
      {children}
    </div>
  );
}
