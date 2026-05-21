"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { InterviewType } from "@/lib/db/types";

const SELECT_CLS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const TYPE_OPTIONS: { value: InterviewType; label: string }[] = [
  { value: "phone_screen", label: "Phone screen" },
  { value: "technical", label: "Technical" },
  { value: "behavioral", label: "Behavioral" },
  { value: "system_design", label: "System design" },
  { value: "onsite", label: "Onsite" },
  { value: "final", label: "Final" },
  { value: "other", label: "Other" },
];

export interface InterviewDraft {
  type: InterviewType;
  scheduled_at: string;
  duration_minutes: string;
  meeting_url: string;
  location: string;
  interviewer_names: string;
  notes: string;
  outcome: string;
}

export function emptyInterviewDraft(): InterviewDraft {
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

/**
 * Modal interview editor. The dialog's Save just calls `onSave` with the
 * current draft — it does NOT hit the DB. Persistence happens later via the
 * outer Save button on the detail page.
 */
export function StagedInterviewDialog({
  open,
  onOpenChange,
  initial,
  isEdit,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: InterviewDraft;
  isEdit: boolean;
  onSave: (draft: InterviewDraft) => void;
}) {
  const [draft, setDraft] = useState<InterviewDraft>(initial);

  // Reset local draft when dialog opens with a fresh initial
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setDraft(initial);
  }, [open, initial]);

  function update<K extends keyof InterviewDraft>(
    key: K,
    value: InterviewDraft[K]
  ) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function handleSave() {
    onSave(draft);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit interview" : "Add interview"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="type">Type</Label>
            <select
              id="type"
              value={draft.type}
              onChange={(e) => update("type", e.target.value as InterviewType)}
              className={SELECT_CLS}
            >
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="scheduled_at">Scheduled at</Label>
              <Input
                id="scheduled_at"
                type="datetime-local"
                value={draft.scheduled_at}
                onChange={(e) => update("scheduled_at", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="duration_minutes">Duration (min)</Label>
              <Input
                id="duration_minutes"
                type="number"
                min={5}
                step={5}
                value={draft.duration_minutes}
                onChange={(e) => update("duration_minutes", e.target.value)}
                placeholder="30"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="meeting_url">Meeting link</Label>
            <Input
              id="meeting_url"
              type="url"
              value={draft.meeting_url}
              onChange={(e) => update("meeting_url", e.target.value)}
              placeholder="https://meet.google.com/..."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="location">Location (in-person)</Label>
            <Input
              id="location"
              value={draft.location}
              onChange={(e) => update("location", e.target.value)}
              placeholder="Office address or city"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="interviewer_names">Interviewer(s)</Label>
            <Input
              id="interviewer_names"
              value={draft.interviewer_names}
              onChange={(e) => update("interviewer_names", e.target.value)}
              placeholder="Maria from recruiting, Alex (eng manager)"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              rows={3}
              value={draft.notes}
              onChange={(e) => update("notes", e.target.value)}
              placeholder="Prep notes before, recap after."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="outcome">Outcome (post-interview)</Label>
            <Input
              id="outcome"
              value={draft.outcome}
              onChange={(e) => update("outcome", e.target.value)}
              placeholder="Passed / Rejected / Awaiting"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSave}>
            {isEdit ? "Save changes" : "Add"}
          </Button>
        </DialogFooter>
        <p className="-mt-2 text-[10px] text-muted-foreground">
          Stages this interview locally. The outer Save button on the detail
          page commits it to your applications.
        </p>
      </DialogContent>
    </Dialog>
  );
}
