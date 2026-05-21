"use client";

import { useTransition } from "react";
import { cn } from "@/lib/utils";
import { revertRoleFieldAction } from "@/app/(app)/app/[id]/actions";

type RoleEditableField = Parameters<typeof revertRoleFieldAction>[1];

/**
 * Tiny revert icon shown next to a pipeline cell whose current value differs
 * from the LLM extraction snapshot. Clicking restores the field to the
 * extracted value (and restores its original confidence tier).
 *
 * When `visible={false}` the button stays in the DOM (preserves layout
 * space) but is hidden — that way the cell width doesn't change when the
 * user goes from clean → dirty.
 */
export function RevertButton({
  applicationId,
  field,
  visible = true,
}: {
  applicationId: string;
  field: RoleEditableField;
  visible?: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
      onClick={(e) => {
        if (!visible) return;
        e.stopPropagation();
        start(async () => {
          await revertRoleFieldAction(applicationId, field);
        });
      }}
      disabled={pending || !visible}
      className={cn(
        "inline-flex size-5 items-center justify-center rounded-sm text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
        !visible && "invisible pointer-events-none"
      )}
      title="Revert to auto-extracted value"
      aria-label="Revert to auto-extracted value"
    >
      ↺
    </button>
  );
}

export type { RoleEditableField };
