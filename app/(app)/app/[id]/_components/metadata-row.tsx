import type { ApplicationRow } from "@/lib/db/applications";
import {
  ClassYearCell,
  WorkModelCell,
  formatCompensation,
  formatDate,
  formatTargetTerm,
} from "@/app/(app)/pipeline/_components/cell-formatters";
import { ExternalLink } from "@/components/icons";

function Item({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

export function MetadataRow({ application }: { application: ApplicationRow }) {
  const r = application.role;
  return (
    <div className="grid grid-cols-2 gap-4 rounded-md border border-border bg-card/40 p-4 md:grid-cols-4 lg:grid-cols-6">
      <Item label="Target">{formatTargetTerm(r.target_year, r.target_season)}</Item>
      <Item label="Eligibility">
        <ClassYearCell tag={r.class_year_tag} />
      </Item>
      <Item label="Deadline">{formatDate(r.deadline_at)}</Item>
      <Item label="Posted">{formatDate(r.posted_at)}</Item>
      <Item label="Location">
        {r.location_text ?? <span className="text-muted-foreground">—</span>}
      </Item>
      <Item label="Mode">
        <WorkModelCell model={r.work_model} />
      </Item>
      <Item label="Compensation">
        {formatCompensation(r.compensation_text, r.compensation_hourly_cents)}
      </Item>
      <Item label="Source">
        <span className="capitalize">{r.source.replace(/_/g, " ")}</span>
      </Item>
      {r.jd_url && (
        <Item label="JD URL">
          <a
            href={r.jd_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline"
          >
            View
            <ExternalLink className="size-3" />
          </a>
        </Item>
      )}
    </div>
  );
}
