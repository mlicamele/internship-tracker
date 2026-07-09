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

function fail(message: string): never {
  redirect(`/settings?error=${encodeURIComponent(message)}`);
}

export async function saveSettings(formData: FormData) {
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
  if (!Number.isFinite(radius) || radius < 5 || radius > 500) {
    fail("Radius must be between 5 and 500");
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

  revalidatePath("/settings");
  revalidatePath("/inbox");
  revalidatePath("/pipeline");
  redirect("/settings?saved=1");
}
