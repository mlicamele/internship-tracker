"use client";

import { useActionState, useEffect, useState } from "react";
import type { Profile } from "@/lib/db/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { saveSettings, type SaveSettingsResult } from "../actions";
import { FitWeightsControls } from "./fit-weights";
import { DistanceTierOverrides } from "./distance-tier-overrides";
import { CombinedWeightsControls } from "./combined-weights";

const CURRENT_YEAR = new Date().getFullYear();
const GRAD_YEAR_OPTIONS = Array.from({ length: 9 }, (_, i) => CURRENT_YEAR + i);
const SELECT_CLS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const INITIAL_STATE: SaveSettingsResult = { ok: true };

export function SettingsForm({
  profile,
  availableTags,
}: {
  profile: Profile;
  availableTags: string[];
  /** @deprecated no longer used — form now tracks its own state via useActionState. */
  error?: string;
}) {
  const [selected, setSelected] = useState<string[]>(profile.interest_tags ?? []);
  const [state, formAction, pending] = useActionState(
    saveSettings,
    INITIAL_STATE
  );
  // Dirty = anything on the form has changed since the last successful save.
  // Save button is disabled when clean, so we get "Saved ✓" instead of a
  // stale second save.
  const [dirty, setDirty] = useState(false);

  // Track a brief post-save "Saved ✓" affordance separate from `dirty` so
  // the button flashes the confirmation for ~1.5s even if the user hasn't
  // touched anything yet.
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    if (state.ok && !pending) {
      setJustSaved(true);
      setDirty(false);
      const t = setTimeout(() => setJustSaved(false), 1500);
      return () => clearTimeout(t);
    }
  }, [state, pending]);

  function toggle(tag: string) {
    setSelected((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
    setDirty(true);
  }

  return (
    <form
      action={formAction}
      onChange={() => setDirty(true)}
      className="space-y-6"
    >
      {/* Basics */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold">Basics</h2>
        <div className="space-y-2">
          <Label htmlFor="school">School</Label>
          <Input
            id="school"
            name="school"
            defaultValue={profile.school ?? ""}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="grad_year">Graduation year</Label>
          <select
            id="grad_year"
            name="grad_year"
            defaultValue={profile.grad_year ?? ""}
            required
            className={SELECT_CLS}
          >
            <option value="" disabled>
              Pick a year
            </option>
            {GRAD_YEAR_OPTIONS.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Location */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold">Location</h2>
        <div className="space-y-2">
          <Label htmlFor="home_address">Home address</Label>
          <Input
            id="home_address"
            name="home_address"
            defaultValue={profile.home_address ?? ""}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="local_radius_miles">
            Commutable radius (miles)
          </Label>
          <Input
            id="local_radius_miles"
            name="local_radius_miles"
            type="number"
            min={5}
            max={150}
            step={5}
            defaultValue={profile.local_radius_miles}
            required
          />
          <p className="text-xs text-muted-foreground">
            Roles within this distance count as &ldquo;Commutable&rdquo; (top tier)
            in the distance score. 5&ndash;150 mi.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="relocation_tolerance">Outside that radius</Label>
          <select
            id="relocation_tolerance"
            name="relocation_tolerance"
            defaultValue={profile.relocation_tolerance}
            required
            className={SELECT_CLS}
          >
            <option value="nope">I won&apos;t relocate</option>
            <option value="regional">Same region is OK</option>
            <option value="anywhere">Anywhere is fine</option>
          </select>
          <DistanceTierOverrides
            initialCommutable={profile.fit_dist_tier_score_commutable}
            initialRegional={profile.fit_dist_tier_score_regional}
            initialDomestic={profile.fit_dist_tier_score_domestic}
            initialDistant={profile.fit_dist_tier_score_distant}
            initialPreset={profile.relocation_tolerance}
          />
        </div>
      </section>

      {/* Interests */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold">Interests</h2>
        <div className="flex flex-wrap gap-2">
          {availableTags.map((tag) => {
            const isSelected = selected.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggle(tag)}
                aria-pressed={isSelected}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm transition-colors",
                  isSelected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-background text-foreground hover:bg-accent"
                )}
              >
                {tag}
              </button>
            );
          })}
        </div>
        {selected.map((tag) => (
          <input key={tag} type="hidden" name="interest_tags" value={tag} />
        ))}
      </section>

      {/* Fit weights */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Fit score weights</h2>
          <p className="text-xs text-muted-foreground">
            Tune how the fit score is calculated. Pick a preset or set custom
            values — sliders auto-normalize into a ratio at score time.
          </p>
        </div>
        <FitWeightsControls
          initialClassYear={profile.fit_weight_class_year}
          initialDistance={profile.fit_weight_distance}
          initialInterest={profile.fit_weight_interest}
        />
      </section>

      {/* Combined score weights */}
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Combined score</h2>
          <p className="text-xs text-muted-foreground">
            The combined column mixes personal fit and resume fit. Sliders
            auto-normalize into a ratio at display time. Defaults to 50/50.
          </p>
        </div>
        <CombinedWeightsControls
          initialFit={profile.combined_weight_fit}
          initialResume={profile.combined_weight_resume}
        />
      </section>

      {!state.ok && "error" in state && (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}

      <Button
        type="submit"
        disabled={pending || (!dirty && !justSaved)}
        aria-live="polite"
        className={cn(
          "w-full transition-colors",
          justSaved && "bg-emerald-600 text-white hover:bg-emerald-600"
        )}
      >
        {pending ? (
          <SavingDots />
        ) : justSaved ? (
          <span className="inline-flex items-center gap-1.5">
            <CheckIcon /> Saved
          </span>
        ) : (
          "Save"
        )}
      </Button>
    </form>
  );
}

/** Three-dot loading indicator; the small staggered animation reads as "working." */
function SavingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-label="Saving">
      <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-current" />
    </span>
  );
}

function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
      aria-hidden
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
