"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { cn } from "@/lib/utils";

interface InlineEditProps<T> {
  /** Current display value */
  value: T;
  /** Render the display (read-mode) representation */
  display: (value: T) => ReactNode;
  /**
   * Render the edit-mode input. Receives:
   *   draft   — current draft value
   *   setDraft — update draft (does not save)
   *   commit  — call to save the current draft
   *   cancel  — call to revert without saving
   *   inputRef — attach to the focusable element for autofocus
   */
  edit: (args: {
    draft: T;
    setDraft: (v: T) => void;
    commit: () => void;
    cancel: () => void;
    inputRef: React.MutableRefObject<HTMLInputElement | HTMLSelectElement | null>;
  }) => ReactNode;
  /** Server action wrapper. Resolves with success or returns error string. */
  onSave: (next: T) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Optional label rendered above value (used by metadata row) */
  label?: ReactNode;
  /** Custom className applied to the display wrapper */
  className?: string;
}

export function InlineEdit<T>({
  value,
  display,
  edit,
  onSave,
  label,
  className,
}: InlineEditProps<T>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<T>(value);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);

  // Autofocus on enter-edit
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current instanceof HTMLInputElement) {
        inputRef.current.select();
      }
    }
  }, [editing]);

  function enterEdit() {
    setDraft(value);
    setError(null);
    setEditing(true);
  }

  // Briefly flash "saved" indicator
  useEffect(() => {
    if (!savedFlash) return;
    const t = setTimeout(() => setSavedFlash(false), 1200);
    return () => clearTimeout(t);
  }, [savedFlash]);

  const commit = useCallback(() => {
    setError(null);
    // No-op if nothing changed
    if (Object.is(draft, value)) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      const result = await onSave(draft);
      if (result.ok) {
        setEditing(false);
        setSavedFlash(true);
      } else {
        setError(result.error);
        // Keep editing so user can fix
      }
    });
  }, [draft, value, onSave]);

  const cancel = useCallback(() => {
    setDraft(value);
    setError(null);
    setEditing(false);
  }, [value]);

  // Global keydown handlers while editing
  useEffect(() => {
    if (!editing) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      } else if (e.key === "Enter" && !e.shiftKey) {
        // Only commit on Enter for single-line inputs
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "SELECT") {
          e.preventDefault();
          commit();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [editing, commit, cancel]);

  return (
    <div className={cn("group/inline-edit", className)}>
      {label && (
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
      )}
      {editing ? (
        <div className="space-y-1">
          <div onBlur={(e) => {
            // commit on blur if focus is leaving the edit container entirely
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              commit();
            }
          }}>
            {edit({ draft, setDraft, commit, cancel, inputRef })}
          </div>
          {error && (
            <p className="text-[11px] text-destructive" role="alert">
              {error}
            </p>
          )}
          {pending && (
            <p className="text-[11px] text-muted-foreground">Saving…</p>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={enterEdit}
          className={cn(
            "group/inline-edit-button min-h-7 w-full cursor-text rounded-sm px-1 py-0.5 -mx-1 text-left text-sm transition-colors",
            "hover:bg-muted/40 focus:outline-none focus-visible:bg-muted/40",
            savedFlash && "ring-1 ring-emerald-500/40"
          )}
        >
          {display(value)}
        </button>
      )}
    </div>
  );
}
