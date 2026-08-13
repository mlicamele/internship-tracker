"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { uploadResumeAction, type UploadResumeResult } from "../resume-actions";

const INITIAL: UploadResumeResult = { ok: true, label: "" };

/**
 * Resume upload form with the same state-machine UX pattern as SettingsForm:
 * "Upload" (idle, disabled until file picked) → 3-dot spinner "Extracting…"
 * (pending) → "✓ Uploaded" emerald (1.5s success) → back to idle.
 *
 * Errors surface inline instead of via URL param + full-page reload — matches
 * the settings-save UX rework from commit 5c2bcda.
 */
export function ResumeUploadForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(uploadResumeAction, INITIAL);
  const [hasFile, setHasFile] = useState(false);

  // Post-success affordance: brief emerald ✓ for 1.5s, then reset. Matches
  // SettingsForm's justSaved pattern. Also clears the form so a second
  // upload starts fresh instead of re-submitting the same file.
  const [justUploaded, setJustUploaded] = useState<string | null>(null);
  useEffect(() => {
    if (state.ok && "label" in state && state.label && !pending) {
      setJustUploaded(state.label);
      setHasFile(false);
      formRef.current?.reset();
      const t = setTimeout(() => setJustUploaded(null), 1500);
      return () => clearTimeout(t);
    }
  }, [state, pending]);

  const showError = !state.ok && "error" in state;

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <Input
        type="file"
        name="file"
        accept="application/pdf"
        required
        onChange={(e) => setHasFile(!!e.currentTarget.files?.length)}
      />
      <Input
        type="text"
        name="label"
        placeholder="Label (optional — defaults to filename)"
        maxLength={80}
      />
      {showError && (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}
      <Button
        type="submit"
        disabled={pending || (!hasFile && !justUploaded)}
        aria-live="polite"
        className={cn(
          "transition-colors",
          justUploaded && "bg-emerald-600 text-white hover:bg-emerald-600"
        )}
      >
        {pending ? (
          <span className="inline-flex items-center gap-2">
            <ExtractingDots /> Extracting…
          </span>
        ) : justUploaded ? (
          <span className="inline-flex items-center gap-1.5">
            <CheckIcon /> Uploaded
          </span>
        ) : (
          "Upload"
        )}
      </Button>
    </form>
  );
}

function ExtractingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-label="Extracting">
      <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-current" />
    </span>
  );
}

function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
      aria-hidden
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
