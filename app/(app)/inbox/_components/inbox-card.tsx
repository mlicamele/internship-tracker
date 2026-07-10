"use client";

import Link from "next/link";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { FitScore } from "@/lib/scoring/fit";
import { ResumeFitDetailsPopover } from "@/components/resume-fit-details-popover";
import { LinkStatusBadge } from "@/components/link-status-badge";
import type { ResumeFitDetails } from "@/lib/db/types";
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

function scoreBandClasses(pct: number): string {
  if (pct >= 75) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
  if (pct >= 50) return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  return "bg-muted text-muted-foreground";
}

function FitBadge({ fit }: { fit: FitScore | null }) {
  if (!fit) return null;
  const pct = Math.round(fit.total * 100);
  const classes = fit.ineligible
    ? "bg-destructive/10 text-destructive"
    : scoreBandClasses(pct);
  const tooltip = fit.ineligible
    ? `Ineligible on class-year. Distance ${fit.components.distance.toFixed(2)} · interest ${fit.components.interest.toFixed(2)}`
    : `class-year ${fit.components.classYear.toFixed(2)} × ${fit.weights.classYear} + distance ${fit.components.distance.toFixed(2)} × ${fit.weights.distance} + interest ${fit.components.interest.toFixed(2)} × ${fit.weights.interest}`;
  return (
    <span
      title={tooltip}
      className={cn(
        "shrink-0 rounded px-1.5 py-1 text-xs font-medium tabular-nums opacity-60",
        classes
      )}
    >
      Fit {pct}
    </span>
  );
}

function ResumeFitBadge({
  score,
  details,
}: {
  score: number | null;
  details: ResumeFitDetails | null;
}) {
  if (score == null) {
    if (details?.tier === "insufficient") {
      return (
        <ResumeFitDetailsPopover details={details} score={null} align="end">
          <span className="shrink-0 rounded bg-muted px-1.5 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground opacity-60">
            Resume — low signal
          </span>
        </ResumeFitDetailsPopover>
      );
    }
    return null;
  }
  const pct = Math.round(score);
  return (
    <ResumeFitDetailsPopover details={details} score={score} align="end">
      <span
        className={cn(
          "shrink-0 rounded px-1.5 py-1 text-xs font-medium tabular-nums opacity-60",
          scoreBandClasses(pct)
        )}
      >
        Resume {pct}
      </span>
    </ResumeFitDetailsPopover>
  );
}

function CombinedBadge({
  total,
  usedResumeSignal,
}: {
  total: number | null;
  usedResumeSignal: boolean;
}) {
  if (total == null) return null;
  const pct = Math.round(total);
  const tooltip = usedResumeSignal
    ? "Combined = weighted mix of Fit + Resume Fit"
    : "Combined shows Fit only — no Resume Fit score yet";
  return (
    <span
      title={tooltip}
      className={cn(
        "shrink-0 rounded px-1.5 py-1 text-xs font-medium tabular-nums",
        scoreBandClasses(pct),
        !usedResumeSignal && "italic"
      )}
    >
      Combined {pct}
    </span>
  );
}

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

export function InboxCard({
  row,
  interestTags,
}: {
  row: PipelineRow;
  interestTags: string[];
}) {
  const [pending, startTransition] = useTransition();
  const r = row.role;
  const interestSet = new Set(interestTags);

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
      {/* Header: company + role title — clickable to detail, plus fit badge + open-posting anchor */}
      <div className="flex items-start gap-2">
        <Link
          href={`/app/${row.id}`}
          className="flex-1 min-w-0 block space-y-1 rounded-sm -mx-1 px-1 py-0.5 hover:bg-muted/40 focus-visible:bg-muted/40 focus:outline-none"
        >
          <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold tracking-tight">
            <span>{r.company.name}</span>
            <LinkStatusBadge
              status={r.link_status}
              checkedAt={r.link_checked_at}
            />
          </h2>
          <p className="text-sm text-muted-foreground">{r.title}</p>
        </Link>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <CombinedBadge
            total={row.combined_total}
            usedResumeSignal={row.combined_used_resume_signal}
          />
          <FitBadge fit={row.fit_details} />
          <ResumeFitBadge
            score={row.resume_fit_score}
            details={row.resume_fit_details}
          />
        </div>
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

      {/* Tags — matching interests render green (parity with triage-deck) */}
      {r.tags && r.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {r.tags.map((t) => {
            const isInterest = interestSet.has(t);
            return (
              <span
                key={t}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  isInterest
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                    : "border-border bg-muted/40 text-muted-foreground"
                )}
              >
                {t}
              </span>
            );
          })}
        </div>
      )}

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
