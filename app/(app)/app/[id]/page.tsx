import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getById } from "@/lib/db/applications";
import { listForApplication as listInterviews } from "@/lib/db/interviews";
import { listForApplication as listStatusEvents } from "@/lib/db/status-events";
import { get as getCompanyNote } from "@/lib/db/company_notes";
import { DetailHeader } from "./_components/header";
import { MetadataRow } from "./_components/metadata-row";
import { NotesEditor } from "./_components/notes-editor";
import { InterviewsSection } from "./_components/interviews-section";
import { CompanyNotesSection } from "./_components/company-notes-section";
import { StatusTimeline } from "./_components/status-timeline";
import { JdViewer } from "./_components/jd-viewer";
import { DeleteApplicationButton } from "./_components/delete-button";

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

  return (
    <article className="mx-auto max-w-3xl space-y-8">
      <DetailHeader application={application} />

      <MetadataRow application={application} />

      <NotesEditor
        applicationId={application.id}
        initialNotes={application.notes}
      />

      <InterviewsSection
        applicationId={application.id}
        interviews={interviews}
      />

      <CompanyNotesSection
        companyId={application.role.company.id}
        companyName={application.role.company.name}
        initialNotes={companyNote?.notes ?? ""}
      />

      <StatusTimeline events={statusEvents} />

      <JdViewer body={application.role.jd_body_text} />

      <div className="flex justify-end border-t border-border pt-6">
        <DeleteApplicationButton
          applicationId={application.id}
          companyName={application.role.company.name}
        />
      </div>
    </article>
  );
}
