"use client";

import { useState } from "react";
import type { Profile } from "@/lib/db/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { saveSettings } from "../actions";

const CURRENT_YEAR = new Date().getFullYear();
const GRAD_YEAR_OPTIONS = Array.from({ length: 9 }, (_, i) => CURRENT_YEAR + i);
const SELECT_CLS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

export function SettingsForm({
  profile,
  availableTags,
  error,
}: {
  profile: Profile;
  availableTags: string[];
  error?: string;
}) {
  const [selected, setSelected] = useState<string[]>(profile.interest_tags ?? []);

  function toggle(tag: string) {
    setSelected((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  return (
    <form action={saveSettings} className="space-y-6">
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
          <Label htmlFor="local_radius_miles">Local radius (miles)</Label>
          <Input
            id="local_radius_miles"
            name="local_radius_miles"
            type="number"
            min={5}
            max={500}
            step={5}
            defaultValue={profile.local_radius_miles}
            required
          />
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

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" className="w-full">
        Save
      </Button>
    </form>
  );
}
