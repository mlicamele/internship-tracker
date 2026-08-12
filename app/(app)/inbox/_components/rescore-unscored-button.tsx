"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { rescoreUnscoredInboxAction } from "../actions";

/**
 * "Score N unscored" button in the inbox header. Only rendered when the
 * server-side count of null-scored inbox apps is > 0. Batches Groq calls
 * via the process-wide rate limiter, so tapping this on 15 rows takes
 * ~6-10s of quiet loading; the page revalidates when done.
 */
export function RescoreUnscoredButton({ unscoredCount }: { unscoredCount: number }) {
  const [pending, startTransition] = useTransition();
  const [lastResult, setLastResult] = useState<null | {
    rescored: number;
    errors: number;
    noResume: number;
  }>(null);

  if (unscoredCount === 0 && !lastResult) return null;

  function onClick() {
    startTransition(async () => {
      try {
        const r = await rescoreUnscoredInboxAction();
        setLastResult({ rescored: r.rescored, errors: r.errors, noResume: r.noResume });
        if (r.noResume > 0) {
          toast.warning(
            `No master resume set — ${r.noResume} row${r.noResume === 1 ? "" : "s"} skipped. Upload one in Settings.`
          );
        } else if (r.errors > 0) {
          toast.warning(
            `Scored ${r.rescored}, but ${r.errors} failed (LLM error / rate limit). Try again in a bit.`
          );
        } else if (r.rescored > 0) {
          toast.success(`Scored ${r.rescored} inbox row${r.rescored === 1 ? "" : "s"}.`);
        }
      } catch {
        toast.error("Couldn't rescore inbox. Check console.");
      }
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={pending || unscoredCount === 0}
      className="text-xs"
    >
      {pending
        ? "Scoring…"
        : unscoredCount > 0
          ? `Score ${unscoredCount} unscored`
          : "All scored"}
    </Button>
  );
}
