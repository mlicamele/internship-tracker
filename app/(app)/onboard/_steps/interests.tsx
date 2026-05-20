"use client";

import { useState } from "react";
import { INTEREST_TAGS } from "@/lib/taxonomy";
import type { Profile } from "@/lib/db/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { OnboardStep } from "../_components/onboard-step";
import { saveInterests } from "../actions";

export function InterestsStep({
  profile,
  error,
}: {
  profile: Profile;
  error?: string;
}) {
  const [selected, setSelected] = useState<string[]>(
    profile.interest_tags ?? []
  );

  function toggle(tag: string) {
    setSelected((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  return (
    <OnboardStep
      step={3}
      total={4}
      title="What kinds of roles?"
      description="Pick any that genuinely interest you. We use these to score role fit. Editable later."
    >
      <form action={saveInterests} className="space-y-6">
        <div className="flex flex-wrap gap-2">
          {INTEREST_TAGS.map((tag) => {
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

        {/* Hidden inputs feed selected tags to the server action */}
        {selected.map((tag) => (
          <input key={tag} type="hidden" name="interest_tags" value={tag} />
        ))}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <Button
          type="submit"
          className="w-full"
          disabled={selected.length === 0}
        >
          Continue {selected.length > 0 && `(${selected.length} selected)`}
        </Button>
      </form>
    </OnboardStep>
  );
}
