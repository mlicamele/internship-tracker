"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
import {
  motion,
  useMotionValue,
  useTransform,
  animate as framerAnimate,
  type MotionValue,
  type PanInfo,
} from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { FitScore } from "@/lib/scoring/fit";
import { ResumeFitDetailsPopover } from "@/components/resume-fit-details-popover";
import { LinkStatusBadge } from "@/components/link-status-badge";
import type { ResumeFitDetails } from "@/lib/db/types";
import {
  RelocationAssistanceCell,
  WorkModelCell,
  formatCompensation,
  formatDate,
  formatDistance,
  formatLocations,
  formatGradYearWindow,
  formatTargetTerm,
} from "@/app/(app)/pipeline/_components/cell-formatters";
import type { PipelineRow } from "@/app/(app)/pipeline/_components/columns";
import { resetToInboxAction, triageAction, type TriageAction } from "../actions";

const SWIPE_DISTANCE_THRESHOLD = 100;
const SWIPE_VELOCITY_THRESHOLD = 500;
const EXIT_DURATION = 0.25;
const UNDO_STACK_MAX = 10;

type UndoEntry = {
  row: PipelineRow;
  action: TriageAction;
  deckSnapshot: PipelineRow[];
};

/** True when the event target is a form field — don't hijack typing. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

/**
 * Card-based swipe view over the sorted inbox. Right = apply, left = skip,
 * up = snooze (7 days). Tap-friendly buttons underneath for non-touch input.
 * Optimistic: advances the deck immediately, rolls back on server error.
 *
 * Ineligible rows (class-year mismatch) are excluded from the deck — cards are
 * for "help me decide" among viable roles. Users can still triage those in
 * list view.
 */
export function TriageDeck({
  rows,
  interestTags,
}: {
  rows: PipelineRow[];
  interestTags: string[];
}) {
  const eligibleRows = rows.filter((r) => !r.fit_details?.ineligible);
  const [deck, setDeck] = useState<PipelineRow[]>(eligibleRows);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [, startTransition] = useTransition();

  const total = eligibleRows.length;
  const remaining = deck.length;
  const done = total - remaining;
  const undoCount = undoStack.length;
  const lastAction = undoStack[undoStack.length - 1] ?? null;

  const handleSwipe = useCallback(
    (action: TriageAction) => {
      const currentDeck = deck;
      const top = currentDeck[0];
      if (!top) return;
      setDeck(currentDeck.slice(1));
      setUndoStack((stack) => {
        const appended = [
          ...stack,
          { row: top, action, deckSnapshot: currentDeck },
        ];
        return appended.length > UNDO_STACK_MAX
          ? appended.slice(appended.length - UNDO_STACK_MAX)
          : appended;
      });
      startTransition(async () => {
        try {
          await triageAction(top.id, action);
        } catch {
          toast.error("Couldn't save that action. Restoring card.");
          setDeck(currentDeck);
          setUndoStack((stack) =>
            stack.length && stack[stack.length - 1].row.id === top.id
              ? stack.slice(0, -1)
              : stack
          );
        }
      });
    },
    [deck, startTransition]
  );

  const handleUndo = useCallback(() => {
    const stack = undoStack;
    if (stack.length === 0) return;
    const entry = stack[stack.length - 1];
    setUndoStack(stack.slice(0, -1));
    startTransition(async () => {
      try {
        await resetToInboxAction(entry.row.id);
        setDeck(entry.deckSnapshot);
      } catch {
        toast.error("Couldn't undo.");
        setUndoStack((s) => [...s, entry]);
      }
    });
  }, [undoStack, startTransition]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      const key = e.key.toLowerCase();
      switch (key) {
        case "j":
          e.preventDefault();
          handleSwipe("skip");
          break;
        case "k":
          e.preventDefault();
          handleSwipe("apply");
          break;
        case "u":
          e.preventDefault();
          handleSwipe("snooze");
          break;
        case "z":
          e.preventDefault();
          handleUndo();
          break;
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleSwipe, handleUndo]);

  if (total === 0) {
    return (
      <div className="rounded-md border border-border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No eligible roles in the inbox.
        </p>
      </div>
    );
  }

  if (remaining === 0) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-border border-dashed p-8 text-center">
          <p className="text-base font-medium">You&rsquo;re all caught up.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Triaged {total} role{total === 1 ? "" : "s"}.
          </p>
        </div>
        {lastAction && (
          <div className="text-center">
            <button
              type="button"
              onClick={handleUndo}
              className="text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Undo last ({actionLabel(lastAction.action)}
              {undoCount > 1 ? `, ${undoCount} in stack` : ""})
            </button>
          </div>
        )}
      </div>
    );
  }

  const top = deck[0];
  const next = deck[1];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <button
          type="button"
          onClick={handleUndo}
          disabled={undoCount === 0}
          className={cn(
            "font-medium underline-offset-4 hover:underline",
            undoCount === 0 && "invisible"
          )}
        >
          Undo {undoCount > 0 && `(${undoCount})`}
        </button>
        <span className="tabular-nums">
          {done + 1} of {total}
        </span>
      </div>

      <div className="relative mx-auto w-full max-w-md h-[560px] sm:h-[600px]">
        {next && <PeekCard key={next.id} row={next} interestTags={interestTags} />}
        <TopCard
          key={top.id}
          row={top}
          interestTags={interestTags}
          onSwipe={handleSwipe}
        />
      </div>

      <div className="mx-auto flex max-w-md items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          className="flex-1 text-muted-foreground hover:text-destructive"
          onClick={() => handleSwipe("skip")}
        >
          Skip
        </Button>
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={() => handleSwipe("snooze")}
        >
          Snooze 7d
        </Button>
        <Button
          type="button"
          className="flex-1"
          onClick={() => handleSwipe("apply")}
        >
          Apply
        </Button>
      </div>

      <div className="space-y-1 text-center text-[11px] text-muted-foreground">
        <p>Swipe right to apply · left to skip · up to snooze</p>
        <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <span>
            <Kbd>j</Kbd> skip
          </span>
          <span>
            <Kbd>k</Kbd> apply
          </span>
          <span>
            <Kbd>u</Kbd> snooze
          </span>
          <span>
            <Kbd>z</Kbd> undo
          </span>
        </p>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted/60 px-1 py-px font-mono text-[10px] font-semibold text-foreground">
      {children}
    </kbd>
  );
}

