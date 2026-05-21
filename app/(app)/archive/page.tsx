import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listByTriageState } from "@/lib/db/applications";
import { getProfile } from "@/lib/db/profile";
import { haversineMiles } from "@/lib/geocode";
import { PipelineTable } from "../pipeline/_components/data-table";
import type { PipelineRow } from "../pipeline/_components/columns";

export const dynamic = "force-dynamic";

export default async function ArchivePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [profile, applications] = await Promise.all([
    getProfile(supabase, user.id),
    listByTriageState(supabase, user.id, ["snoozed", "skipped"]),
  ]);

  const home =
    profile?.home_lat != null && profile.home_lng != null
      ? { lat: profile.home_lat, lng: profile.home_lng }
      : null;

  const rows: PipelineRow[] = applications.map((app) => ({
    ...app,
    distance_miles:
      home && app.role.role_lat != null && app.role.role_lng != null
        ? haversineMiles(home, { lat: app.role.role_lat, lng: app.role.role_lng })
        : null,
  }));

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
        emptyState={<span>No snoozed or skipped roles.</span>}
      />
    </div>
  );
}
