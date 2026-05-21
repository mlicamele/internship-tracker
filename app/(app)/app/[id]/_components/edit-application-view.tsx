"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ApplicationRow } from "@/lib/db/applications";
import { Button } from "@/components/ui/button";
import type {
  ApplicationStatus,
  ConfidenceTier,
  ExtractionSnapshot,
  Interview,
  InterviewType,
  RelocationAssistance,
  StatusEvent,
  TargetSeason,
  WorkModel,
} from "@/lib/db/types";
import { ExternalLink, Plus } from "@/components/icons";
import {
  STATUS_OPTIONS,
  StatusPill,
  formatDate,
} from "@/app/(app)/pipeline/_components/cell-formatters";
import { transitionStatusAction } from "@/app/(app)/pipeline/actions";
import { ConfidenceBadge } from "./confidence-badge";
import { JdViewer } from "./jd-viewer";
import { StatusTimeline } from "./status-timeline";
import {
  commitDraftAction,
  createInterviewAction,
  deleteApplicationAction,
  deleteInterviewAction,
  revertRoleFieldAction,
  saveCompanyNotesAction,
  updateCompanyFieldAction,
  updateCompanyNameAction,
  updateInterviewAction,
  updateNotesAction,
  updateRoleFieldAction,
} from "../actions";

const INPUT_CLS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const SELECT_CLS = INPUT_CLS;
const TEXTAREA_CLS =
  "flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

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

const TYPE_LABEL: Record<InterviewType, string> = {
  phone_screen: "Phone screen",
  technical: "Technical",
  behavioral: "Behavioral",
  system_design: "System design",
  onsite: "Onsite",
  final: "Final",
  other: "Other",
};
const TYPE_OPTIONS = Object.entries(TYPE_LABEL).map(([value, label]) => ({
  value: value as InterviewType,
  label,
}));

interface InterviewDraft {
  type: InterviewType;
  scheduled_at: string; // datetime-local
  duration_minutes: string;
  meeting_url: string;
  location: string;
  interviewer_names: string;
  notes: string;
  outcome: string;
}

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
  // Application
  status: ApplicationStatus;
}

function isoToDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function interviewToDraft(i: Interview): InterviewDraft {
  return {
    type: i.type,
    scheduled_at: isoToDatetimeLocal(i.scheduled_at),
    duration_minutes:
      i.duration_minutes !== null ? String(i.duration_minutes) : "",
    meeting_url: i.meeting_url ?? "",
    location: i.location ?? "",
    interviewer_names: i.interviewer_names ?? "",
    notes: i.notes ?? "",
    outcome: i.outcome ?? "",
  };
}

function emptyInterviewDraft(): InterviewDraft {
  return {
    type: "phone_screen",
    scheduled_at: "",
    duration_minutes: "",
    meeting_url: "",
    location: "",
    interviewer_names: "",
    notes: "",
    outcome: "",
  };
}

function interviewDraftToFormData(d: InterviewDraft): FormData {
  const fd = new FormData();
  fd.set("type", d.type);
  fd.set("scheduled_at", d.scheduled_at);
  fd.set("duration_minutes", d.duration_minutes);
  fd.set("meeting_url", d.meeting_url);
  fd.set("location", d.location);
  fd.set("interviewer_names", d.interviewer_names);
  fd.set("notes", d.notes);
  fd.set("outcome", d.outcome);
  return fd;
}

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
    status: application.status,
  };
}

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

