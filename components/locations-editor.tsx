"use client";

import { useState } from "react";

/**
 * Controlled list editor for location strings. Each existing entry has a ✕
 * remove button; an input lets you add new ones. Pure UI — the caller owns
 * state via `value` + `onChange`.
 */
export function LocationsEditor({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [newEntry, setNewEntry] = useState("");

  function add() {
    const t = newEntry.trim();
    if (!t) return;
    if (value.some((s) => s.toLowerCase() === t.toLowerCase())) {
      setNewEntry("");
      return;
    }
    onChange([...value, t]);
    setNewEntry("");
  }

  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-2">
      {value.length === 0 && (
        <p className="text-xs italic text-muted-foreground">No locations.</p>
      )}
      <ul className="space-y-1">
        {value.map((loc, idx) => (
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
    </div>
  );
}
