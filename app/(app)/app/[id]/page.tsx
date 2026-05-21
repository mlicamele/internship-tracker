import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getById } from "@/lib/db/applications";
import { listForApplication as listInterviews } from "@/lib/db/interviews";
import { listForApplication as listStatusEvents } from "@/lib/db/status-events";
import { get as getCompanyNote } from "@/lib/db/company_notes";
import { StatusCell } from "@/app/(app)/pipeline/_components/status-cell";
import { RoleEditForm } from "./_components/role-edit-form";
import { InterviewsSection } from "./_components/interviews-section";
import { StatusTimeline } from "./_components/status-timeline";
import { JdViewer } from "./_components/jd-viewer";

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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 flex-1 min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">
              {application.role.company.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              {application.role.title}
            </p>
            {isDraft && (
              <p className="text-xs font-medium text-amber-500">
                Draft — review the auto-extracted fields and save to add this to your pipeline.
              </p>
            )}
          </div>
          {!isDraft && (
            <StatusCell
              applicationId={application.id}
              status={application.status}
            />
          )}
        </div>
      </header>

      <RoleEditForm
        application={application}
        initialCompanyNotes={companyNote?.notes ?? ""}
      />

      {!isDraft && (
        <>
          <InterviewsSection
            applicationId={application.id}
            interviews={interviews}
          />
          <StatusTimeline events={statusEvents} />
        </>
      )}

      <JdViewer body={application.role.jd_body_text} />
    </article>
  );
}
