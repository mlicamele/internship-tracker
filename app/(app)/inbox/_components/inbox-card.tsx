"use client";

import Link from "next/link";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/icons";
import { cn } from "@/lib/utils";
import {
  RelocationAssistanceCell,
  WorkModelCell,
  formatCompensation,
  formatDate,
  formatDistance,
  formatLocations,
  formatGradYearWindow,
  formatTargetTerm,
} from "@/app/(app)/pipeline/_components/cell-formatters";
import type { PipelineRow } from "@/app/(app)/pipeline/_components/columns";
import { triageAction } from "../actions";

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-sm truncate">{children}</span>
    </div>
  );
}

export function InboxCard({ row }: { row: PipelineRow }) {
  const [pending, startTransition] = useTransition();
  const r = row.role;

  function triage(action: "apply" | "skip" | "snooze") {
    startTransition(async () => {
      await triageAction(row.id, action);
    });
  }

  return (
    <article
      className={cn(
        "rounded-lg border border-border bg-card/40 p-4 space-y-3 transition-opacity",
        pending && "opacity-50 pointer-events-none"
      )}
    >
      {/* Header: company + role title — clickable to detail, with separate open-posting anchor */}
      <div className="flex items-start gap-2">
        <Link
          href={`/app/${row.id}`}
          className="flex-1 min-w-0 block space-y-1 rounded-sm -mx-1 px-1 py-0.5 hover:bg-muted/40 focus-visible:bg-muted/40 focus:outline-none"
        >
          <h2 className="text-base font-semibold tracking-tight">
            {r.company.name}
          </h2>
          <p className="text-sm text-muted-foreground">{r.title}</p>
        </Link>
        {r.jd_url && (
          <a
            href={r.jd_url}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open posting: ${r.jd_url}`}
            className="shrink-0 inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted/40 hover:text-foreground focus-visible:bg-muted/40 focus:outline-none"
          >
            <ExternalLink className="size-3.5" />
            <span>Posting</span>
          </a>
        )}
      </div>

      {/* Key facts grid */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3 md:grid-cols-4">
        <Stat label="Target">
          {formatTargetTerm(r.target_year, r.target_season)}
        </Stat>
        <Stat label="Deadline">{formatDate(r.deadline_at)}</Stat>
        <Stat label="Location">{formatLocations(r.locations)}</Stat>
        <Stat label="Distance">{formatDistance(row.distance_miles)}</Stat>
        <Stat label="Mode">
          <WorkModelCell model={r.work_model} />
        </Stat>
        <Stat label="Grad year">
          {formatGradYearWindow(r.min_grad_year, r.max_grad_year)}
        </Stat>
        <Stat label="Relocation">
          <RelocationAssistanceCell value={r.relocation_assistance} />
        </Stat>
        <Stat label="$/hr">
          {formatCompensation(r.compensation_hourly_dollars)}
        </Stat>
      </div>

      {/* Action row */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={() => triage("apply")}
          disabled={pending}
          className="flex-1 min-w-24"
        >
          Apply
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => triage("snooze")}
          disabled={pending}
          className="flex-1 min-w-24"
        >
          Snooze 7d
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => triage("skip")}
          disabled={pending}
          className="flex-1 min-w-24 text-muted-foreground hover:text-destructive"
        >
          Skip
        </Button>
      </div>
    </article>
  );
}
