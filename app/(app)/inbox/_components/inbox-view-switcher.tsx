"use client";

import { useSyncExternalStore } from "react";
import type { PipelineRow } from "@/app/(app)/pipeline/_components/columns";
import { cn } from "@/lib/utils";
import { InboxList } from "./inbox-list";
import { TriageDeck } from "./triage-deck";

type View = "list" | "cards";
const STORAGE_KEY = "inbox_view";
const STORAGE_EVENT = "inbox_view:changed";

function subscribe(callback: () => void) {
  window.addEventListener(STORAGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(STORAGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function readStoredView(): View {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === "cards" ? "cards" : "list";
}

function serverSnapshot(): View {
  return "list";
}

/**
 * Client wrapper that lets the user pick between the always-visible list and
 * the swipe-card triage deck. Preference persists in localStorage (survives
 * reloads on the same device). SSR renders "list"; the client hydrates and
 * subscribes to a custom event so pick() in this tab and cross-tab storage
 * writes both flip the view.
 */
export function InboxViewSwitcher({ rows }: { rows: PipelineRow[] }) {
  const view = useSyncExternalStore(subscribe, readStoredView, serverSnapshot);

  function pick(next: View) {
    window.localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new Event(STORAGE_EVENT));
  }

  return (
    <div className="space-y-3">
      <div
        role="tablist"
        aria-label="Inbox view"
        className="inline-flex items-center rounded-md border border-border bg-background p-0.5 text-xs"
      >
        <ViewTab active={view === "list"} onClick={() => pick("list")}>
          List
        </ViewTab>
        <ViewTab active={view === "cards"} onClick={() => pick("cards")}>
          Cards
        </ViewTab>
      </div>

      {view === "list" ? <InboxList rows={rows} /> : <TriageDeck rows={rows} />}
    </div>
  );
}

function ViewTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "rounded px-3 py-1 font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
