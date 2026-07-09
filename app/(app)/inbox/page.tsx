import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listByTriageState } from "@/lib/db/applications";
import { getProfile } from "@/lib/db/profile";
import { listResumeVersions } from "@/lib/db/resume-versions";
import { weightedNearestDistance } from "@/lib/distance";
import { computeFitScore } from "@/lib/scoring/fit";
import { computeCombinedScore } from "@/lib/scoring/combined";
import { buttonVariants } from "@/components/ui/button";
import { Plus } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { PipelineRow } from "../pipeline/_components/columns";
import { InboxViewSwitcher } from "./_components/inbox-view-switcher";
import { TriageResumePicker } from "./_components/triage-resume-picker";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ resume?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { resume: resumeParam } = await searchParams;

  const [profile, applications, resumeVersions] = await Promise.all([
    getProfile(supabase, user.id),
    listByTriageState(supabase, user.id, "inbox"),
    listResumeVersions(supabase, user.id),
  ]);

  const master = resumeVersions.find((r) => r.is_master) ?? null;
  const pickedResume =
    (resumeParam && resumeVersions.find((r) => r.id === resumeParam)) || null;
  const scoringResumeId = pickedResume?.id ?? master?.id ?? null;

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

  // Primary sort: combined score desc (nulls last).
  // Fallbacks: deadline asc (nulls last), then created desc.
  rows.sort((a, b) => {
    const ca = a.combined_total;
    const cb = b.combined_total;
    if (ca !== cb) {
      if (ca == null) return 1;
      if (cb == null) return -1;
      return cb - ca;
    }
    const da = a.role.deadline_at ? new Date(a.role.deadline_at).getTime() : Infinity;
    const db = b.role.deadline_at ? new Date(b.role.deadline_at).getTime() : Infinity;
    if (da !== db) return da - db;
    return (
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Inbox</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {rows.length === 0
              ? "Nothing to triage. Add a role to get started."
              : `${rows.length} role${rows.length === 1 ? "" : "s"} to triage`}
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

      {resumeVersions.length > 0 && (
        <TriageResumePicker
          versions={resumeVersions}
          selectedId={scoringResumeId}
          masterId={master?.id ?? null}
        />
      )}

      {rows.length === 0 ? (
        <div className="rounded-md border border-border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Paste a URL and the app extracts what it can. Tap{" "}
            <Link href="/applications/new" className="text-foreground underline">
              + New
            </Link>{" "}
            to add your first role.
          </p>
        </div>
      ) : (
        <InboxViewSwitcher rows={rows} interestTags={profile?.interest_tags ?? []} />
      )}
    </div>
  );
}
