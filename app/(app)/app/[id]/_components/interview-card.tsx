"use client";

import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/icons";
import { formatDate } from "@/app/(app)/pipeline/_components/cell-formatters";
import type { InterviewType } from "@/lib/db/types";
import type { InterviewDraft } from "./staged-interview-dialog";

const TYPE_LABEL: Record<InterviewType, string> = {
  phone_screen: "Phone screen",
  technical: "Technical",
  behavioral: "Behavioral",
  system_design: "System design",
  onsite: "Onsite",
  final: "Final",
  other: "Other",
};

function formatScheduledAt(iso: string): string {
  if (!iso) return "TBD";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${formatDate(iso)} · ${d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

/**
 * Read-only summary card for an interview. Edit/Delete buttons live here;
 * Edit opens a dialog, Delete stages a removal on the parent.
 */
export function InterviewCard({
  draft,
  isNew,
  onEdit,
  onDelete,
}: {
  draft: InterviewDraft;
  isNew?: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-md border border-border bg-card/40 p-4 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">
            {TYPE_LABEL[draft.type]}
            {isNew && (
              <span className="ml-2 text-[10px] font-medium uppercase tracking-wider text-emerald-500">
                New (unsaved)
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatScheduledAt(draft.scheduled_at)}
            {draft.duration_minutes && ` · ${draft.duration_minutes} min`}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="text-destructive hover:text-destructive"
          >
            {isNew ? "Remove" : "Delete"}
          </Button>
        </div>
      </div>

      {draft.meeting_url && (
        <a
          href={draft.meeting_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-foreground underline-offset-4 hover:underline break-all"
        >
          {draft.meeting_url}
          <ExternalLink className="size-3 flex-shrink-0" />
        </a>
      )}

      {draft.location && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">Location:</span> {draft.location}
        </p>
      )}

      {draft.interviewer_names && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">With:</span> {draft.interviewer_names}
        </p>
      )}

      {draft.notes && (
        <p className="text-xs text-muted-foreground whitespace-pre-wrap pt-1 border-t border-border/50">
          {draft.notes}
        </p>
      )}

      {draft.outcome && (
        <p className="text-xs">
          <span className="font-medium text-muted-foreground">Outcome:</span>{" "}
          {draft.outcome}
        </p>
      )}
    </div>
  );
}
