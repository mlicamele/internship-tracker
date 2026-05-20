import type { Profile } from "@/lib/db/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OnboardStep } from "../_components/onboard-step";
import { saveLocation } from "../actions";

const SELECT_CLS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

export function LocationStep({
  profile,
  error,
}: {
  profile: Profile;
  error?: string;
}) {
  return (
    <OnboardStep
      step={2}
      total={4}
      title="Where you're based"
      description="We'll sort roles by distance from this address. Roughly fine — city + state works."
    >
      <form action={saveLocation} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="home_address">Home address</Label>
          <Input
            id="home_address"
            name="home_address"
            placeholder="Potomac, MD"
            defaultValue={profile.home_address ?? ""}
            required
            autoComplete="address-level2"
          />
          <p className="text-xs text-muted-foreground">
            Geocoded via OpenStreetMap. Just a city + state is enough.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="local_radius_miles">
            What counts as &ldquo;local&rdquo; (miles)?
          </Label>
          <Input
            id="local_radius_miles"
            name="local_radius_miles"
            type="number"
            min={5}
            max={500}
            step={5}
            defaultValue={profile.local_radius_miles ?? 30}
            required
          />
          <p className="text-xs text-muted-foreground">
            Roles within this radius get top fit-score for geography.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="relocation_tolerance">Outside that radius?</Label>
          <select
            id="relocation_tolerance"
            name="relocation_tolerance"
            defaultValue={profile.relocation_tolerance ?? "regional"}
            required
            className={SELECT_CLS}
          >
            <option value="nope">I won&apos;t relocate</option>
            <option value="regional">Same region is OK</option>
            <option value="anywhere">Anywhere is fine</option>
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
