"use client";

import { useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Interview, InterviewType } from "@/lib/db/types";
import { createInterviewAction, updateInterviewAction } from "../actions";

const SELECT_CLS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const TYPE_OPTIONS: { value: InterviewType; label: string }[] = [
  { value: "phone_screen", label: "Phone screen" },
  { value: "technical", label: "Technical" },
  { value: "behavioral", label: "Behavioral" },
  { value: "system_design", label: "System design" },
  { value: "onsite", label: "Onsite" },
  { value: "final", label: "Final" },
  { value: "other", label: "Other" },
];

/** Convert ISO timestamp → "YYYY-MM-DDTHH:mm" local-time string for datetime-local input. */
function isoToDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function InterviewFormDialog({
  open,
  onOpenChange,
  applicationId,
  interview,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  applicationId: string;
  interview?: Interview;
}) {
  const [pending, startTransition] = useTransition();
  const isEdit = !!interview;

  async function handleSubmit(formData: FormData) {
    startTransition(async () => {
      if (interview) {
        await updateInterviewAction(applicationId, interview.id, formData);
      } else {
        await createInterviewAction(applicationId, formData);
      }
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit interview" : "Add interview"}</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="type">Type</Label>
            <select
              id="type"
              name="type"
              defaultValue={interview?.type ?? "phone_screen"}
              required
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
                name="scheduled_at"
                type="datetime-local"
                defaultValue={isoToDatetimeLocal(interview?.scheduled_at ?? null)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="duration_minutes">Duration (min)</Label>
              <Input
                id="duration_minutes"
                name="duration_minutes"
                type="number"
                min={5}
                step={5}
                defaultValue={interview?.duration_minutes ?? ""}
                placeholder="30"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="meeting_url">Meeting link</Label>
            <Input
              id="meeting_url"
              name="meeting_url"
              type="url"
              defaultValue={interview?.meeting_url ?? ""}
              placeholder="https://meet.google.com/..."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="location">Location (in-person)</Label>
            <Input
              id="location"
              name="location"
              defaultValue={interview?.location ?? ""}
              placeholder="Office address or city"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="interviewer_names">Interviewer(s)</Label>
            <Input
              id="interviewer_names"
              name="interviewer_names"
              defaultValue={interview?.interviewer_names ?? ""}
              placeholder="Maria from recruiting, Alex (eng manager)"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              rows={3}
              defaultValue={interview?.notes ?? ""}
              placeholder="Prep notes before, recap after."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="outcome">Outcome (post-interview)</Label>
            <Input
              id="outcome"
              name="outcome"
              defaultValue={interview?.outcome ?? ""}
              placeholder="Passed / Rejected / Awaiting"
            />
          </div>

          <DialogFooter>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              Cancel
            </button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : isEdit ? "Save changes" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
