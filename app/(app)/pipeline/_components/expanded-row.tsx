"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { ApplicationRow } from "@/lib/db/applications";
import { Button } from "@/components/ui/button";
import type {
  RelocationAssistance,
  TargetSeason,
  WorkModel,
} from "@/lib/db/types";
import {
  getCompanyNotesAction,
  saveCompanyNotesAction,
  updateCompanyFieldAction,
  updateCompanyNameAction,
  updateNotesAction,
  updateRoleFieldAction,
} from "@/app/(app)/app/[id]/actions";

const INPUT_CLS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const SELECT_CLS = INPUT_CLS;
const TEXTAREA_CLS =
  "flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/**
 * Staged-edit panel — all inputs are local until Save commits them. Discard
 * reverts the draft and closes the expansion. Each Save commits dirty fields
 * in parallel via the existing per-field server actions.
 */
interface Draft {
  // Role
  title: string;
  locations: string; // newline- or comma-separated text editor
  deadline_at: string; // YYYY-MM-DD
  posted_at: string;
  min_grad_year: string;
  max_grad_year: string;
  target_year: string;
  target_season: TargetSeason;
  work_model: WorkModel | "";
  relocation_assistance: RelocationAssistance | "";
  compensation_hourly_dollars: string;
  // Company
  company_name: string;
  company_industry_tags: string; // comma-separated
  company_hq_city: string;
  // Notes
  app_notes: string;
  company_notes: string;
}

function draftFromApplication(application: ApplicationRow): Draft {
  const r = application.role;
  const c = r.company;
  return {
    title: r.title,
    locations: r.locations.map((l) => l.text).join("\n"),
    deadline_at: r.deadline_at ? r.deadline_at.slice(0, 10) : "",
    posted_at: r.posted_at ? r.posted_at.slice(0, 10) : "",
    min_grad_year: r.min_grad_year ? String(r.min_grad_year) : "",
    max_grad_year: r.max_grad_year ? String(r.max_grad_year) : "",
    target_year: r.target_year ? String(r.target_year) : "",
    target_season: r.target_season,
    work_model: r.work_model ?? "",
    relocation_assistance: r.relocation_assistance ?? "",
    compensation_hourly_dollars:
      r.compensation_hourly_dollars !== null
        ? String(r.compensation_hourly_dollars)
        : "",
    company_name: c.name,
    company_industry_tags: c.industry_tags.join(", "),
    company_hq_city: c.hq_city ?? "",
    app_notes: application.notes,
    company_notes: "", // populated by lazy fetch
  };
}

const ROLE_FIELDS = [
  "title",
  "locations",
  "deadline_at",
  "posted_at",
  "min_grad_year",
  "max_grad_year",
  "target_year",
  "target_season",
  "work_model",
  "relocation_assistance",
  "compensation_hourly_dollars",
] as const;

