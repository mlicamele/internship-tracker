"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { RoleLocation } from "@/lib/db/types";
import { updateRoleFieldAction } from "@/app/(app)/app/[id]/actions";
import { LocationsEditor } from "@/components/locations-editor";
import { formatLocations } from "./cell-formatters";

/**
 * Inline locations cell. Hover shows a read-only list preview. Click opens
 * the popover editor with Save / Cancel.
 */
export function LocationsCell({
  applicationId,
  locations,
}: {
  applicationId: string;
  locations: RoleLocation[];
}) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [draft, setDraft] = useState<string[]>(() =>
    locations.map((l) => l.text)
  );
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement | null>(null);

  // Resync when server data changes while the editor is closed
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft(locations.map((l) => l.text));
    }
  }, [locations, open]);

  // Close edit popover on outside click / Escape
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) cancel();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") cancel();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function cancel() {
    setDraft(locations.map((l) => l.text));
    setOpen(false);
  }

  function save() {
    const joined = draft.join("\n");
    startTransition(async () => {
      await updateRoleFieldAction(applicationId, "locations", joined);
      setOpen(false);
    });
  }

  // Hover preview shows only when the edit popover is closed
  const showHoverPreview = hover && !open && locations.length > 0;

  return (
    <div
      ref={ref}
      className="relative inline-flex"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex h-10 cursor-pointer items-center rounded-sm px-1.5 text-left hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        {formatLocations(locations)}
      </button>

      {showHoverPreview && (
        <div
          role="tooltip"
          className="pointer-events-none absolute left-0 top-full z-40 mt-1 w-56 rounded-md border border-border bg-popover p-2 text-xs text-popover-foreground shadow-md"
        >
          <ul className="space-y-0.5">
            {locations.map((loc, i) => (
              <li key={i} className="truncate">
                {loc.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 top-full z-50 mt-1 w-72 space-y-2 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md"
        >
          <LocationsEditor value={draft} onChange={setDraft} />
          <div className="flex justify-end gap-2 border-t border-border/60 pt-2">
            <button
              type="button"
              onClick={cancel}
              disabled={pending}
              className="rounded-sm px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="rounded-sm bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
