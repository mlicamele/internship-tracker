"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ApplicationRow } from "@/lib/db/applications";
import { Button } from "@/components/ui/button";
import type {
  ConfidenceTier,
  ExtractionSnapshot,
  RelocationAssistance,
  TargetSeason,
  WorkModel,
} from "@/lib/db/types";
import { ConfidenceBadge } from "./confidence-badge";
import {
  commitDraftAction,
  deleteApplicationAction,
  revertRoleFieldAction,
  saveCompanyNotesAction,
  updateCompanyFieldAction,
  updateCompanyNameAction,
  updateNotesAction,
  updateRoleFieldAction,
} from "../actions";

const INPUT_CLS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const SELECT_CLS = INPUT_CLS;
const TEXTAREA_CLS =
  "flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

interface Draft {
  // Role
  title: string;
  locations: string;
  deadline_at: string;
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
  company_industry_tags: string;
  company_hq_city: string;
  // Notes
  app_notes: string;
  company_notes: string;
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

type RoleFieldKey = (typeof ROLE_FIELDS)[number];

function draftFromApplication(
  application: ApplicationRow,
  companyNotes: string
): Draft {
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
    company_notes: companyNotes,
  };
}

/**
 * Build the snapshot-equivalent string for a given role field so we can
 * compare against the user's current draft and surface the revert ↺ button.
 */
function snapshotAsDraftValue(
  snapshot: ExtractionSnapshot,
  field: RoleFieldKey
): string | null {
  const values = (snapshot.values ?? {}) as Record<string, unknown>;
  if (!(field in values)) return null;
  const v = values[field];
  if (v === null || v === undefined) return "";
  if (field === "locations" && Array.isArray(v)) {
    return (v as unknown[])
      .filter((x): x is string => typeof x === "string")
      .join("\n");
  }
  if (field === "deadline_at" || field === "posted_at") {
    return typeof v === "string" ? v.slice(0, 10) : "";
  }
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return null;
}

