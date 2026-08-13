"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  deleteResumeAction,
  setMainResumeAction,
  type RowActionResult,
} from "../resume-actions";

const INITIAL: RowActionResult = { ok: true };

/**
 * Per-row Set-as-main + Delete controls. Kept as a client component so the
 * server actions return `{ok, error?}` via `useActionState` instead of
 * redirecting — the resume list updates via `revalidatePath("/settings")`
 * without a full-page navigation, so the user's scroll position is preserved.
 *
 * Errors surface inline right below the row instead of via URL param +
 * top-of-page banner.
 */
export function ResumeRowActions({
  versionId,
  isMain,
  isOnlyResume,
}: {
  versionId: string;
  isMain: boolean;
  isOnlyResume: boolean;
}) {
  const [setMainState, setMainAction, setMainPending] = useActionState(
    setMainResumeAction,
    INITIAL
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteResumeAction,
    INITIAL
  );

  const errorMsg =
    (!setMainState.ok && "error" in setMainState && setMainState.error) ||
    (!deleteState.ok && "error" in deleteState && deleteState.error) ||
    null;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        {!isMain && (
          <form action={setMainAction}>
            <input type="hidden" name="id" value={versionId} />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={setMainPending}
            >
              {setMainPending ? "Setting…" : "Set as main"}
            </Button>
          </form>
        )}
        <form action={deleteAction}>
          <input type="hidden" name="id" value={versionId} />
          <Button
            type="submit"
            size="sm"
            variant="ghost"
            disabled={isOnlyResume || deletePending}
            title={
              isOnlyResume
                ? "Upload a replacement before deleting your only resume"
                : undefined
            }
          >
            {deletePending ? "Deleting…" : "Delete"}
          </Button>
        </form>
      </div>
      {errorMsg && (
        <p className="text-xs text-destructive" role="alert">
          {errorMsg}
        </p>
      )}
    </div>
  );
}
