"use client";

import { useState } from "react";
import type { ConfidenceTier } from "@/lib/db/types";

const TIER_COLOR: Record<ConfidenceTier, string> = {
  high: "text-emerald-500",
  medium: "text-amber-500",
  low: "text-rose-500",
};

const TIER_LABEL: Record<ConfidenceTier, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/**
 * Small inline confidence indicator. Hovering / focusing the "i" icon
 * shows the per-field confidence tier (color-coded green/yellow/red).
 *
 * Renders nothing when there is no confidence for the field (manually
 * edited or never extracted).
 */
export function ConfidenceBadge({
  confidence,
}: {
  confidence: ConfidenceTier | undefined;
}) {
  const [open, setOpen] = useState(false);
  if (!confidence) return null;
  const colorCls = TIER_COLOR[confidence];

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        tabIndex={0}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        aria-label={`Auto-extraction confidence: ${TIER_LABEL[confidence]}`}
        className="ml-1 inline-flex h-3.5 w-3.5 cursor-help select-none items-center justify-center rounded-full border border-current text-[8px] font-semibold leading-none text-muted-foreground"
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
        >
          Confidence:{" "}
          <span className={`font-semibold ${colorCls}`}>
            {TIER_LABEL[confidence]}
          </span>
        </span>
      )}
    </span>
  );
}
