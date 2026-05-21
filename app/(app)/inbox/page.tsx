import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listByTriageState } from "@/lib/db/applications";
import { getProfile } from "@/lib/db/profile";
import { weightedNearestDistance } from "@/lib/distance";
import { buttonVariants } from "@/components/ui/button";
import { Plus } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { PipelineRow } from "../pipeline/_components/columns";
import { InboxCard } from "./_components/inbox-card";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [profile, applications] = await Promise.all([
    getProfile(supabase, user.id),
    listByTriageState(supabase, user.id, "inbox"),
  ]);

  const destinations =
    profile?.home_lat != null && profile.home_lng != null
      ? [{ lat: profile.home_lat, lng: profile.home_lng, weight: 1 }]
      : [];

  const rows: PipelineRow[] = applications.map((app) => ({
    ...app,
    distance_miles:
      destinations.length > 0
        ? weightedNearestDistance(app.role.locations, destinations)
        : null,
  }));

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
        <div className="space-y-3">
          {rows.map((row) => (
            <InboxCard key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
