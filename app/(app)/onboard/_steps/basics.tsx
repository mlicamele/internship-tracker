import type { Profile } from "@/lib/db/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OnboardStep } from "../_components/onboard-step";
import { saveBasics } from "../actions";

const CURRENT_YEAR = new Date().getFullYear();
const GRAD_YEAR_OPTIONS = Array.from({ length: 9 }, (_, i) => CURRENT_YEAR + i);

export function BasicsStep({
  profile,
  error,
}: {
  profile: Profile;
  error?: string;
}) {
  return (
    <OnboardStep
      step={1}
      total={4}
      title="The basics"
      description="Where you go to school and when you graduate. We use this to filter out roles that won't take you."
    >
      <form action={saveBasics} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="school">School</Label>
          <Input
            id="school"
            name="school"
            placeholder="University of Pennsylvania"
            defaultValue={profile.school ?? ""}
            required
            autoComplete="organization"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="grad_year">Graduation year</Label>
          <select
            id="grad_year"
            name="grad_year"
            defaultValue={profile.grad_year ?? ""}
            required
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
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

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full">
          Continue
        </Button>
      </form>
    </OnboardStep>
  );
}
