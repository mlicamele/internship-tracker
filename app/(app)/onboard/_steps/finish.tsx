import type { Profile } from "@/lib/db/types";
import { Button } from "@/components/ui/button";
import { OnboardStep } from "../_components/onboard-step";
import { finishOnboarding } from "../actions";

export function FinishStep({
  profile,
  error,
}: {
  profile: Profile;
  error?: string;
}) {
  return (
    <OnboardStep
      step={4}
      total={4}
      title="You're set"
      description="Master resume comes later — you can upload it from settings or attach per-application. Ready to triage?"
    >
      <div className="rounded-md border border-border bg-card p-4 text-sm space-y-2">
        <Summary label="School" value={profile.school ?? "—"} />
        <Summary label="Graduation" value={String(profile.grad_year ?? "—")} />
        <Summary label="Home" value={profile.home_address ?? "—"} />
        <Summary
          label="Local radius"
          value={`${profile.local_radius_miles} mi`}
        />
        <Summary
          label="Relocation"
          value={
            profile.relocation_tolerance === "nope"
              ? "Won't relocate"
              : profile.relocation_tolerance === "regional"
                ? "Same region OK"
                : "Anywhere"
          }
        />
        <Summary
          label="Interests"
          value={profile.interest_tags.join(", ") || "—"}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Edit any of this from Settings later.
      </p>

      <form action={finishOnboarding}>
        {error && (
          <p className="text-sm text-destructive mb-3" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full">
          Get started
        </Button>
      </form>
    </OnboardStep>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
