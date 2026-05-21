"use client";

import { useTransition } from "react";
import { revertRoleFieldAction } from "@/app/(app)/app/[id]/actions";

type RoleEditableField = Parameters<typeof revertRoleFieldAction>[1];

/**
 * Tiny revert icon shown next to a pipeline cell whose current value differs
 * from the LLM extraction snapshot. Clicking restores the field to the
 * extracted value (and restores its original confidence tier).
 */
export function RevertButton({
  applicationId,
  field,
}: {
  applicationId: string;
  field: RoleEditableField;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        start(async () => {
          await revertRoleFieldAction(applicationId, field);
        });
      }}
      disabled={pending}
      className="ml-1 inline-flex size-5 items-center justify-center rounded-sm text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
      title="Revert to auto-extracted value"
      aria-label="Revert to auto-extracted value"
    >
      ↺
    </button>
  );
}

export type { RoleEditableField };
