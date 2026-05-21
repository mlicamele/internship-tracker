import Link from "next/link";
import type { ApplicationRow } from "@/lib/db/applications";
import { StatusCell } from "@/app/(app)/pipeline/_components/status-cell";

export function DetailHeader({ application }: { application: ApplicationRow }) {
  return (
    <header className="space-y-2">
      <Link
        href="/pipeline"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Pipeline
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {application.role.company.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {application.role.title}
          </p>
        </div>
        <StatusCell
          applicationId={application.id}
          status={application.status}
        />
      </div>
    </header>
  );
}