export function ExpandedRow({
  application,
  onClose,
}: {
  application: ApplicationRow;
  onClose: () => void;
}) {
  const initial = useMemo(
    () => draftFromApplication(application),
    [application]
  );
  const [draft, setDraft] = useState<Draft>(initial);
  const [companyNotesLoaded, setCompanyNotesLoaded] = useState(false);
  const [companyNotesInitial, setCompanyNotesInitial] = useState("");
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<string[]>([]);

  // Lazy-load company notes once when the row opens
  useEffect(() => {
    let cancelled = false;
    getCompanyNotesAction(application.role.company.id).then((notes) => {
      if (cancelled) return;
      setCompanyNotesLoaded(true);
      setCompanyNotesInitial(notes);
      setDraft((d) => ({ ...d, company_notes: notes }));
    });
    return () => {
      cancelled = true;
    };
  }, [application.role.company.id]);

  const fullInitial: Draft = useMemo(
    () => ({ ...initial, company_notes: companyNotesInitial }),
    [initial, companyNotesInitial]
  );

  const dirty = useMemo(() => {
    const keys = Object.keys(draft) as (keyof Draft)[];
    return keys.filter((k) => draft[k] !== fullInitial[k]);
  }, [draft, fullInitial]);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function handleSave() {
    if (dirty.length === 0) {
      onClose();
      return;
    }
    setErrors([]);
    startTransition(async () => {
      const errs: string[] = [];
      const tasks: Promise<unknown>[] = [];
      const appId = application.id;
      const companyId = application.role.company.id;

      for (const field of dirty) {
        if ((ROLE_FIELDS as readonly string[]).includes(field)) {
          tasks.push(
            updateRoleFieldAction(
              appId,
              field as (typeof ROLE_FIELDS)[number],
              draft[field] as string
            ).then((r) => {
              if (!r.ok) errs.push(`${field}: ${r.error}`);
            })
          );
        } else if (field === "company_name") {
          tasks.push(
            updateCompanyNameAction(appId, draft.company_name).then((r) => {
              if (!r.ok) errs.push(`company name: ${r.error}`);
            })
          );
        } else if (field === "company_industry_tags") {
          tasks.push(
            updateCompanyFieldAction(
              appId,
              "industry_tags",
              draft.company_industry_tags
            ).then((r) => {
              if (!r.ok) errs.push(`industry tags: ${r.error}`);
            })
          );
        } else if (field === "company_hq_city") {
          tasks.push(
            updateCompanyFieldAction(appId, "hq_city", draft.company_hq_city).then(
              (r) => {
                if (!r.ok) errs.push(`hq city: ${r.error}`);
              }
            )
          );
        } else if (field === "app_notes") {
          tasks.push(updateNotesAction(appId, draft.app_notes));
        } else if (field === "company_notes") {
          tasks.push(saveCompanyNotesAction(companyId, draft.company_notes));
        }
      }

      await Promise.all(tasks);
      if (errs.length > 0) {
        setErrors(errs);
      } else {
        onClose();
      }
    });
  }

  function handleDiscard() {
    setDraft(fullInitial);
    setErrors([]);
    onClose();
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="space-y-5 bg-muted/20 px-4 py-5"
    >
      <Section title="Role">
        <Grid>
          <Field label="Title" wide>
            <input
              type="text"
              value={draft.title}
              onChange={(e) => update("title", e.target.value)}
              className={INPUT_CLS}
            />
          </Field>
          <Field label="Locations (one per line)" wide>
            <textarea
              rows={Math.max(2, draft.locations.split("\n").length)}
              value={draft.locations}
              onChange={(e) => update("locations", e.target.value)}
              className={TEXTAREA_CLS}
              placeholder="San Francisco, CA&#10;New York, NY&#10;Remote"
            />
          </Field>
          <Field label="Target year">
            <input
              type="number"
              min={2024}
              max={2032}
              value={draft.target_year}
              onChange={(e) => update("target_year", e.target.value)}
              className={INPUT_CLS}
              placeholder="2027"
            />
          </Field>
          <Field label="Target season">
            <select
              value={draft.target_season}
              onChange={(e) =>
                update("target_season", e.target.value as TargetSeason)
              }
              className={SELECT_CLS}
            >
              <option value="summer">Summer</option>
              <option value="fall">Fall</option>
              <option value="winter">Winter</option>
              <option value="spring">Spring</option>
            </select>
          </Field>
          <Field label="Deadline">
            <input
              type="date"
              value={draft.deadline_at}
              onChange={(e) => update("deadline_at", e.target.value)}
              className={INPUT_CLS}
            />
          </Field>
          <Field label="Posted">
            <input
              type="date"
              value={draft.posted_at}
              onChange={(e) => update("posted_at", e.target.value)}
              className={INPUT_CLS}
            />
          </Field>
          <Field label="Min grad year">
            <input
              type="number"
              min={2024}
              max={2034}
              value={draft.min_grad_year}
              onChange={(e) => update("min_grad_year", e.target.value)}
              className={INPUT_CLS}
              placeholder="2027"
            />
          </Field>
          <Field label="Max grad year">
            <input
              type="number"
              min={2024}
              max={2034}
              value={draft.max_grad_year}
              onChange={(e) => update("max_grad_year", e.target.value)}
              className={INPUT_CLS}
              placeholder="2029"
            />
          </Field>
          <Field label="Work model">
            <select
              value={draft.work_model}
              onChange={(e) =>
                update("work_model", e.target.value as WorkModel | "")
              }
              className={SELECT_CLS}
            >
              <option value="">—</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">Onsite</option>
            </select>
          </Field>
          <Field label="Relocation">
            <select
              value={draft.relocation_assistance}
              onChange={(e) =>
                update(
                  "relocation_assistance",
                  e.target.value as RelocationAssistance | ""
                )
              }
              className={SELECT_CLS}
            >
              <option value="">—</option>
              <option value="provided">Provided</option>
              <option value="not_provided">Not provided</option>
            </select>
          </Field>
          <Field label="$/hr">
            <input
              type="number"
              min={0}
              max={9999}
              value={draft.compensation_hourly_dollars}
              onChange={(e) =>
                update("compensation_hourly_dollars", e.target.value)
              }
              className={INPUT_CLS}
              placeholder="50"
            />
          </Field>
        </Grid>
      </Section>

      <Section title="Company">
        <Grid>
          <Field label="Name">
            <input
              type="text"
              value={draft.company_name}
              onChange={(e) => update("company_name", e.target.value)}
              className={INPUT_CLS}
            />
          </Field>
          <Field label="Industry tags (comma-separated)">
            <input
              type="text"
              value={draft.company_industry_tags}
              onChange={(e) => update("company_industry_tags", e.target.value)}
              className={INPUT_CLS}
              placeholder="SWE, Quant, ML/AI"
            />
          </Field>
          <Field label="HQ city">
            <input
              type="text"
              value={draft.company_hq_city}
              onChange={(e) => update("company_hq_city", e.target.value)}
              className={INPUT_CLS}
              placeholder="San Francisco, CA"
            />
          </Field>
        </Grid>
        <Field label="Company notes (apply to every role here)" wide>
          {companyNotesLoaded ? (
            <textarea
              rows={3}
              value={draft.company_notes}
              onChange={(e) => update("company_notes", e.target.value)}
              className={TEXTAREA_CLS}
            />
          ) : (
            <p className="text-xs text-muted-foreground">Loading…</p>
          )}
        </Field>
      </Section>

      <Section title="This application">
        <Field label="Notes" wide>
          <textarea
            rows={4}
            value={draft.app_notes}
            onChange={(e) => update("app_notes", e.target.value)}
            className={TEXTAREA_CLS}
            placeholder="Status notes, contacts, follow-ups…"
          />
        </Field>
      </Section>

      {errors.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {errors.map((e, i) => (
            <div key={i}>• {e}</div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
        <span className="mr-auto text-xs text-muted-foreground">
          {dirty.length === 0
            ? "No changes"
            : `${dirty.length} change${dirty.length === 1 ? "" : "s"} pending`}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleDiscard}
          disabled={pending}
        >
          Discard
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={pending}
        >
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-3 rounded-md border border-border bg-card/40 p-4">
        {children}
      </div>
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
      {children}
    </div>
  );
}

function Field({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "space-y-1 sm:col-span-2 lg:col-span-3" : "space-y-1"}>
      <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