export function RoleEditForm({
  application,
  initialCompanyNotes,
}: {
  application: ApplicationRow;
  initialCompanyNotes: string;
}) {
  const router = useRouter();
  const isDraft = application.triage_state === "draft";

  const initial = useMemo(
    () => draftFromApplication(application, initialCompanyNotes),
    [application, initialCompanyNotes]
  );
  const [draft, setDraft] = useState<Draft>(initial);
  const [pending, startTransition] = useTransition();
  const [reverting, startRevert] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  // Resync local draft when the server data refreshes after an action. This
  // is a legitimate external-sync effect — the source of truth (server data
  // memoized into `initial`) changed, so the local draft has to catch up.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(initial);
  }, [initial]);

  const dirty = useMemo(() => {
    return (Object.keys(draft) as (keyof Draft)[]).filter(
      (k) => draft[k] !== initial[k]
    );
  }, [draft, initial]);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function revertField(field: RoleFieldKey) {
    startRevert(async () => {
      await revertRoleFieldAction(application.id, field);
      router.refresh();
    });
  }

  async function handleSave() {
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
              field as RoleFieldKey,
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
        return;
      }

      // If this was a draft, promote it to active so it shows up in pipeline
      if (isDraft) {
        const r = await commitDraftAction(appId);
        if (!r.ok) {
          setErrors([`commit draft: ${r.error}`]);
          return;
        }
      }

      router.refresh();
    });
  }

  function handleDiscard() {
    if (isDraft) {
      // Discarding a draft = delete the orphan entirely
      if (
        !confirm(
          "Discard this draft? The role and its extraction will be deleted."
        )
      )
        return;
      startTransition(async () => {
        await deleteApplicationAction(application.id);
      });
    } else {
      // Saved app: just reset local draft state
      setDraft(initial);
      setErrors([]);
    }
  }

  function handleDelete() {
    startTransition(async () => {
      await deleteApplicationAction(application.id);
    });
  }

  const snapshot: ExtractionSnapshot =
    (application.role.extraction_snapshot as ExtractionSnapshot) ?? {
      values: {},
      confidences: {},
    };
  const conf = (application.role.extraction_confidences ?? {}) as Record<
    string,
    ConfidenceTier
  >;

  function snapForDraft(field: RoleFieldKey): string | null {
    return snapshotAsDraftValue(snapshot, field);
  }

  return (
    <div className="space-y-6">
      <Section title="Role">
        <Grid>
          <Field
            label="Title"
            wide
            confidence={conf.title}
            canRevert={snapForDraft("title") !== null && draft.title !== snapForDraft("title")}
            onRevert={() => revertField("title")}
          >
            <input
              type="text"
              value={draft.title}
              onChange={(e) => update("title", e.target.value)}
              className={INPUT_CLS}
            />
          </Field>
          <Field
            label="Locations (one per line)"
            wide
            confidence={conf.locations}
            canRevert={
              snapForDraft("locations") !== null &&
              draft.locations !== snapForDraft("locations")
            }
            onRevert={() => revertField("locations")}
          >
            <textarea
              rows={Math.max(2, draft.locations.split("\n").length)}
              value={draft.locations}
              onChange={(e) => update("locations", e.target.value)}
              className={TEXTAREA_CLS}
              placeholder="San Francisco, CA&#10;New York, NY"
            />
          </Field>
          <Field
            label="Target year"
            confidence={conf.target_year}
            canRevert={
              snapForDraft("target_year") !== null &&
              draft.target_year !== snapForDraft("target_year")
            }
            onRevert={() => revertField("target_year")}
          >
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
          <Field
            label="Target season"
            confidence={conf.target_season}
            canRevert={
              snapForDraft("target_season") !== null &&
              draft.target_season !== snapForDraft("target_season")
            }
            onRevert={() => revertField("target_season")}
          >
            <select
              value={draft.target_season}
              onChange={(e) => update("target_season", e.target.value as TargetSeason)}
              className={SELECT_CLS}
            >
              <option value="summer">Summer</option>
              <option value="fall">Fall</option>
              <option value="winter">Winter</option>
              <option value="spring">Spring</option>
            </select>
          </Field>
          <Field
            label="Deadline"
            confidence={conf.deadline_at}
            canRevert={
              snapForDraft("deadline_at") !== null &&
              draft.deadline_at !== snapForDraft("deadline_at")
            }
            onRevert={() => revertField("deadline_at")}
          >
            <input
              type="date"
              value={draft.deadline_at}
              onChange={(e) => update("deadline_at", e.target.value)}
              className={INPUT_CLS}
            />
          </Field>
          <Field
            label="Posted"
            confidence={conf.posted_at}
            canRevert={
              snapForDraft("posted_at") !== null &&
              draft.posted_at !== snapForDraft("posted_at")
            }
            onRevert={() => revertField("posted_at")}
          >
            <input
              type="date"
              value={draft.posted_at}
              onChange={(e) => update("posted_at", e.target.value)}
              className={INPUT_CLS}
            />
          </Field>
          <Field
            label="Min grad year"
            confidence={conf.min_grad_year}
            canRevert={
              snapForDraft("min_grad_year") !== null &&
              draft.min_grad_year !== snapForDraft("min_grad_year")
            }
            onRevert={() => revertField("min_grad_year")}
          >
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
          <Field
            label="Max grad year"
            confidence={conf.max_grad_year}
            canRevert={
              snapForDraft("max_grad_year") !== null &&
              draft.max_grad_year !== snapForDraft("max_grad_year")
            }
            onRevert={() => revertField("max_grad_year")}
          >
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
          <Field
            label="Work model"
            confidence={conf.work_model}
            canRevert={
              snapForDraft("work_model") !== null &&
              (draft.work_model || "") !== snapForDraft("work_model")
            }
            onRevert={() => revertField("work_model")}
          >
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
          <Field
            label="Relocation"
            confidence={conf.relocation_assistance}
            canRevert={
              snapForDraft("relocation_assistance") !== null &&
              (draft.relocation_assistance || "") !==
                snapForDraft("relocation_assistance")
            }
            onRevert={() => revertField("relocation_assistance")}
          >
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
          <Field
            label="$/hr"
            confidence={conf.compensation_hourly_dollars}
            canRevert={
              snapForDraft("compensation_hourly_dollars") !== null &&
              draft.compensation_hourly_dollars !==
                snapForDraft("compensation_hourly_dollars")
            }
            onRevert={() => revertField("compensation_hourly_dollars")}
          >
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
        <Field label="Company notes (apply to every role at this company)" wide>
          <textarea
            rows={3}
            value={draft.company_notes}
            onChange={(e) => update("company_notes", e.target.value)}
            className={TEXTAREA_CLS}
          />
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

      <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur md:relative md:mx-0 md:bg-transparent md:pt-6 md:backdrop-blur-none">
        <span className="mr-auto text-xs text-muted-foreground">
          {isDraft ? (
            <span className="font-medium text-amber-500">Draft</span>
          ) : dirty.length === 0 ? (
            reverting ? (
              "Reverting…"
            ) : (
              "All saved"
            )
          ) : (
            `${dirty.length} change${dirty.length === 1 ? "" : "s"} pending`
          )}
        </span>
        {!isDraft && (
          confirmDelete ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDelete(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={pending}
              >
                Confirm delete
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              disabled={pending}
              className="text-destructive hover:text-destructive"
            >
              Delete
            </Button>
          )
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleDiscard}
          disabled={pending || (!isDraft && dirty.length === 0)}
        >
          Discard
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={pending || (!isDraft && dirty.length === 0)}
        >
          {pending ? "Saving…" : isDraft ? "Save draft" : "Save changes"}
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
  confidence,
  canRevert,
  onRevert,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
  confidence?: ConfidenceTier;
  canRevert?: boolean;
  onRevert?: () => void;
}) {
  return (
    <div className={wide ? "space-y-1 sm:col-span-2 lg:col-span-3" : "space-y-1"}>
      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        <ConfidenceBadge confidence={confidence} />
        {canRevert && onRevert && (
          <button
            type="button"
            onClick={onRevert}
            className="ml-auto text-muted-foreground hover:text-foreground"
            title="Revert to auto-extracted value"
            aria-label="Revert to auto-extracted value"
          >
            ↺
          </button>
        )}
      </div>
      {children}
    </div>
  );
}
