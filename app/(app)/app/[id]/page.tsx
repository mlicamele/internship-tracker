import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getById } from "@/lib/db/applications";
import { listForApplication as listInterviews } from "@/lib/db/interviews";
import { listForApplication as listStatusEvents } from "@/lib/db/status-events";
import { get as getCompanyNote } from "@/lib/db/company_notes";
import { EditApplicationView } from "./_components/edit-application-view";

export const dynamic = "force-dynamic";

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const application = await getById(supabase, id);
  if (!application || application.user_id !== user.id) {
    notFound();
  }

  const [interviews, statusEvents, companyNote] = await Promise.all([
    listInterviews(supabase, id),
    listStatusEvents(supabase, id),
    getCompanyNote(supabase, user.id, application.role.company.id),
  ]);

  const isDraft = application.triage_state === "draft";

  return (
    <article className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-2">
        <Link
          href="/pipeline"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Pipeline
        </Link>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {application.role.company.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {application.role.title}
          </p>
          {isDraft && (
            <p className="text-xs font-medium text-amber-500">
              Draft — review the auto-extracted fields, then click Save to add this to your pipeline.
            </p>
          )}
        </div>
      </header>

      <EditApplicationView
        application={application}
        interviews={interviews}
        statusEvents={statusEvents}
        initialCompanyNotes={companyNote?.notes ?? ""}
      />
    </article>
  );
}
