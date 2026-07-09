"use client";

import { useEffect, useRef, useState } from "react";
import type { ResumeFitDetails, RubricGrade } from "@/lib/db/types";
import {
  RUBRIC_ANCHORS,
  RUBRIC_CATEGORIES_ORDERED,
  RUBRIC_CATEGORY_LABELS,
  type RubricCategory,
} from "@/lib/scoring/resume-fit";
import { cn } from "@/lib/utils";

const CLOSE_DELAY_MS = 120;

/**
 * Wrap a resume-fit badge with a hover popover that reveals the rubric
 * breakdown emitted by the LLM: per-category grade (1..5), the anchor
 * description at that grade, the LLM's short evidence-cite note, plus
 * matched skills, gaps, and the overall rationale.
 *
 * Interaction:
 * - Hover the trigger OR the popover → popover stays open.
 * - The popover has `pointer-events: auto` so the mouse can move onto it
 *   (this lets you read long text and select-to-copy). onMouseEnter on
 *   the popover keeps `hover` true even after mouse leaves the trigger.
 * - Small `i` icon appended to the trigger signals the affordance.
 */
export function ResumeFitDetailsPopover({
  details,
  score,
  children,
  align = "start",
}: {
  details: ResumeFitDetails | null;
  score: number | null;
  children: React.ReactNode;
  /** Horizontal alignment: "start" (default) or "end". Use "end" when trigger is near right edge. */
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearCloseTimer() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function scheduleClose() {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }

  function openNow() {
    clearCloseTimer();
    setOpen(true);
  }

  useEffect(() => () => clearCloseTimer(), []);

  if (!details) return <>{children}</>;

  const insufficient = details.tier === "insufficient";

  return (
    <span
      className="relative inline-flex cursor-help items-center gap-0.5"
      onMouseEnter={openNow}
      onMouseLeave={scheduleClose}
    >
      <span
        aria-hidden
        className="inline-flex size-3 items-center justify-center rounded-full border border-current text-[9px] font-bold leading-none opacity-70"
      >
        i
      </span>
      {children}

      {open && (
        // Outer wrapper closes the visual gap: pt-1 creates a transparent
        // "bridge" so the mouse can move from the trigger's bottom edge
        // into the tooltip without ever hitting empty space. The wrapper
        // itself is inside the trigger's onMouseLeave region.
        <div
          onMouseEnter={openNow}
          onMouseLeave={scheduleClose}
          className={cn(
            "absolute top-full z-50 pt-1",
            align === "end" ? "right-0" : "left-0"
          )}
        >
          <div
            role="tooltip"
            className="w-80 space-y-2 rounded-md border border-border bg-popover p-3 text-xs text-popover-foreground shadow-md"
          >
          <div className="flex items-baseline justify-between border-b border-border/60 pb-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Resume fit
            </span>
            {score != null ? (
              <span className="text-base font-semibold tabular-nums">
                {Math.round(score)}
              </span>
            ) : insufficient ? (
              <span className="text-[10px] font-medium uppercase text-muted-foreground">
                low signal
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>

          {!insufficient && (
            <div className="space-y-2">
              {RUBRIC_CATEGORIES_ORDERED.map((cat) => (
                <CategoryRow
                  key={cat}
                  category={cat}
                  grade={details[cat] as RubricGrade}
                  note={details[`${cat}_note` as keyof ResumeFitDetails] as string}
                />
              ))}
            </div>
          )}

          {details.rationale && (
            <p className="border-t border-border/60 pt-1.5 italic leading-snug text-muted-foreground">
              {details.rationale}
            </p>
          )}

          {details.matched_skills.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Matched
              </div>
              <div className="flex flex-wrap gap-1">
                {details.matched_skills.map((s) => (
                  <span
                    key={s}
                    className="rounded-sm bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {details.gaps.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Gaps
              </div>
              <div className="flex flex-wrap gap-1">
                {details.gaps.map((g) => (
                  <span
                    key={g}
                    className="rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
                  >
                    {g}
                  </span>
                ))}
              </div>
            </div>
          )}
          </div>
        </div>
      )}
    </span>
  );
}

/**
 * Single rubric-category row: label + numeric grade badge + anchor text +
 * LLM's evidence-cite note. Grade badge colored by category-specific
 * mapping (seniority peaks at 3, others peak at 5).
 */
function CategoryRow({
  category,
  grade,
  note,
}: {
  category: RubricCategory;
  grade: RubricGrade;
  note: string;
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium">
          {RUBRIC_CATEGORY_LABELS[category]}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">
            {RUBRIC_ANCHORS[category][grade]}
          </span>
          <GradeBadge category={category} grade={grade} />
        </div>
      </div>
      {note && (
        <p className="text-[10px] leading-snug text-muted-foreground">{note}</p>
      )}
    </div>
  );
}

function GradeBadge({
  category,
  grade,
}: {
  category: RubricCategory;
  grade: RubricGrade;
}) {
  const strength = strengthFor(category, grade);
  const classes =
    strength === "strong"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
      : strength === "mid"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
        : "bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex min-w-[1.5rem] items-center justify-center rounded px-1 py-0.5 text-[10px] font-semibold tabular-nums",
        classes
      )}
    >
      {grade}
    </span>
  );
}

/**
 * Coarse strength band per (category, grade) — drives badge color only.
 * Seniority peaks at 5-6 ("at level"); other categories rise monotonically.
 */
function strengthFor(
  category: RubricCategory,
  grade: RubricGrade
): "low" | "mid" | "strong" {
  if (category === "seniority_fit") {
    if (grade === 5 || grade === 6) return "strong";
    if (grade === 4 || grade === 7) return "mid";
    return "low";
  }
  if (grade >= 7) return "strong";
  if (grade >= 4) return "mid";
  return "low";
}
