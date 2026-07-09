import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listByTriageState } from "@/lib/db/applications";
import { getProfile } from "@/lib/db/profile";
import { listResumeVersions } from "@/lib/db/resume-versions";
import { weightedNearestDistance } from "@/lib/distance";
import { computeFitScore } from "@/lib/scoring/fit";
import { computeCombinedScore } from "@/lib/scoring/combined";
import { PipelineTable } from "../pipeline/_components/data-table";
import type { PipelineRow } from "../pipeline/_components/columns";

export const dynamic = "force-dynamic";

export default async function ArchivePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [profile, applications, resumeVersions] = await Promise.all([
    getProfile(supabase, user.id),
    listByTriageState(supabase, user.id, ["snoozed", "skipped"]),
    listResumeVersions(supabase, user.id),
  ]);

  const destinations =
    profile?.home_lat != null && profile.home_lng != null
      ? [{ lat: profile.home_lat, lng: profile.home_lng, weight: 1 }]
      : [];

  const rows: PipelineRow[] = applications.map((app) => {
    const fit = profile ? computeFitScore(app.role, profile) : null;
    const combined = computeCombinedScore(
      fit?.total ?? null,
      app.resume_fit_score,
      profile
    );
    return {
      ...app,
      distance_miles:
        destinations.length > 0
          ? weightedNearestDistance(app.role.locations, destinations)
          : null,
      fit_details: fit,
      combined_total: combined.total,
      combined_used_resume_signal: combined.usedResumeSignal,
    };
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Archive</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Snoozed and skipped roles. {rows.length} total.
        </p>
      </header>

      <PipelineTable
        rows={rows}
        resumeVersions={resumeVersions}
        interestTags={profile?.interest_tags ?? []}
        emptyState={<span>No snoozed or skipped roles.</span>}
      />
    </div>
  );
}
