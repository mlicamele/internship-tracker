"use client";

import { useState } from "react";
import { FIT_WEIGHT_PRESETS } from "@/lib/scoring/fit";
import { cn } from "@/lib/utils";

const PRESET_ORDER = [
  { key: "balanced", label: "Balanced" },
  { key: "location", label: "Location-focused" },
  { key: "eligibility", label: "Eligibility-strict" },
] as const;

type WeightKey = "classYear" | "distance" | "interest";
type Weights = Record<WeightKey, number>;

/**
 * Three linked sliders for tuning the fit-score weights. The sliders always
 * sum to 100 — dragging one redistributes the remaining budget across the
 * other two in proportion to their current values. Because slider positions
 * are themselves percentages, no separate "effective %" label is needed.
 *
 * Presets are pre-normalized to sum-100 (see FIT_WEIGHT_PRESETS). Emits three
 * hidden inputs so the parent server-action form picks them up.
 */
const BALANCED_DEFAULT: Weights = { classYear: 50, distance: 30, interest: 20 };

export function FitWeightsControls({
  initialClassYear,
  initialDistance,
  initialInterest,
}: {
  initialClassYear: number | null | undefined;
  initialDistance: number | null | undefined;
  initialInterest: number | null | undefined;
}) {
  const [weights, setWeights] = useState<Weights>(() =>
    normalizeToHundred({
      classYear: initialClassYear,
      distance: initialDistance,
      interest: initialInterest,
    })
  );

  function updateWeight(key: WeightKey, newValue: number) {
    setWeights((current) => redistribute(current, key, newValue));
  }

  function applyPreset(key: keyof typeof FIT_WEIGHT_PRESETS) {
    const p = FIT_WEIGHT_PRESETS[key];
    setWeights({
      classYear: p.classYear,
      distance: p.distance,
      interest: p.interest,
    });
  }

  const activePreset =
    PRESET_ORDER.find(({ key }) => {
      const p = FIT_WEIGHT_PRESETS[key];
      return (
        p.classYear === weights.classYear &&
        p.distance === weights.distance &&
        p.interest === weights.interest
      );
    })?.key ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          Preset:
        </span>
        {PRESET_ORDER.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => applyPreset(key)}
            aria-pressed={activePreset === key}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition-colors",
              activePreset === key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-background text-foreground hover:bg-accent"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <Slider
        label="Class-year eligibility"
        description="How much a role's grad-year window matters."
        value={weights.classYear}
        onChange={(v) => updateWeight("classYear", v)}
      />
      <Slider
        label="Distance"
        description="How much commute distance to your home matters."
        value={weights.distance}
        onChange={(v) => updateWeight("distance", v)}
      />
      <Slider
        label="Interest overlap"
        description="How much your interest-tag overlap with the role matters."
        value={weights.interest}
        onChange={(v) => updateWeight("interest", v)}
      />

      {/* Hidden inputs for the surrounding server-action form. */}
      <input type="hidden" name="fit_weight_class_year" value={weights.classYear} />
      <input type="hidden" name="fit_weight_distance" value={weights.distance} />
      <input type="hidden" name="fit_weight_interest" value={weights.interest} />
    </div>
  );
}

/**
 * When the user drags `key` to `newValue` (clamped to 0..100), redistribute
 * the remaining 100 - newValue budget across the other two components
 * proportionally to their prior values. Rounding is settled on the LAST
 * assigned slider so the tuple always sums to exactly 100.
 */
function redistribute(
  current: Weights,
  key: WeightKey,
  newValue: number
): Weights {
  const clamped = Math.max(0, Math.min(100, Math.round(newValue)));
  const otherKeys = (Object.keys(current) as WeightKey[]).filter(
    (k) => k !== key
  );
  const otherSum = otherKeys.reduce((s, k) => s + current[k], 0);
  const remaining = 100 - clamped;

  const next: Weights = { ...current, [key]: clamped };
  if (otherSum === 0) {
    // Split evenly if the others were both zero — otherwise proportional
    // math divides by zero.
    const half = Math.floor(remaining / 2);
    next[otherKeys[0]] = half;
    next[otherKeys[1]] = remaining - half;
  } else {
    // First key gets the proportional share, rounded. Second absorbs the
    // rounding remainder so the sum stays exactly 100.
    const first = Math.round((current[otherKeys[0]] / otherSum) * remaining);
    next[otherKeys[0]] = first;
    next[otherKeys[1]] = remaining - first;
  }
  return next;
}

/**
 * On first mount, coerce whatever the profile stored into a sum-100 tuple.
 * Missing / non-numeric fields (e.g. profile row without migration 0014
 * applied) OR all-zero rows fall back to Balanced (50/30/20). Everything
 * else is proportionally scaled to sum 100.
 */
function normalizeToHundred(raw: {
  classYear: number | null | undefined;
  distance: number | null | undefined;
  interest: number | null | undefined;
}): Weights {
  const isFinitePositive = (v: number | null | undefined): v is number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (
    !isFinitePositive(raw.classYear) ||
    !isFinitePositive(raw.distance) ||
    !isFinitePositive(raw.interest)
  ) {
    return { ...BALANCED_DEFAULT };
  }
  const sum = raw.classYear + raw.distance + raw.interest;
  if (sum === 0) return { ...BALANCED_DEFAULT };
  if (sum === 100)
    return {
      classYear: raw.classYear,
      distance: raw.distance,
      interest: raw.interest,
    };
  const cy = Math.round((raw.classYear / sum) * 100);
  const d = Math.round((raw.distance / sum) * 100);
  const i = 100 - cy - d; // absorbs rounding remainder
  return { classYear: cy, distance: d, interest: i };
}

function Slider({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{label}</div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
        <div className="text-right text-sm font-medium tabular-nums">
          {value}%
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-foreground"
      />
    </div>
  );
}
