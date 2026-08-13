"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const [setMainState, setMainAction, setMainPending] = useActionState(
    setMainResumeAction,
    INITIAL
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteResumeAction,
    INITIAL
  );

  // revalidatePath() in the server action invalidates the RSC cache, but
  // Next.js doesn't automatically re-fetch the CURRENT page — the router
  // keeps rendering the stale cached tree until something forces a
  // re-fetch. router.refresh() does exactly that. Set-as-main updates the
  // Main badge on OTHER rows too (they need to re-render with is_main =
  // false), which is where the delete path was accidentally getting away
  // with it: React reconciliation removes the deleted row's DOM even
  // though the parent's `versions` prop hasn't refreshed. For set-as-main
  // the row's is_main property MUST refresh from server data or the badge
  // stays wrong.
  //
  // Fire on the pending true → false transition specifically, so the
  // initial mount (INITIAL is `{ok: true}`) doesn't trigger an unwanted
  // refresh loop.
  const prevSetMainPending = useRef(false);
  useEffect(() => {
    if (prevSetMainPending.current && !setMainPending && setMainState.ok) {
      router.refresh();
    }
    prevSetMainPending.current = setMainPending;
  }, [setMainState, setMainPending, router]);
  const prevDeletePending = useRef(false);
  useEffect(() => {
    if (prevDeletePending.current && !deletePending && deleteState.ok) {
      router.refresh();
    }
    prevDeletePending.current = deletePending;
  }, [deleteState, deletePending, router]);

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
