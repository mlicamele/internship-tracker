"use client";

import { useMemo, useState } from "react";
import { FIT_WEIGHT_PRESETS } from "@/lib/scoring/fit";
import { cn } from "@/lib/utils";

const PRESET_ORDER = [
  { key: "balanced", label: "Balanced" },
  { key: "location", label: "Location-focused" },
  { key: "eligibility", label: "Eligibility-strict" },
] as const;

/**
 * Three sliders (0-100) + preset chips for tuning the fit-score weights.
 * Ratios normalize server-side in `computeFitScore`, so slider values here
 * are raw 0-100 — an "effective %" preview underneath shows the normalized
 * ratio the score will actually use.
 *
 * Emits three hidden inputs so the parent server-action form picks them up.
 */
export function FitWeightsControls({
  initialClassYear,
  initialDistance,
  initialInterest,
}: {
  initialClassYear: number;
  initialDistance: number;
  initialInterest: number;
}) {
  const [classYear, setClassYear] = useState(initialClassYear);
  const [distance, setDistance] = useState(initialDistance);
  const [interest, setInterest] = useState(initialInterest);

  const sum = classYear + distance + interest;
  const pct = useMemo(
    () => ({
      classYear: sum > 0 ? Math.round((classYear / sum) * 100) : 0,
      distance: sum > 0 ? Math.round((distance / sum) * 100) : 0,
      interest: sum > 0 ? Math.round((interest / sum) * 100) : 0,
    }),
    [classYear, distance, interest, sum]
  );

  const activePreset =
    PRESET_ORDER.find(({ key }) => {
      const p = FIT_WEIGHT_PRESETS[key];
      return (
        p.classYear === classYear &&
        p.distance === distance &&
        p.interest === interest
      );
    })?.key ?? null;

  function applyPreset(key: keyof typeof FIT_WEIGHT_PRESETS) {
    const p = FIT_WEIGHT_PRESETS[key];
    setClassYear(p.classYear);
    setDistance(p.distance);
    setInterest(p.interest);
  }

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
        value={classYear}
        onChange={setClassYear}
        effectivePct={pct.classYear}
      />
      <Slider
        label="Distance"
        description="How much commute distance to your home matters."
        value={distance}
        onChange={setDistance}
        effectivePct={pct.distance}
      />
      <Slider
        label="Interest overlap"
        description="How much your interest-tag overlap with the role matters."
        value={interest}
        onChange={setInterest}
        effectivePct={pct.interest}
      />

      {sum === 0 && (
        <p className="text-xs text-destructive">
          At least one slider must be greater than 0.
        </p>
      )}

      {/* Hidden inputs for the surrounding server-action form. */}
      <input type="hidden" name="fit_weight_class_year" value={classYear} />
      <input type="hidden" name="fit_weight_distance" value={distance} />
      <input type="hidden" name="fit_weight_interest" value={interest} />
    </div>
  );
}

function Slider({
  label,
  description,
  value,
  onChange,
  effectivePct,
}: {
  label: string;
  description: string;
  value: number;
  onChange: (v: number) => void;
  effectivePct: number;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{label}</div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
        <div className="text-right">
          <div className="text-sm tabular-nums">{value}</div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {effectivePct}%
          </div>
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
