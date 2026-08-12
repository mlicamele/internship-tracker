"use client";

import { useRouter } from "next/navigation";
import { useTransition, useState } from "react";
import type { ResumeVersion } from "@/lib/db/types";
import { setTriageResumeAction } from "../actions";

/**
 * "Score against" dropdown at the top of /inbox. Picking a resume triggers
 * a batch rescore of every inbox app against that resume, then reloads the
 * page with the fresh scores. Main is the default; picking main clears
 * the URL query param (so bookmarks stay stable).
 *
 * The batch is synchronous on purpose — user waits, then sees the answer.
 * With ~15-20 inbox apps at 400ms serialized Groq calls each, a full switch
 * takes ~8s. Loading state is a spinner + disabled select.
 */
export function TriageResumePicker({
  versions,
  selectedId,
  mainId,
}: {
  versions: ResumeVersion[];
  selectedId: string | null;
  mainId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [localSelected, setLocalSelected] = useState<string | null>(selectedId);

  function onChange(next: string) {
    const nextId = next === "__main__" ? null : next;
    setLocalSelected(nextId ?? mainId);
    startTransition(async () => {
      await setTriageResumeAction(nextId);
      // The URL query param captures the intent so a reload picks the same
      // resume next time.
      if (nextId) {
        router.push(`/inbox?resume=${encodeURIComponent(nextId)}`);
      } else {
        router.push("/inbox");
      }
    });
  }

  // The <select> value: "__main__" for the default, otherwise the picked id.
  const selectValue =
    localSelected == null || localSelected === mainId
      ? "__main__"
      : localSelected;

  return (
    <div className="flex items-center gap-2 text-xs">
      <label htmlFor="triage-resume" className="text-muted-foreground">
        Score against:
      </label>
      <select
        id="triage-resume"
        value={selectValue}
        onChange={(e) => onChange(e.target.value)}
        disabled={pending}
        className="h-8 rounded-md border border-input bg-background px-2 pr-8 text-xs shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="__main__">
          {mainLabelFor(versions.find((v) => v.id === mainId) ?? null)}
        </option>
        {versions
          .filter((v) => v.id !== mainId)
          .map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
      </select>
      {pending && (
        <span className="text-muted-foreground" aria-live="polite">
          Rescoring…
        </span>
      )}
    </div>
  );
}

function mainLabelFor(main: ResumeVersion | null): string {
  if (!main) return "No main resume";
  return `${main.label} (main)`;
}
