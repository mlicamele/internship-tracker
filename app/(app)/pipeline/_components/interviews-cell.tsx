"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { InterviewType } from "@/lib/db/types";
import type { InterviewSummary } from "@/lib/db/applications";
import {
  createInterviewAction,
  deleteInterviewAction,
  updateInterviewAction,
} from "@/app/(app)/app/[id]/actions";
import {
  StagedInterviewDialog,
  emptyInterviewDraft,
  type InterviewDraft,
} from "@/app/(app)/app/[id]/_components/staged-interview-dialog";
import { formatDate, formatNextInterview } from "./cell-formatters";

const TYPE_LABEL: Record<InterviewType, string> = {
  phone_screen: "Phone screen",
  technical: "Technical",
  behavioral: "Behavioral",
  system_design: "System design",
  onsite: "Onsite",
  final: "Final",
  other: "Other",
};

function isoToDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function interviewToDraft(i: InterviewSummary): InterviewDraft {
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

function draftToFormData(d: InterviewDraft): FormData {
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

function formatScheduledAt(iso: string | null): string {
  if (!iso) return "TBD";
  const d = new Date(iso);
  return `${formatDate(iso)} · ${d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

/**
 * Pipeline interview cell.
 *  - Hover: read-only preview popover (the next_interview details).
 *  - Click: editable popover listing all interviews with add/edit/delete +
 *    Save (commits everything in parallel via the existing per-interview
 *    server actions). Same pattern as LocationsCell.
 */
export function InterviewsCell({
  applicationId,
  interviews,
  nextInterview,
}: {
  applicationId: string;
  interviews: InterviewSummary[];
  nextInterview: InterviewSummary | null;
}) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement | null>(null);

  // Local staged interview changes (only meaningful while open)
  const [edits, setEdits] = useState<Record<string, InterviewDraft>>({});
  const [deletes, setDeletes] = useState<Set<string>>(() => new Set());
  const [newOnes, setNewOnes] = useState<InterviewDraft[]>([]);

  // Dialog state (for adding or editing a single interview)
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogInitial, setDialogInitial] = useState<InterviewDraft>(
    emptyInterviewDraft()
  );
  const [dialogTarget, setDialogTarget] = useState<
    { kind: "new" } | { kind: "edit-existing"; id: string } | { kind: "edit-new"; index: number } | null
  >(null);

  // Reset local state whenever popover closes or interviews change underneath
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEdits({});
      setDeletes(new Set());
      setNewOnes([]);
    }
  }, [open, interviews]);

  // Close popover on outside click / Escape
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node) && !dialogOpen) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !dialogOpen) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, dialogOpen]);

  function effectiveDraft(i: InterviewSummary): InterviewDraft {
    return edits[i.id] ?? interviewToDraft(i);
  }

  function openAddDialog() {
    setDialogInitial(emptyInterviewDraft());
    setDialogTarget({ kind: "new" });
    setDialogOpen(true);
  }
  function openEditExistingDialog(id: string, current: InterviewDraft) {
    setDialogInitial(current);
    setDialogTarget({ kind: "edit-existing", id });
    setDialogOpen(true);
  }
  function openEditNewDialog(index: number, current: InterviewDraft) {
    setDialogInitial(current);
    setDialogTarget({ kind: "edit-new", index });
    setDialogOpen(true);
  }
  function handleDialogSave(d: InterviewDraft) {
    if (!dialogTarget) return;
    if (dialogTarget.kind === "new") {
      setNewOnes((arr) => [...arr, d]);
    } else if (dialogTarget.kind === "edit-existing") {
      setEdits((m) => ({ ...m, [dialogTarget.id]: d }));
    } else {
      const i = dialogTarget.index;
      setNewOnes((arr) => arr.map((x, idx) => (idx === i ? d : x)));
    }
    setDialogTarget(null);
  }

  function cancel() {
    setEdits({});
    setDeletes(new Set());
    setNewOnes([]);
    setOpen(false);
  }

  function save() {
    startTransition(async () => {
      const tasks: Promise<unknown>[] = [];
      for (const id of deletes) {
        tasks.push(deleteInterviewAction(applicationId, id));
      }
      for (const [id, d] of Object.entries(edits)) {
        tasks.push(updateInterviewAction(applicationId, id, draftToFormData(d)));
      }
      for (const d of newOnes) {
        tasks.push(createInterviewAction(applicationId, draftToFormData(d)));
      }
      await Promise.all(tasks);
      setOpen(false);
    });
  }

  const hasChanges =
    Object.keys(edits).length > 0 || deletes.size > 0 || newOnes.length > 0;
  const showHoverPreview = hover && !open && !!nextInterview;

  return (
    <div
      ref={ref}
      className="relative inline-flex"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="-mx-1 cursor-text rounded-sm px-1 py-0.5 text-left underline decoration-dotted decoration-muted-foreground/40 underline-offset-4 hover:bg-muted/40 hover:decoration-muted-foreground"
      >
        {formatNextInterview(nextInterview)}
      </button>

      {showHoverPreview && nextInterview && (
        <div
          role="tooltip"
          className="pointer-events-none absolute left-0 top-full z-40 mt-1 w-72 rounded-md border border-border bg-popover p-3 text-xs text-popover-foreground shadow-md"
        >
          <p className="mb-1 text-sm font-semibold">
            {TYPE_LABEL[nextInterview.type]}
          </p>
          <p className="text-muted-foreground">
            {formatScheduledAt(nextInterview.scheduled_at)}
          </p>
          {nextInterview.location && (
            <p className="mt-1">
              <span className="text-muted-foreground">Location:</span>{" "}
              {nextInterview.location}
            </p>
          )}
          {nextInterview.interviewer_names && (
            <p>
              <span className="text-muted-foreground">With:</span>{" "}
              {nextInterview.interviewer_names}
            </p>
          )}
          {nextInterview.notes && (
            <p className="mt-1 whitespace-pre-wrap">{nextInterview.notes}</p>
          )}
        </div>
      )}

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 top-full z-50 mt-1 w-80 space-y-2 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md"
        >
          {interviews.length === 0 && newOnes.length === 0 && (
            <p className="text-xs italic text-muted-foreground">
              No interviews yet.
            </p>
          )}
          <ul className="space-y-1">
            {interviews
              .filter((i) => !deletes.has(i.id))
              .map((i) => {
                const d = effectiveDraft(i);
                const dirtyMark = i.id in edits ? " *" : "";
                return (
                  <li
                    key={i.id}
                    className="flex items-center justify-between gap-2 rounded-sm px-1 py-1 hover:bg-muted/40"
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="truncate text-xs font-medium">
                        {TYPE_LABEL[d.type]}
                        {dirtyMark}
                      </p>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {d.scheduled_at
                          ? formatScheduledAt(d.scheduled_at)
                          : "TBD"}
                      </p>
                    </div>
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => openEditExistingDialog(i.id, d)}
                        className="rounded-sm px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDeletes((s) => new Set(s).add(i.id))
                        }
                        className="rounded-sm px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-destructive"
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                );
              })}
            {newOnes.map((d, idx) => (
              <li
                key={`new-${idx}`}
                className="flex items-center justify-between gap-2 rounded-sm px-1 py-1 hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="truncate text-xs font-medium">
                    {TYPE_LABEL[d.type]}{" "}
                    <span className="text-[10px] text-emerald-500">new</span>
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {d.scheduled_at ? formatScheduledAt(d.scheduled_at) : "TBD"}
                  </p>
                </div>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => openEditNewDialog(idx, d)}
                    className="rounded-sm px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setNewOnes((arr) => arr.filter((_, i) => i !== idx))
                    }
                    className="rounded-sm px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-destructive"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={openAddDialog}
            className="w-full rounded-sm border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            + Add interview
          </button>
          <div className="flex justify-end gap-2 border-t border-border/60 pt-2">
            <button
              type="button"
              onClick={cancel}
              disabled={pending}
              className="rounded-sm px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={pending || !hasChanges}
              className="rounded-sm bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      <StagedInterviewDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={dialogInitial}
        isEdit={dialogTarget?.kind !== "new"}
        onSave={handleDialogSave}
      />
    </div>
  );
}
