import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile, nextOnboardingStep } from "@/lib/db/profile";
import { BasicsStep } from "./_steps/basics";
import { LocationStep } from "./_steps/location";
import { InterestsStep } from "./_steps/interests";
import { FinishStep } from "./_steps/finish";

export default async function OnboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const profile = await getProfile(supabase, user.id);
  if (!profile) {
    // Trigger should have auto-created this on signup. If we're here,
    // something is wrong with the DB.
    throw new Error(
      "Profile row missing for authenticated user. Did the 0001_init migration run?"
    );
  }

  const step = nextOnboardingStep(profile);

  if (step === "done") redirect("/inbox");

  switch (step) {
    case "basics":
      return <BasicsStep profile={profile} error={error} />;
    case "location":
      return <LocationStep profile={profile} error={error} />;
    case "interests":
      return <InterestsStep profile={profile} error={error} />;
    case "finish":
      return <FinishStep profile={profile} error={error} />;
  }
}