function TopCard({
  row,
  interestTags,
  onSwipe,
}: {
  row: PipelineRow;
  interestTags: string[];
  onSwipe: (a: TriageAction) => void;
}) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-300, 0, 300], [-18, 0, 18]);
  const [isExiting, setIsExiting] = useState(false);

  function commitExit(action: TriageAction, target: { x?: number; y?: number }) {
    setIsExiting(true);
    if (target.x != null) framerAnimate(x, target.x, { duration: EXIT_DURATION });
    if (target.y != null) framerAnimate(y, target.y, { duration: EXIT_DURATION });
    window.setTimeout(() => onSwipe(action), EXIT_DURATION * 1000);
  }

  function handleDragEnd(_: unknown, info: PanInfo) {
    const { offset, velocity } = info;
    if (
      offset.x > SWIPE_DISTANCE_THRESHOLD ||
      velocity.x > SWIPE_VELOCITY_THRESHOLD
    ) {
      commitExit("apply", { x: 500 });
    } else if (
      offset.x < -SWIPE_DISTANCE_THRESHOLD ||
      velocity.x < -SWIPE_VELOCITY_THRESHOLD
    ) {
      commitExit("skip", { x: -500 });
    } else if (
      offset.y < -SWIPE_DISTANCE_THRESHOLD ||
      velocity.y < -SWIPE_VELOCITY_THRESHOLD
    ) {
      commitExit("snooze", { y: -500 });
    } else {
      framerAnimate(x, 0, { type: "spring", stiffness: 300, damping: 25 });
      framerAnimate(y, 0, { type: "spring", stiffness: 300, damping: 25 });
    }
  }

  return (
    <motion.div
      drag={!isExiting}
      dragMomentum={false}
      style={{ x, y, rotate }}
      onDragEnd={handleDragEnd}
      className="absolute inset-0 z-10 cursor-grab touch-none rounded-xl border border-border bg-card shadow-lg active:cursor-grabbing"
    >
      <CardContent row={row} interestTags={interestTags} />
      <DirectionOverlay x={x} y={y} />
    </motion.div>
  );
}

function PeekCard({
  row,
  interestTags,
}: {
  row: PipelineRow;
  interestTags: string[];
}) {
  return (
    <div
      aria-hidden
      className="absolute inset-0 z-0 rounded-xl border border-border bg-card shadow-md"
      style={{ transform: "translateY(12px) scale(0.96)" }}
    >
      <CardContent row={row} interestTags={interestTags} muted />
    </div>
  );
}

function DirectionOverlay({
  x,
  y,
}: {
  x: MotionValue<number>;
  y: MotionValue<number>;
}) {
  const applyOp = useTransform(x, [0, 60, 150], [0, 0, 0.9]);
  const skipOp = useTransform(x, [-150, -60, 0], [0.9, 0, 0]);
  const snoozeOp = useTransform(y, [-150, -60, 0], [0.9, 0, 0]);

  return (
    <>
      <motion.div
        style={{ opacity: applyOp }}
        className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-emerald-500/20"
      >
        <span className="rounded-md border-4 border-emerald-500 px-4 py-2 text-3xl font-black uppercase tracking-widest text-emerald-600 -rotate-12">
          Apply
        </span>
      </motion.div>
      <motion.div
        style={{ opacity: skipOp }}
        className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-red-500/20"
      >
        <span className="rounded-md border-4 border-red-500 px-4 py-2 text-3xl font-black uppercase tracking-widest text-red-600 rotate-12">
          Skip
        </span>
      </motion.div>
      <motion.div
        style={{ opacity: snoozeOp }}
        className="pointer-events-none absolute inset-0 flex items-start justify-center rounded-xl bg-sky-500/20 pt-16"
      >
        <span className="rounded-md border-4 border-sky-500 px-4 py-2 text-3xl font-black uppercase tracking-widest text-sky-600">
          Snooze
        </span>
      </motion.div>
    </>
  );
}

