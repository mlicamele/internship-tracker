"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { RoleLocation } from "@/lib/db/types";
import { updateRoleFieldAction } from "@/app/(app)/app/[id]/actions";
import { formatLocations } from "./cell-formatters";

/**
 * Click-to-edit locations cell. Opens a popover with the current list
 * (each row deletable) plus an add-input. Saves the joined list as a
 * comma/newline-separated string via updateRoleFieldAction.
 */
export function LocationsCell({
  applicationId,
  locations,
}: {
  applicationId: string;
  locations: RoleLocation[];
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(() =>
    locations.map((l) => l.text)
  );
  const [newEntry, setNewEntry] = useState("");
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement | null>(null);

  // Resync when the server-side locations change while the popover is closed
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft(locations.map((l) => l.text));
    }
  }, [locations, open]);

  // Close on outside click / escape
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
    setNewEntry("");
    setOpen(false);
  }

  function add() {
    const t = newEntry.trim();
    if (!t) return;
    if (draft.some((s) => s.toLowerCase() === t.toLowerCase())) {
      setNewEntry("");
      return;
    }
    setDraft((d) => [...d, t]);
    setNewEntry("");
  }

  function remove(idx: number) {
    setDraft((d) => d.filter((_, i) => i !== idx));
  }

  function save() {
    const joined = draft.join("\n");
    startTransition(async () => {
      await updateRoleFieldAction(applicationId, "locations", joined);
      setOpen(false);
    });
  }

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="-mx-1 cursor-text rounded-sm px-1 py-0.5 text-left underline decoration-dotted decoration-muted-foreground/40 underline-offset-4 hover:bg-muted/40 hover:decoration-muted-foreground"
      >
        {formatLocations(locations)}
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 top-full z-50 mt-1 w-72 space-y-2 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md"
        >
          {draft.length === 0 && (
            <p className="text-xs italic text-muted-foreground">
              No locations.
            </p>
          )}
          <ul className="space-y-1">
            {draft.map((loc, idx) => (
              <li
                key={`${loc}-${idx}`}
                className="flex items-center justify-between gap-2 rounded-sm px-1 py-0.5 hover:bg-muted/40"
              >
                <span className="truncate text-sm">{loc}</span>
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  className="text-xs text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${loc}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-1 border-t border-border/60 pt-2">
            <input
              type="text"
              value={newEntry}
              onChange={(e) => setNewEntry(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder="Add location…"
              className="h-7 w-full rounded-sm border border-input bg-transparent px-1.5 text-xs"
            />
            <button
              type="button"
              onClick={add}
              className="rounded-sm px-2 py-1 text-xs hover:bg-muted"
            >
              +
            </button>
          </div>
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
