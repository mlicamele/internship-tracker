import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listByTriageState } from "@/lib/db/applications";
import { getProfile } from "@/lib/db/profile";
import { haversineMiles } from "@/lib/geocode";
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

  const [profile, applications] = await Promise.all([
    getProfile(supabase, user.id),
    listByTriageState(supabase, user.id, "active"),
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
