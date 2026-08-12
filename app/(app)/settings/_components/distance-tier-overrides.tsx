"use client";

import { useEffect, useMemo, useState } from "react";
import type { RelocationTolerance } from "@/lib/db/types";
import { cn } from "@/lib/utils";

// Kept in sync with PRESET_TIER_SCORES in lib/scoring/fit.ts. Duplicated on
// purpose so the client bundle doesn't have to import the server-facing
// scoring module. If you edit one, edit the other.
const PRESET_TIER_SCORES: Record<
  RelocationTolerance,
  { commutable: number; regional: number; domestic: number; distant: number }
> = {
  nope: { commutable: 1.0, regional: 0.55, domestic: 0.3, distant: 0.2 },
  regional: { commutable: 1.0, regional: 0.85, domestic: 0.65, distant: 0.5 },
  anywhere: { commutable: 1.0, regional: 0.95, domestic: 0.9, distant: 0.85 },
};

const TIERS = [
  {
    key: "commutable" as const,
    label: "Commutable",
    range: "< 30 mi",
  },
  {
    key: "regional" as const,
    label: "Regional",
    range: "30–150 mi",
  },
  {
    key: "domestic" as const,
    label: "Domestic",
    range: "150–1000 mi",
  },
  {
    key: "distant" as const,
    label: "Distant",
    range: "1000+ mi",
  },
] as const;

type TierKey = (typeof TIERS)[number]["key"];
type Overrides = Record<TierKey, number | null>;

/**
 * Advanced-mode expandable that reveals per-tier score sliders. Each
 * slider is 0–100; when null, the preset value for the currently-selected
 * relocation_tolerance applies (shown greyed as a placeholder). Setting
 * a slider unlocks that tier's override; a per-tier "reset" clears it.
 *
 * Emits 4 hidden inputs (empty string → null on the server side).
 *
 * Reads `relocation_tolerance` from the parent form's `<select>` on
 * mount + updates on change so the preset preview always matches the
 * current preset choice.
 */
export function DistanceTierOverrides({
  initialCommutable,
  initialRegional,
  initialDomestic,
  initialDistant,
  initialPreset,
}: {
  initialCommutable: number | null;
  initialRegional: number | null;
  initialDomestic: number | null;
  initialDistant: number | null;
  initialPreset: RelocationTolerance;
}) {
  const [expanded, setExpanded] = useState(false);
  const [preset, setPreset] = useState<RelocationTolerance>(initialPreset);
  const [overrides, setOverrides] = useState<Overrides>({
    commutable: initialCommutable,
    regional: initialRegional,
    domestic: initialDomestic,
    distant: initialDistant,
  });

  // Sync with the relocation_tolerance <select> in the parent form —
  // if the user changes preset, the greyed-out defaults should update.
  const anyOverride = useMemo(
    () => Object.values(overrides).some((v) => v != null),
    [overrides]
  );

  // React to changes on the sibling <select name="relocation_tolerance">
  // in the enclosing form — we don't own that element but we want the
  // greyed-out preset previews to update when the user picks a new preset.
  useEffect(() => {
    const forms = document.querySelectorAll("form");
    const target = Array.from(forms).find((f) =>
      f.querySelector('[name="relocation_tolerance"]')
    );
    if (!target) return;
    const handler = (e: Event) => {
      const el = e.target as HTMLSelectElement | null;
      if (el?.name === "relocation_tolerance") {
        setPreset(el.value as RelocationTolerance);
      }
    };
    target.addEventListener("change", handler);
    return () => target.removeEventListener("change", handler);
  }, []);

  function updateOverride(key: TierKey, next: number) {
    const clamped = Math.max(0, Math.min(100, Math.round(next)));
    setOverrides((prev) => ({ ...prev, [key]: clamped }));
  }

  function resetOverride(key: TierKey) {
    setOverrides((prev) => ({ ...prev, [key]: null }));
  }

  const presetScores = PRESET_TIER_SCORES[preset];

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        {expanded ? "Hide" : "Show"} advanced distance overrides
        {anyOverride && !expanded && (
          <span className="ml-1 text-primary">•</span>
        )}
      </button>

      {expanded && (
        <div className="space-y-3 rounded-md border border-border bg-card/40 p-3">
          <p className="text-xs text-muted-foreground">
            Fine-tune the score each tier contributes. Leaving a tier at
            the preset value uses that value automatically. All four tiers
            floor at 0 (soft signal, not a disqualifier).
          </p>
          {TIERS.map(({ key, label, range }) => {
            const override = overrides[key];
            const presetValue = Math.round(presetScores[key] * 100);
            const displayValue = override ?? presetValue;
            const isOverridden = override != null;
            return (
              <div key={key} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <div>
                    <span className="text-sm font-medium">{label}</span>{" "}
                    <span className="text-[10px] text-muted-foreground">
                      {range}
                    </span>
                  </div>
                  <div
                    className={cn(
                      "text-xs tabular-nums",
                      isOverridden ? "font-semibold" : "text-muted-foreground"
                    )}
                  >
                    {displayValue}
                    {!isOverridden && (
                      <span className="ml-1 text-[10px] uppercase text-muted-foreground">
                        preset
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={displayValue}
                    onChange={(e) => updateOverride(key, Number(e.target.value))}
                    className="flex-1 accent-foreground"
                  />
                  {isOverridden && (
                    <button
                      type="button"
                      onClick={() => resetOverride(key)}
                      className="text-[10px] font-medium text-muted-foreground hover:text-foreground"
                    >
                      reset
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/*
        Hidden inputs — empty string when override is null. The server
        action treats "" as null and stores it, meaning "use preset."
      */}
      {TIERS.map(({ key }) => (
        <input
          key={key}
          type="hidden"
          name={`fit_dist_tier_score_${key}`}
          value={overrides[key] == null ? "" : String(overrides[key])}
        />
      ))}
    </div>
  );
}

