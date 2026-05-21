"use client";

import type { ApplicationRow } from "@/lib/db/applications";
import {
  ClassYearCell,
  WorkModelCell,
  formatCompensation,
  formatDate,
} from "@/app/(app)/pipeline/_components/cell-formatters";
import { ExternalLink } from "@/components/icons";
import { parseCompensation } from "@/lib/comp/parse";
import {
  updateRoleFieldAction,
  type RoleEditableField,
} from "../actions";
import { InlineEdit } from "./inline-edit";
import type {
  ClassYearTag,
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

  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-4 rounded-md border border-border bg-card/40 p-4 sm:grid-cols-2 lg:grid-cols-3">
      {/* Target year + season — two adjacent inline edits */}
      <div className="space-y-0.5">
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Target
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

      <ItemWithLabel label="Eligibility">
        <InlineEdit<ClassYearTag>
          value={r.class_year_tag}
          display={(v) => <ClassYearCell tag={v} />}
          edit={({ draft, setDraft, inputRef }) => (
            <select
              ref={inputRef as React.MutableRefObject<HTMLSelectElement>}
              value={draft}
              onChange={(e) => setDraft(e.target.value as ClassYearTag)}
              className={SELECT_CLS}
            >
              <option value="unspecified">Any</option>
              <option value="freshman_ok">Freshman+</option>
              <option value="sophomore_ok">Sophomore+</option>
              <option value="junior_plus">Junior+</option>
            </select>
          )}
          onSave={makeSaver(appId, "class_year_tag")}
        />
      </ItemWithLabel>

      <ItemWithLabel label="Deadline">
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

      <ItemWithLabel label="Posted">
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

      <ItemWithLabel label="Location">
        <InlineEdit<string>
          value={r.location_text ?? ""}
          display={(v) => (
            <span className="text-sm">
              {v || <span className="text-muted-foreground">—</span>}
            </span>
          )}
          edit={({ draft, setDraft, inputRef }) => (
            <input
              ref={inputRef as React.MutableRefObject<HTMLInputElement>}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className={INPUT_CLS}
              placeholder="Remote · San Francisco"
            />
          )}
          onSave={makeSaver(appId, "location_text")}
        />
      </ItemWithLabel>

      <ItemWithLabel label="Mode">
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

      <ItemWithLabel label="Compensation">
        <InlineEdit<string>
          value={r.compensation_text ?? ""}
          display={(v) =>
            formatCompensation(
              v || null,
              r.compensation_hourly_cents
            )
          }
          edit={({ draft, setDraft, inputRef }) => {
            const parsed = draft ? parseCompensation(draft) : null;
            return (
              <div className="space-y-1">
                <input
                  ref={inputRef as React.MutableRefObject<HTMLInputElement>}
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className={INPUT_CLS}
                  placeholder="$50/hr + housing"
                />
                {parsed?.matched && parsed.hourlyCents !== null && (
                  <p className="text-[11px] text-muted-foreground">
                    ≈ ${(parsed.hourlyCents / 100).toFixed(2)}/hr (sortable)
                  </p>
                )}
                {parsed && !parsed.matched && draft.length > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Saved as text only (no hourly equivalent)
                  </p>
                )}
              </div>
            );
          }}
          onSave={makeSaver(appId, "compensation_text")}
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
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}
