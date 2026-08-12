"use client";

import { useEffect, useRef, useState } from "react";
import type { FitScore } from "@/lib/scoring/fit";
import { cn } from "@/lib/utils";

const CLOSE_DELAY_MS = 120;

/**
 * Hover popover that explains a Fit score by showing each component
 * (class-year × 0-1, distance × 0-1, interest × 0-1), the profile's
 * weight for that component, and its resulting contribution to the
 * total. Distance also shows the nearest-location miles when known.
 *
 * Matches the interaction contract of ResumeFitDetailsPopover so both
 * badges hover-close in the same way.
 */
export function FitDetailsPopover({
  fit,
  children,
  align = "start",
}: {
  fit: FitScore | null;
  children: React.ReactNode;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [flipUp, setFlipUp] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLSpanElement | null>(null);

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

  // Fit popover is ~200-260px tall (header + 3 component rows + footer).
  // Conservative estimate to decide flip vs open-below.
  const POPOVER_ESTIMATED_HEIGHT = 260;

  function openNow() {
    clearCloseTimer();
    // Decide flip direction based on available viewport space at open time
    // so bottom rows in pipeline/archive don't get their popovers clipped.
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setFlipUp(
        spaceBelow < POPOVER_ESTIMATED_HEIGHT && spaceAbove > spaceBelow
      );
    }
    setOpen(true);
  }

  useEffect(() => () => clearCloseTimer(), []);

  if (!fit) return <>{children}</>;

  const pct = Math.round(fit.total * 100);

  return (
    <span
      ref={triggerRef}
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
        <div
          onMouseEnter={openNow}
          onMouseLeave={scheduleClose}
          className={cn(
            "absolute z-50",
            flipUp ? "bottom-full pb-1" : "top-full pt-1",
            align === "end" ? "right-0" : "left-0"
          )}
        >
          <div
            role="tooltip"
            className="w-72 max-w-[calc(100vw-2rem)] space-y-2 whitespace-normal break-words rounded-md border border-border bg-popover p-3 text-xs text-popover-foreground shadow-md [overflow-wrap:anywhere]"
          >
            <div className="flex items-baseline justify-between border-b border-border/60 pb-1.5">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Fit
              </span>
              {fit.ineligible ? (
                <span className="text-xs font-semibold uppercase tracking-wide text-destructive">
                  Ineligible
                </span>
              ) : (
                <span className="text-base font-semibold tabular-nums">
                  {pct}
                </span>
              )}
            </div>

            {fit.ineligible && (
              <p className="italic leading-snug text-muted-foreground">
                Your grad year falls outside this role&rsquo;s min/max window.
                The other components still show below for reference.
              </p>
            )}

            <ComponentRow
              label="Class year"
              value={fit.components.classYear}
              weight={fit.weights.classYear}
              help={
                fit.components.classYear === 1
                  ? "In eligible range"
                  : fit.components.classYear === 0
                    ? "Outside eligible range"
                    : "No grad-year signal — neutral"
              }
            />
            <ComponentRow
              label="Distance"
              value={fit.components.distance}
              weight={fit.weights.distance}
              suffix={
                fit.distanceMiles != null
                  ? `${Math.round(fit.distanceMiles)} mi`
                  : undefined
              }
              help={
                fit.distanceMiles != null
                  ? "Nearest of the role's geocoded locations"
                  : "No geocoded location — neutral (or remote-friendly)"
              }
            />
            <ComponentRow
              label="Interest"
              value={fit.components.interest}
              weight={fit.weights.interest}
              help={
                fit.components.interest === 0.5
                  ? "No overlap signal — neutral"
                  : `${Math.round(fit.components.interest * 100)}% tag overlap with your interests`
              }
            />

            <p className="border-t border-border/60 pt-1.5 text-[10px] italic text-muted-foreground">
              Weights are configurable in Settings.
            </p>
          </div>
        </div>
      )}
    </span>
  );
}

/**
 * One component row: label + weight% + (value × weight = contribution).
 * Component value is 0..1; weight is 0..1; contribution is their product.
 */
function ComponentRow({
  label,
  value,
  weight,
  suffix,
  help,
}: {
  label: string;
  value: number;
  weight: number;
  suffix?: string;
  help?: string;
}) {
  const contribution = value * weight;
  return (
    <div className="space-y-0.5">
      <div className="flex items-start justify-between gap-2">
        <span className="shrink-0 text-[11px] font-medium">{label}</span>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 tabular-nums">
          <span className="text-[10px] text-muted-foreground">
            {value.toFixed(2)} × {Math.round(weight * 100)}%
          </span>
          <span className="min-w-[2rem] rounded bg-muted px-1.5 py-0.5 text-right text-[10px] font-medium">
            {contribution.toFixed(2)}
          </span>
        </div>
      </div>
      <div className="flex items-baseline justify-between gap-2 text-[10px] text-muted-foreground">
        {help ? <span className="leading-snug">{help}</span> : <span />}
        {suffix && <span className="shrink-0 tabular-nums">{suffix}</span>}
      </div>
    </div>
  );
}
