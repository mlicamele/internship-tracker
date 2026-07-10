import { cn } from "@/lib/utils";
import type { LinkStatus } from "@/lib/db/types";

/**
 * Small pill shown next to a role's title / company when the nightly
 * link validator (`lib/link-check/check-link.ts`) has flagged it. Only
 * `dead` and `suspect` render — `live` and `unknown` are silent.
 *
 * Colors match the existing "destructive" (red) / amber palette used
 * elsewhere in the app so the badge reads as an alert without needing
 * its own visual vocabulary.
 */
export function LinkStatusBadge({
  status,
  checkedAt,
  className,
}: {
  status: LinkStatus;
  checkedAt: string | null;
  className?: string;
}) {
  if (status !== "dead" && status !== "suspect") return null;
  const isDead = status === "dead";
  const label = isDead ? "Link dead" : "Link ?";
  const title =
    (isDead
      ? "Posting URL appears dead. Verify manually."
      : "Posting URL response was inconclusive (bot wall, empty body, or ambiguous redirect).") +
    (checkedAt ? ` Last checked ${formatChecked(checkedAt)}.` : "");
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        isDead
          ? "bg-destructive/10 text-destructive"
          : "bg-amber-500/15 text-amber-700 dark:text-amber-400",
        className
      )}
    >
      {label}
    </span>
  );
}

function formatChecked(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const day = 86400_000;
  if (diffMs < day) return "today";
  const days = Math.floor(diffMs / day);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
