"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";

interface Props<T> {
  value: T;
  display: (v: T) => ReactNode;
  /** Render the input element. Save on Enter/blur, cancel on Escape. */
  renderInput: (args: {
    draft: T;
    setDraft: (v: T) => void;
    commit: () => void;
    cancel: () => void;
    inputRef: React.MutableRefObject<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null
    >;
  }) => ReactNode;
  onSave: (v: T) => Promise<{ ok: true } | { ok: false; error: string }>;
}

/**
 * Compact click-to-edit cell for use inside the pipeline table. Reuses the
 * commit/cancel semantics of the detail-page InlineEdit but with smaller
 * padding and stopPropagation so it doesn't fight the table's row UI.
 */
export function TableInlineCell<T>({
  value,
  display,
  renderInput,
  onSave,
}: Props<T>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<T>(value);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null
  >(null);

  function startEdit() {
    setDraft(value);
    setEditing(true);
  }

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (
        inputRef.current instanceof HTMLInputElement ||
        inputRef.current instanceof HTMLTextAreaElement
      ) {
        inputRef.current.select?.();
      }
    }
  }, [editing]);

  const commit = useCallback(() => {
    if (draft === value) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      const result = await onSave(draft);
      if (result.ok) {
        setError(null);
        setEditing(false);
      } else {
        setError(result.error);
      }
    });
  }, [draft, value, onSave]);

  const cancel = useCallback(() => {
    setDraft(value);
    setError(null);
    setEditing(false);
  }, [value]);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          startEdit();
        }}
        className="-mx-1 cursor-text rounded-sm px-1 py-0.5 text-left underline decoration-dotted decoration-muted-foreground/40 underline-offset-4 hover:bg-muted/40 hover:decoration-muted-foreground"
      >
        {display(value)}
      </button>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      }}
    >
      {renderInput({ draft, setDraft, commit, cancel, inputRef })}
      {pending && <span className="text-xs text-muted-foreground">…</span>}
      {error && (
        <span className="text-xs text-destructive" title={error}>
          ✕
        </span>
      )}
    </span>
  );
}
