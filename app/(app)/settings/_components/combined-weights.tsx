"use client";

import { useState } from "react";
import { DEFAULT_COMBINED_WEIGHTS } from "@/lib/scoring/combined";

/**
 * Two independent 0-100 sliders that weight the combined score:
 *   combined = w_fit × fit + w_resume × resume_fit
 * Raw values are stored as-is; combined scoring normalizes them at read time
 * (see lib/scoring/combined.ts). The readout shows the current normalized
 * share (rounded %). Mirrors the FitWeightsControls pattern.
 */

type WeightKey = "fit" | "resume";
type Weights = Record<WeightKey, number>;

export function CombinedWeightsControls({
  initialFit,
  initialResume,
}: {
  initialFit: number | null | undefined;
  initialResume: number | null | undefined;
}) {
  const [weights, setWeights] = useState<Weights>(() =>
    loadInitialWeights({ fit: initialFit, resume: initialResume })
  );

  function updateWeight(key: WeightKey, newValue: number) {
    const clamped = Math.max(1, Math.min(100, Math.round(newValue)));
    setWeights((current) => ({ ...current, [key]: clamped }));
  }

  const total = weights.fit + weights.resume;
  const share = (v: number) => (total === 0 ? 0 : Math.round((v / total) * 100));

  return (
    <div className="space-y-4">
      <Slider
        label="Personal fit"
        description="How much the fit score (want) contributes."
        value={weights.fit}
        sharePct={share(weights.fit)}
        onChange={(v) => updateWeight("fit", v)}
      />
      <Slider
        label="Resume fit"
        description="How much the resume-fit score (match) contributes."
        value={weights.resume}
        sharePct={share(weights.resume)}
        onChange={(v) => updateWeight("resume", v)}
      />

      <input type="hidden" name="combined_weight_fit" value={weights.fit} />
      <input type="hidden" name="combined_weight_resume" value={weights.resume} />
    </div>
  );
}

function loadInitialWeights(raw: {
  fit: number | null | undefined;
  resume: number | null | undefined;
}): Weights {
  const clean = (v: number | null | undefined, fallback: number): number => {
    if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
    return Math.max(1, Math.min(100, Math.round(v)));
  };
  return {
    fit: clean(raw.fit, DEFAULT_COMBINED_WEIGHTS.fit),
    resume: clean(raw.resume, DEFAULT_COMBINED_WEIGHTS.resume),
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
