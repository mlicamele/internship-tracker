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
 * Three independent sliders (1-100 each) for tuning the fit-score weights.
 * Raw slider values are stored as-is; fit scoring normalizes them at compute
 * time (see `weightsFromProfile` in lib/scoring/fit.ts). The readout beside
 * each slider shows the current normalized share (rounded %), not the raw
 * value — so a user who slams all three to 100 sees "33%" on each.
 *
 * Emits three hidden inputs so the parent server-action form picks them up.
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
    loadInitialWeights({
      classYear: initialClassYear,
      distance: initialDistance,
      interest: initialInterest,
    })
  );

  function updateWeight(key: WeightKey, newValue: number) {
    const clamped = Math.max(1, Math.min(100, Math.round(newValue)));
    setWeights((current) => ({ ...current, [key]: clamped }));
  }

  const totalSum = weights.classYear + weights.distance + weights.interest;
  const share = (v: number) =>
    totalSum === 0 ? 0 : Math.round((v / totalSum) * 100);

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
        sharePct={share(weights.classYear)}
        onChange={(v) => updateWeight("classYear", v)}
      />
      <Slider
        label="Distance"
        description="How much commute distance to your home matters."
        value={weights.distance}
        sharePct={share(weights.distance)}
        onChange={(v) => updateWeight("distance", v)}
      />
      <Slider
        label="Interest overlap"
        description="How much your interest-tag overlap with the role matters."
        value={weights.interest}
        sharePct={share(weights.interest)}
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
 * Load raw slider values from the profile. Missing / non-numeric / out-of-range
 * fields (e.g. profile row without migration 0014 applied) fall back to
 * Balanced defaults (50/30/20). No normalization — sliders are independent now.
 */
function loadInitialWeights(raw: {
  classYear: number | null | undefined;
  distance: number | null | undefined;
  interest: number | null | undefined;
}): Weights {
  const clean = (v: number | null | undefined, fallback: number): number => {
    if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
    return Math.max(1, Math.min(100, Math.round(v)));
  };
  return {
    classYear: clean(raw.classYear, BALANCED_DEFAULT.classYear),
    distance: clean(raw.distance, BALANCED_DEFAULT.distance),
    interest: clean(raw.interest, BALANCED_DEFAULT.interest),
  };
}

function Slider({
  label,
  description,
  value,
  sharePct,
  onChange,
}: {
  label: string;
  description: string;
  value: number;
  sharePct: number;
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
          {sharePct}%
        </div>
      </div>
      <input
        type="range"
        min={1}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-foreground"
      />
    </div>
  );
}
