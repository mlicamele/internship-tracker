"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  completeOnboarding,
  updateProfile,
  type ProfileUpdate,
} from "@/lib/db/profile";
import { geocode } from "@/lib/geocode";
import { isInterestTag } from "@/lib/taxonomy";
import type { RelocationTolerance } from "@/lib/db/types";

async function requireUserId(): Promise<{
  userId: string;
  supabase: Awaited<ReturnType<typeof createClient>>;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { userId: user.id, supabase };
}

function fail(message: string): never {
  redirect(`/onboard?error=${encodeURIComponent(message)}`);
}

// ---------- Step 1: basics ----------
export async function saveBasics(formData: FormData) {
  const school = formData.get("school");
  const gradYearRaw = formData.get("grad_year");

  if (typeof school !== "string" || !school.trim()) {
    fail("School is required");
  }
  const gradYear = Number(gradYearRaw);
  if (!Number.isInteger(gradYear) || gradYear < 2024 || gradYear > 2032) {
    fail("Pick a graduation year between 2024 and 2032");
  }

  const { supabase, userId } = await requireUserId();
  await updateProfile(supabase, userId, {
    school: school.trim(),
    grad_year: gradYear,
  });

  revalidatePath("/onboard");
  redirect("/onboard");
}

// ---------- Step 2: location ----------
const RELOCATION_VALUES: ReadonlySet<RelocationTolerance> = new Set([
  "nope",
  "regional",
  "anywhere",
]);

export async function saveLocation(formData: FormData) {
  const address = formData.get("home_address");
  const radiusRaw = formData.get("local_radius_miles");
  const tolerance = formData.get("relocation_tolerance");

  if (typeof address !== "string" || !address.trim()) {
    fail("Home address is required");
  }
  const radius = Number(radiusRaw);
  if (!Number.isFinite(radius) || radius < 5 || radius > 500) {
    fail("Local radius must be between 5 and 500 miles");
  }
  if (
    typeof tolerance !== "string" ||
    !RELOCATION_VALUES.has(tolerance as RelocationTolerance)
  ) {
    fail("Pick a relocation tolerance");
  }

  // Geocode (~1-2s)
  const coords = await geocode(address.trim());
  if (!coords) {
    fail("Could not find that address — try adding a city and state");
  }

  const { supabase, userId } = await requireUserId();
  const patch: ProfileUpdate = {
    home_address: address.trim(),
    home_lat: coords.lat,
    home_lng: coords.lng,
    local_radius_miles: radius,
    relocation_tolerance: tolerance as RelocationTolerance,
  };
  await updateProfile(supabase, userId, patch);

  revalidatePath("/onboard");
  redirect("/onboard");
}

// ---------- Step 3: interests ----------
export async function saveInterests(formData: FormData) {
  const raw = formData.getAll("interest_tags");
  const tags = raw.filter((v): v is string => typeof v === "string" && isInterestTag(v));

  if (tags.length === 0) {
    fail("Pick at least one interest");
  }

  const { supabase, userId } = await requireUserId();
  await updateProfile(supabase, userId, { interest_tags: tags });

  revalidatePath("/onboard");
  redirect("/onboard");
}

// ---------- Step 4: finish ----------
export async function finishOnboarding() {
  const { supabase, userId } = await requireUserId();
  await completeOnboarding(supabase, userId);
  revalidatePath("/inbox");
  redirect("/inbox");
}
