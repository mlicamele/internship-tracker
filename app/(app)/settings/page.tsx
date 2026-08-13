import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/db/profile";
import { listResumeVersions } from "@/lib/db/resume-versions";
import { INTEREST_TAGS } from "@/lib/taxonomy";
import { SettingsForm } from "./_components/settings-form";
import { ResumeSection } from "./_components/resume-section";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    saved?: string;
    // All resume actions now handled inline via useActionState in their
    // respective client components — no more URL-param signalling.
  }>;
}) {
  const { error, saved } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const profile = await getProfile(supabase, user.id);
  if (!profile) throw new Error("Profile missing");

  const resumeVersions = await listResumeVersions(supabase, user.id);

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Edit your profile. Updating these recomputes fit scores on your applications.
        </p>
      </header>

      {saved === "1" && (
        <div className="rounded-md border border-border bg-card p-3 text-sm">
          Saved.
        </div>
      )}

      <SettingsForm
        profile={profile}
        availableTags={[...INTEREST_TAGS]}
        error={error}
      />

      <div className="pt-2">
        <ResumeSection versions={resumeVersions} />
      </div>
    </div>
  );
}
