import type { FitScore } from "@/lib/scoring/fit";
import type { ResumeFitDetails } from "@/lib/db/types";
import { cn } from "@/lib/utils";
import { ResumeFitDetailsPopover } from "@/components/resume-fit-details-popover";

/**
 * Three side-by-side score badges for the detail page: personal Fit,
 * Resume Fit, Combined. Same color families as the pipeline columns —
 * green/red for fit, blue for resume-fit, purple for combined — so the
 * two surfaces read as the same metric.
 */
export function ScoresStrip({
  fit,
  resumeFitScore,
  resumeFitDetails,
  combinedTotal,
  combinedUsedResumeSignal,
}: {
  fit: FitScore | null;
  resumeFitScore: number | null;
  resumeFitDetails: ResumeFitDetails | null;
  combinedTotal: number | null;
  combinedUsedResumeSignal: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <ScoreBox
        label="Combined"
        tooltip={
          combinedUsedResumeSignal
            ? "Combined = weighted mix of Fit + Resume Fit (adjust weights in Settings)"
            : "Combined shows Fit only — no Resume Fit score yet"
        }
      >
        <CombinedValue
          total={combinedTotal}
          usedResumeSignal={combinedUsedResumeSignal}
        />
      </ScoreBox>
      <ScoreBox label="Fit" tooltip={fitTooltip(fit)} dim>
        <FitValue fit={fit} />
      </ScoreBox>
      <ResumeFitDetailsPopover details={resumeFitDetails} score={resumeFitScore}>
        <ScoreBox label="Resume" tooltip={resumeTooltip(resumeFitDetails)} dim>
          <ResumeValue score={resumeFitScore} details={resumeFitDetails} />
        </ScoreBox>
      </ResumeFitDetailsPopover>
    </div>
  );
}

function ScoreBox({
  label,
  tooltip,
  dim = false,
  children,
}: {
  label: string;
  tooltip: string;
  dim?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      title={tooltip}
      className={cn(
        "flex flex-col items-center gap-0.5 rounded-md border border-border bg-background px-3 py-1.5",
        dim && "opacity-60"
      )}
    >
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function scoreBandTextClass(pct: number): string {
  if (pct >= 75) return "text-emerald-700 dark:text-emerald-400";
  if (pct >= 50) return "text-amber-700 dark:text-amber-400";
  return "text-muted-foreground";
}

function FitValue({ fit }: { fit: FitScore | null }) {
  if (!fit) return <span className="text-sm text-muted-foreground">—</span>;
  const pct = Math.round(fit.total * 100);
  const classes = fit.ineligible ? "text-destructive" : scoreBandTextClass(pct);
  return (
    <span className={cn("text-lg font-semibold tabular-nums", classes)}>
      {pct}
    </span>
  );
}

function ResumeValue({
  score,
  details,
}: {
  score: number | null;
  details: ResumeFitDetails | null;
}) {
  if (score == null) {
    if (details?.tier === "insufficient") {
      return (
        <span className="text-[10px] font-medium uppercase text-muted-foreground">
          low signal
        </span>
      );
    }
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  const pct = Math.round(score);
  return (
    <span
      className={cn("text-lg font-semibold tabular-nums", scoreBandTextClass(pct))}
    >
      {pct}
    </span>
  );
}

function CombinedValue({
  total,
  usedResumeSignal,
}: {
  total: number | null;
  usedResumeSignal: boolean;
}) {
  if (total == null)
    return <span className="text-sm text-muted-foreground">—</span>;
  const pct = Math.round(total);
  return (
    <span
      className={cn(
        "text-lg font-semibold tabular-nums",
        scoreBandTextClass(pct),
        !usedResumeSignal && "italic"
      )}
    >
      {pct}
    </span>
  );
}

function fitTooltip(fit: FitScore | null): string {
  if (!fit) return "Personal fit — set a home address and grad year in Settings to enable";
  if (fit.ineligible) {
    return `Ineligible on class-year. Distance ${fit.components.distance.toFixed(2)} · interest ${fit.components.interest.toFixed(2)}`;
  }
  return `class-year ${fit.components.classYear.toFixed(2)} × ${fit.weights.classYear} + distance ${fit.components.distance.toFixed(2)} × ${fit.weights.distance} + interest ${fit.components.interest.toFixed(2)} × ${fit.weights.interest}`;
}

function resumeTooltip(details: ResumeFitDetails | null): string {
  if (!details) return "Resume fit — upload a resume in Settings to enable";
  const matched = details.matched_skills.length
    ? `\nmatched: ${details.matched_skills.join(", ")}`
    : "";
  const gaps = details.gaps.length ? `\ngaps: ${details.gaps.join(", ")}` : "";
  return `${details.rationale}${matched}${gaps}`;
}