function CardContent({
  row,
  interestTags,
  muted = false,
}: {
  row: PipelineRow;
  interestTags: string[];
  muted?: boolean;
}) {
  const r = row.role;
  const interestSet = new Set(interestTags);
  return (
    <div
      className={cn(
        "flex h-full flex-col gap-4 p-5",
        muted && "opacity-60 pointer-events-none"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight break-words">
            <span>{r.company.name}</span>
            <LinkStatusBadge status={r.link_status} checkedAt={r.link_checked_at} />
          </h2>
          <p className="mt-1 text-sm text-muted-foreground break-words">
            {r.title}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <CombinedBadge total={row.combined_total} usedResumeSignal={row.combined_used_resume_signal} />
          <FitBadge fit={row.fit_details} />
          <ResumeFitBadge score={row.resume_fit_score} details={row.resume_fit_details} />
        </div>
      </div>

      {r.tags && r.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {r.tags.map((t) => {
            const isInterest = interestSet.has(t);
            return (
              <span
                key={t}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  isInterest
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                    : "border-border bg-muted/40 text-muted-foreground"
                )}
              >
                {t}
              </span>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-3">
        <Stat label="Target">
          {formatTargetTerm(r.target_year, r.target_season)}
        </Stat>
        <Stat label="Deadline">{formatDate(r.deadline_at)}</Stat>
        <Stat label="Location">{formatLocations(r.locations)}</Stat>
        <Stat label="Distance">{formatDistance(row.distance_miles)}</Stat>
        <Stat label="Mode">
          <WorkModelCell model={r.work_model} />
        </Stat>
        <Stat label="Grad year">
          {formatGradYearWindow(r.min_grad_year, r.max_grad_year)}
        </Stat>
        <Stat label="Relocation">
          <RelocationAssistanceCell value={r.relocation_assistance} />
        </Stat>
        <Stat label="$/hr">
          {formatCompensation(r.compensation_hourly_dollars)}
        </Stat>
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3 text-xs">
        <Link
          href={`/app/${row.id}`}
          className="rounded-sm px-1 py-0.5 font-medium text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        >
          Details
        </Link>
        {r.jd_url && (
          <a
            href={r.jd_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-sm px-1 py-0.5 font-medium text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
            <span>Posting</span>
          </a>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-sm truncate">{children}</span>
    </div>
  );
}

function scoreBandClasses(pct: number): string {
  if (pct >= 75) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
  if (pct >= 50) return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  return "bg-muted text-muted-foreground";
}

function FitBadge({ fit }: { fit: FitScore | null }) {
  if (!fit) return null;
  const pct = Math.round(fit.total * 100);
  const classes = fit.ineligible
    ? "bg-destructive/10 text-destructive"
    : scoreBandClasses(pct);
  return (
    <span
      className={cn(
        "shrink-0 rounded px-2 py-0.5 text-xs font-semibold tabular-nums opacity-60",
        classes
      )}
    >
      Fit {pct}
    </span>
  );
}

function ResumeFitBadge({
  score,
  details,
}: {
  score: number | null;
  details: ResumeFitDetails | null;
}) {
  if (score == null) {
    if (details?.tier === "insufficient") {
      return (
        <ResumeFitDetailsPopover details={details} score={null} align="end">
          <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground opacity-60">
            Resume — low signal
          </span>
        </ResumeFitDetailsPopover>
      );
    }
    return null;
  }
  const pct = Math.round(score);
  return (
    <ResumeFitDetailsPopover details={details} score={score} align="end">
      <span
        className={cn(
          "shrink-0 rounded px-2 py-0.5 text-xs font-semibold tabular-nums opacity-60",
          scoreBandClasses(pct)
        )}
      >
        Resume {pct}
      </span>
    </ResumeFitDetailsPopover>
  );
}

function CombinedBadge({
  total,
  usedResumeSignal,
}: {
  total: number | null;
  usedResumeSignal: boolean;
}) {
  if (total == null) return null;
  const pct = Math.round(total);
  return (
    <span
      className={cn(
        "shrink-0 rounded px-2 py-0.5 text-xs font-semibold tabular-nums",
        scoreBandClasses(pct),
        !usedResumeSignal && "italic"
      )}
    >
      Combined {pct}
    </span>
  );
}

function actionLabel(action: TriageAction): string {
  return action === "apply" ? "applied" : action === "snooze" ? "snoozed" : "skipped";
}
