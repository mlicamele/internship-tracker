"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { updateProfile, type ProfileUpdate } from "@/lib/db/profile";
import { recomputeFitScoresForUser } from "@/lib/db/applications";
import { geocode } from "@/lib/geocode";
import { isInterestTag } from "@/lib/taxonomy";
import type { RelocationTolerance } from "@/lib/db/types";

const RELOCATION_VALUES: ReadonlySet<RelocationTolerance> = new Set([
  "nope",
  "regional",
  "anywhere",
]);

/** Return type from saveSettings — used by useActionState on the client. */
export type SaveSettingsResult = { ok: true } | { ok: false; error: string };

/**
 * Throws a "return" — a sentinel we catch to fold validation failures
 * back into a { ok: false, error } result at the outer boundary. Using
 * throw lets the deeply-nested parseWeight / parseTierOverride helpers
 * bail out with a single message without every helper needing to return
 * a Result type.
 */
class SaveValidationError extends Error {}
function fail(message: string): never {
  throw new SaveValidationError(message);
}

export async function saveSettings(
  _prevState: SaveSettingsResult,
  formData: FormData
): Promise<SaveSettingsResult> {
  try {
    return await saveSettingsInner(formData);
  } catch (err) {
    if (err instanceof SaveValidationError) {
      return { ok: false, error: err.message };
    }
    // Unexpected — re-throw so Next.js's error boundary handles it.
    throw err;
  }
}

async function saveSettingsInner(formData: FormData): Promise<SaveSettingsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Basics
  const school = formData.get("school");
  const gradYear = Number(formData.get("grad_year"));
  if (typeof school !== "string" || !school.trim()) fail("School is required");
  if (!Number.isInteger(gradYear) || gradYear < 2024 || gradYear > 2032) {
    fail("Pick a graduation year between 2024 and 2032");
  }

  // Location
  const address = formData.get("home_address");
  const radius = Number(formData.get("local_radius_miles"));
  const tolerance = formData.get("relocation_tolerance");
  if (typeof address !== "string" || !address.trim()) fail("Home address required");
  if (!Number.isFinite(radius) || radius < 5 || radius > 150) {
    fail("Commutable radius must be between 5 and 150 miles");
  }
  if (
    typeof tolerance !== "string" ||
    !RELOCATION_VALUES.has(tolerance as RelocationTolerance)
  ) {
    fail("Pick a relocation tolerance");
  }

  // Interests
  const tagsRaw = formData.getAll("interest_tags");
  const tags = tagsRaw.filter(
    (v): v is string => typeof v === "string" && isInterestTag(v)
  );
  if (tags.length === 0) fail("Pick at least one interest");

  // Fit weights (raw 0-100 slider values; normalized at score time)
  function parseWeight(key: string, name: string): number {
    const raw = Number(formData.get(key));
    if (!Number.isInteger(raw) || raw < 0 || raw > 100) {
      fail(`${name} weight must be between 0 and 100`);
    }
    return raw;
  }
  const weightClassYear = parseWeight("fit_weight_class_year", "Class-year");
  const weightDistance = parseWeight("fit_weight_distance", "Distance");
  const weightInterest = parseWeight("fit_weight_interest", "Interest");
  if (weightClassYear + weightDistance + weightInterest === 0) {
    fail("At least one fit-score slider must be greater than zero");
  }

  // Per-tier distance overrides — empty string means "use preset", any
  // 0..100 integer means "override the preset with this value / 100".
  // Stored as numeric(3,2) in DB; null = fall through to preset.
  function parseTierOverride(key: string, name: string): number | null {
    const raw = formData.get(key);
    if (raw === null || raw === "" || raw === undefined) return null;
    const num = Number(raw);
    if (!Number.isFinite(num) || num < 0 || num > 100) {
      fail(`${name} tier override must be between 0 and 100`);
    }
    return Math.round(num) / 100;
  }
  const distCommutable = parseTierOverride(
    "fit_dist_tier_score_commutable",
    "Commutable"
  );
  const distRegional = parseTierOverride(
    "fit_dist_tier_score_regional",
    "Regional"
  );
  const distDomestic = parseTierOverride(
    "fit_dist_tier_score_domestic",
    "Domestic"
  );
  const distDistant = parseTierOverride(
    "fit_dist_tier_score_distant",
    "Distant"
  );

  // Combined-score sliders (0..100 each). Same parseWeight validator; sum
  // must be > 0 so normalization doesn't divide by zero.
  const combinedWeightFit = parseWeight("combined_weight_fit", "Combined personal-fit");
  const combinedWeightResume = parseWeight("combined_weight_resume", "Combined resume-fit");
  if (combinedWeightFit + combinedWeightResume === 0) {
    fail("At least one combined-score slider must be greater than zero");
  }

  // Re-geocode only if address actually changed (cheaper)
  const patch: ProfileUpdate = {
    school: school.trim(),
    grad_year: gradYear,
    local_radius_miles: radius,
    relocation_tolerance: tolerance as RelocationTolerance,
    interest_tags: tags,
    fit_weight_class_year: weightClassYear,
    fit_weight_distance: weightDistance,
    fit_weight_interest: weightInterest,
    fit_dist_tier_score_commutable: distCommutable,
    fit_dist_tier_score_regional: distRegional,
    fit_dist_tier_score_domestic: distDomestic,
    fit_dist_tier_score_distant: distDistant,
    combined_weight_fit: combinedWeightFit,
    combined_weight_resume: combinedWeightResume,
  };

  // Fetch current profile to compare address — no API call if unchanged
  const { data: current } = await supabase
    .from("profiles")
    .select("home_address")
    .eq("user_id", user.id)
    .single();

  const trimmedAddress = address.trim();
  if (current?.home_address !== trimmedAddress) {
    const coords = await geocode(trimmedAddress);
    if (!coords) fail("Could not find that address");
    patch.home_address = trimmedAddress;
    patch.home_lat = coords.lat;
    patch.home_lng = coords.lng;
  } else {
    patch.home_address = trimmedAddress;
  }

  await updateProfile(supabase, user.id, patch);

  // Any of grad_year / home coords / radius / tolerance / interest_tags
  // feeds into computeFitScore, so rescore every scored application in
  // one batch. Failures shouldn't block a settings save — swallow + log.
  try {
    await recomputeFitScoresForUser(supabase, user.id);
  } catch (err) {
    console.error("recomputeFitScoresForUser failed:", err);
  }

  // SettingsForm's inputs are now controlled (state-driven `value`, not
  // uncontrolled `defaultValue`), so revalidating /settings is safe —
  // fresh `profile` prop doesn't re-initialize any input or trip base-ui's
  // "changing default value on uncontrolled FieldControl" warning.
  revalidatePath("/settings");
  revalidatePath("/inbox");
  revalidatePath("/pipeline");
  revalidatePath("/archive");
  return { ok: true };
}
