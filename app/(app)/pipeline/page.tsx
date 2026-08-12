import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listByTriageState } from "@/lib/db/applications";
import { getProfile } from "@/lib/db/profile";
import { listResumeVersions } from "@/lib/db/resume-versions";
import { sortLocationsByDistance, weightedNearestDistance } from "@/lib/distance";
import { computeFitScore } from "@/lib/scoring/fit";
import { computeCombinedScore } from "@/lib/scoring/combined";
import { buttonVariants } from "@/components/ui/button";
import { Plus } from "@/components/icons";
import { cn } from "@/lib/utils";
import { PipelineTable } from "./_components/data-table";
import type { PipelineRow } from "./_components/columns";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [profile, applications, resumeVersions] = await Promise.all([
    getProfile(supabase, user.id),
    listByTriageState(supabase, user.id, "active"),
    listResumeVersions(supabase, user.id),
  ]);

  const destinations =
    profile?.home_lat != null && profile.home_lng != null
      ? [{ lat: profile.home_lat, lng: profile.home_lng, weight: 1 }]
      : [];

  const home =
    profile?.home_lat != null && profile.home_lng != null
      ? { lat: profile.home_lat, lng: profile.home_lng }
      : null;

  const rows: PipelineRow[] = applications.map((app) => {
    const sortedLocations = sortLocationsByDistance(app.role.locations, home);
    const roleWithSortedLocations = { ...app.role, locations: sortedLocations };
    const fit = profile
      ? computeFitScore(roleWithSortedLocations, profile)
      : null;
    const combined = computeCombinedScore(
      fit?.total ?? null,
      app.resume_fit_score,
      profile
    );
    return {
      ...app,
      role: roleWithSortedLocations,
      distance_miles:
        destinations.length > 0
          ? weightedNearestDistance(sortedLocations, destinations)
          : null,
      fit_details: fit,
      combined_total: combined.total,
      combined_used_resume_signal: combined.usedResumeSignal,
    };
  });

  return (
    <div className="flex h-[calc(100dvh-8rem)] flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Pipeline</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {rows.length} active application{rows.length === 1 ? "" : "s"}
          </p>
        </div>
        <Link
          href="/applications/new"
          className={cn(buttonVariants(), "inline-flex items-center gap-1")}
        >
          <Plus className="size-4" />
          New
        </Link>
      </header>

      <PipelineTable
        rows={rows}
        resumeVersions={resumeVersions}
        interestTags={profile?.interest_tags ?? []}
        emptyState={
          <span>
            No active applications.{" "}
            <Link href="/applications/new" className="underline">
              Add your first one
            </Link>
            .
          </span>
        }
      />
    </div>
  );
}