export function EditApplicationView({
  application,
  interviews,
  statusEvents,
  initialCompanyNotes,
}: {
  application: ApplicationRow;
  interviews: Interview[];
  statusEvents: StatusEvent[];
  initialCompanyNotes: string;
}) {
  const router = useRouter();
  const isDraft = application.triage_state === "draft";

  const initial = useMemo(
    () => draftFromApplication(application, initialCompanyNotes),
    [application, initialCompanyNotes]
  );
  const [draft, setDraft] = useState<Draft>(initial);

  // Per-field "user clicked Revert"; on Save we call revertRoleFieldAction
  // (which restores both value + confidence) instead of updateRoleFieldAction.
  const [revertedFields, setRevertedFields] = useState<Set<RoleFieldKey>>(
    () => new Set()
  );

  // Interview drafts
  const [interviewEdits, setInterviewEdits] = useState<
    Record<string, InterviewDraft>
  >({});
  const [interviewDeletes, setInterviewDeletes] = useState<Set<string>>(
    () => new Set()
  );
  const [pendingNewInterviews, setPendingNewInterviews] = useState<
    InterviewDraft[]
  >([]);

  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  // Resync local draft + interview pending state when server data refreshes.
  // This is a legitimate external-sync effect (server data → local form
  // state); the lint rule's "synchronous setState in effect" warning fires
  // on the first call and we accept it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(initial);
    setRevertedFields(new Set());
    setInterviewEdits({});
    setInterviewDeletes(new Set());
    setPendingNewInterviews([]);
  }, [initial]);

  const dirty = useMemo(() => {
    return (Object.keys(draft) as (keyof Draft)[]).filter(
      (k) => draft[k] !== initial[k]
    );
  }, [draft, initial]);

  const hasInterviewChanges =
    Object.keys(interviewEdits).length > 0 ||
    interviewDeletes.size > 0 ||
    pendingNewInterviews.length > 0;
  const dirtyCount = dirty.length + (hasInterviewChanges ? 1 : 0);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    if (ROLE_FIELDS.includes(key as RoleFieldKey)) {
      // A normal edit cancels any pending revert for this field
      setRevertedFields((s) => {
        if (!s.has(key as RoleFieldKey)) return s;
        const next = new Set(s);
        next.delete(key as RoleFieldKey);
        return next;
      });
    }
  }

  function revertField(field: RoleFieldKey) {
    const snap = snapForDraft(field);
    if (snap === null) return;
    setDraft((d) => ({ ...d, [field]: snap as Draft[typeof field] }));
    setRevertedFields((s) => new Set(s).add(field));
  }

  function snapForDraft(field: RoleFieldKey): string | null {
    return snapshotAsDraftValue(snapshot, field);
  }

  async function handleSave() {
    setErrors([]);
    startTransition(async () => {
      const errs: string[] = [];
      const tasks: Promise<unknown>[] = [];
      const appId = application.id;
      const companyId = application.role.company.id;

      // Role / company / notes / status changes
      for (const field of dirty) {
        if ((ROLE_FIELDS as readonly string[]).includes(field)) {
          const k = field as RoleFieldKey;
          if (revertedFields.has(k)) {
            tasks.push(
              revertRoleFieldAction(appId, k).then((r) => {
                if (!r.ok) errs.push(`revert ${k}: ${r.error}`);
              })
            );
          } else {
            tasks.push(
              updateRoleFieldAction(appId, k, draft[k] as string).then((r) => {
                if (!r.ok) errs.push(`${k}: ${r.error}`);
              })
            );
          }
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
        } else if (field === "status") {
          tasks.push(transitionStatusAction(appId, draft.status));
        }
      }

      // Interview operations
      for (const id of interviewDeletes) {
        tasks.push(
          deleteInterviewAction(appId, id).catch((e) =>
            errs.push(`delete interview: ${e?.message ?? e}`)
          )
        );
      }
      for (const [id, d] of Object.entries(interviewEdits)) {
        tasks.push(
          updateInterviewAction(appId, id, interviewDraftToFormData(d)).catch(
            (e) => errs.push(`edit interview: ${e?.message ?? e}`)
          )
        );
      }
      for (const d of pendingNewInterviews) {
        tasks.push(
          createInterviewAction(appId, interviewDraftToFormData(d)).catch((e) =>
            errs.push(`add interview: ${e?.message ?? e}`)
          )
        );
      }

      await Promise.all(tasks);

      if (errs.length > 0) {
        setErrors(errs);
        return;
      }

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
      setDraft(initial);
      setRevertedFields(new Set());
      setInterviewEdits({});
      setInterviewDeletes(new Set());
      setPendingNewInterviews([]);
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

  // Interview render helpers
  function effectiveInterviewDraft(i: Interview): InterviewDraft {
    return interviewEdits[i.id] ?? interviewToDraft(i);
  }
  function updateInterviewDraft(
    id: string,
    initial: InterviewDraft,
    patch: Partial<InterviewDraft>
  ) {
    setInterviewEdits((m) => ({
      ...m,
      [id]: { ...initial, ...patch },
    }));
  }

  return (
    <div className="space-y-6">
      <Section title="Role">
        <Grid>
          <Field
            label="Title"
            wide
            confidence={conf.title}
            canRevert={
              snapForDraft("title") !== null &&
              draft.title !== snapForDraft("title")
            }
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
        {!isDraft && (
          <Field label="Status">
            <select
              value={draft.status}
              onChange={(e) =>
                update("status", e.target.value as ApplicationStatus)
              }
              className={SELECT_CLS}
            >
              {STATUS_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <span className="ml-2 inline-block align-middle">
              <StatusPill status={draft.status} />
            </span>
          </Field>
        )}
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

      {!isDraft && (
        <Section title="Interviews">
          <div className="space-y-3">
            {interviews
              .filter((i) => !interviewDeletes.has(i.id))
              .map((i) => {
                const d = effectiveInterviewDraft(i);
                return (
                  <InterviewEditCard
                    key={i.id}
                    draft={d}
                    onChange={(patch) =>
                      updateInterviewDraft(i.id, d, patch)
                    }
                    onDelete={() =>
                      setInterviewDeletes((s) => new Set(s).add(i.id))
                    }
                  />
                );
              })}
            {pendingNewInterviews.map((d, idx) => (
              <InterviewEditCard
                key={`new-${idx}`}
                draft={d}
                isNew
                onChange={(patch) =>
                  setPendingNewInterviews((arr) =>
                    arr.map((x, i) => (i === idx ? { ...x, ...patch } : x))
                  )
                }
                onDelete={() =>
                  setPendingNewInterviews((arr) =>
                    arr.filter((_, i) => i !== idx)
                  )
                }
              />
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setPendingNewInterviews((arr) => [
                  ...arr,
                  emptyInterviewDraft(),
                ])
              }
            >
              <Plus className="size-3" />
              Add interview
            </Button>
          </div>
        </Section>
      )}

      {!isDraft && <StatusTimeline events={statusEvents} />}

      <JdViewer body={application.role.jd_body_text} />

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
          ) : dirtyCount === 0 ? (
            "All saved"
          ) : (
            `${dirtyCount} change${dirtyCount === 1 ? "" : "s"} pending`
          )}
        </span>
        {!isDraft &&
          (confirmDelete ? (
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
          ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleDiscard}
          disabled={pending || (!isDraft && dirtyCount === 0)}
        >
          Discard
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={pending || (!isDraft && dirtyCount === 0)}
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
            title="Revert to auto-extracted value (will be saved when you click Save)"
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

function InterviewEditCard({
  draft,
  isNew,
  onChange,
  onDelete,
}: {
  draft: InterviewDraft;
  isNew?: boolean;
  onChange: (patch: Partial<InterviewDraft>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-md border border-border bg-card/30 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-xs">
          <select
            value={draft.type}
            onChange={(e) => onChange({ type: e.target.value as InterviewType })}
            className="h-7 rounded-sm border border-input bg-transparent px-1.5 text-xs"
          >
            {TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {isNew && (
            <span className="text-[10px] font-medium uppercase tracking-wider text-emerald-500">
              New
            </span>
          )}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="text-destructive hover:text-destructive"
        >
          {isNew ? "Remove" : "Delete"}
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          When
          <input
            type="datetime-local"
            value={draft.scheduled_at}
            onChange={(e) => onChange({ scheduled_at: e.target.value })}
            className="block h-8 w-full rounded-sm border border-input bg-transparent px-2 text-sm normal-case tracking-normal"
          />
        </label>
        <label className="space-y-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Duration (min)
          <input
            type="number"
            min={5}
            step={5}
            value={draft.duration_minutes}
            onChange={(e) => onChange({ duration_minutes: e.target.value })}
            className="block h-8 w-full rounded-sm border border-input bg-transparent px-2 text-sm normal-case tracking-normal"
          />
        </label>
        <label className="space-y-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground sm:col-span-2">
          Meeting link
          <input
            type="url"
            value={draft.meeting_url}
            onChange={(e) => onChange({ meeting_url: e.target.value })}
            className="block h-8 w-full rounded-sm border border-input bg-transparent px-2 text-sm normal-case tracking-normal"
            placeholder="https://meet.google.com/…"
          />
        </label>
        <label className="space-y-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Location
          <input
            type="text"
            value={draft.location}
            onChange={(e) => onChange({ location: e.target.value })}
            className="block h-8 w-full rounded-sm border border-input bg-transparent px-2 text-sm normal-case tracking-normal"
            placeholder="Office or city"
          />
        </label>
        <label className="space-y-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Interviewer(s)
          <input
            type="text"
            value={draft.interviewer_names}
            onChange={(e) => onChange({ interviewer_names: e.target.value })}
            className="block h-8 w-full rounded-sm border border-input bg-transparent px-2 text-sm normal-case tracking-normal"
          />
        </label>
        <label className="space-y-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground sm:col-span-2">
          Notes
          <textarea
            rows={2}
            value={draft.notes}
            onChange={(e) => onChange({ notes: e.target.value })}
            className="block w-full rounded-sm border border-input bg-transparent px-2 py-1 text-sm normal-case tracking-normal"
          />
        </label>
        <label className="space-y-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground sm:col-span-2">
          Outcome
          <input
            type="text"
            value={draft.outcome}
            onChange={(e) => onChange({ outcome: e.target.value })}
            className="block h-8 w-full rounded-sm border border-input bg-transparent px-2 text-sm normal-case tracking-normal"
            placeholder="Passed / Rejected / Awaiting"
          />
        </label>
      </div>
      {draft.meeting_url && !isNew && (
        <a
          href={draft.meeting_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          Open meeting <ExternalLink className="size-3" />
        </a>
      )}
      <p className="text-[10px] text-muted-foreground">
        Saved time: {draft.scheduled_at ? formatDate(draft.scheduled_at) : "TBD"}
      </p>
    </div>
  );
}
