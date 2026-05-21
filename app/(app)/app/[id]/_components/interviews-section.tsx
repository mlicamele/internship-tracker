"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { Interview, InterviewType } from "@/lib/db/types";
import { ExternalLink, Plus } from "@/components/icons";
import { formatDate } from "@/app/(app)/pipeline/_components/cell-formatters";
import { deleteInterviewAction } from "../actions";
import { InterviewFormDialog } from "./interview-form-dialog";

const TYPE_LABEL: Record<InterviewType, string> = {
  phone_screen: "Phone screen",
  technical: "Technical",
  behavioral: "Behavioral",
  system_design: "System design",
  onsite: "Onsite",
  final: "Final",
  other: "Other",
};

function formatScheduledAt(iso: string | null): string {
  if (!iso) return "TBD";
  const d = new Date(iso);
  const dateStr = formatDate(iso);
  const timeStr = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${dateStr} · ${timeStr}`;
}

function InterviewCard({
  interview,
  applicationId,
  onEdit,
}: {
  interview: Interview;
  applicationId: string;
  onEdit: () => void;
}) {
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    if (!confirm("Delete this interview? This can't be undone.")) return;
    startTransition(async () => {
      await deleteInterviewAction(applicationId, interview.id);
    });
  }

  return (
    <div className="rounded-md border border-border bg-card/40 p-4 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">{TYPE_LABEL[interview.type]}</p>
          <p className="text-xs text-muted-foreground">
            {formatScheduledAt(interview.scheduled_at)}
            {interview.duration_minutes && ` · ${interview.duration_minutes} min`}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onEdit} disabled={pending}>
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={pending}
            className="text-destructive hover:text-destructive"
          >
            Delete
          </Button>
        </div>
      </div>

      {interview.meeting_url && (
        <a
          href={interview.meeting_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-foreground underline-offset-4 hover:underline break-all"
        >
          {interview.meeting_url}
          <ExternalLink className="size-3 flex-shrink-0" />
        </a>
      )}

      {interview.location && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">Location:</span> {interview.location}
        </p>
      )}

      {interview.interviewer_names && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">With:</span>{" "}
          {interview.interviewer_names}
        </p>
      )}

      {interview.notes && (
        <p className="text-xs text-muted-foreground whitespace-pre-wrap pt-1 border-t border-border/50">
          {interview.notes}
        </p>
      )}

      {interview.outcome && (
        <p className="text-xs">
          <span className="font-medium text-muted-foreground">Outcome:</span>{" "}
          {interview.outcome}
        </p>
      )}
    </div>
  );
}

export function InterviewsSection({
  applicationId,
  interviews,
}: {
  applicationId: string;
  interviews: Interview[];
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingInterview, setEditingInterview] = useState<Interview | undefined>(
    undefined
  );

  function openAdd() {
    setEditingInterview(undefined);
    setDialogOpen(true);
  }

  function openEdit(interview: Interview) {
    setEditingInterview(interview);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Interviews
        </h2>
        <Button variant="outline" size="sm" onClick={openAdd}>
          <Plus className="size-3" />
          Add interview
        </Button>
      </div>

      {interviews.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          No interviews logged yet.
        </p>
      ) : (
        <div className="space-y-2">
          {interviews.map((interview) => (
            <InterviewCard
              key={interview.id}
              interview={interview}
              applicationId={applicationId}
              onEdit={() => openEdit(interview)}
            />
          ))}
        </div>
      )}

      <InterviewFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        applicationId={applicationId}
        interview={editingInterview}
      />
    </div>
  );
}
