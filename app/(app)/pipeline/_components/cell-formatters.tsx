import { cn } from "@/lib/utils";
import type {
  ApplicationStatus,
  RelocationAssistance,
  RoleLocation,
  TargetSeason,
  WorkModel,
} from "@/lib/db/types";

export function Pill({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border border-border bg-muted/40 px-1.5 py-0.5 text-xs font-medium text-muted-foreground",
        className
      )}
    >
      {children}
    </span>
  );
}

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  saved: "Saved",
  applied: "Applied",
  oa: "OA",
  phone: "Phone",
  technical: "Technical",
  final: "Final",
  offer: "Offer",
  reject: "Reject",
  ghosted: "Ghosted",
};

const STATUS_TONE: Record<ApplicationStatus, string> = {
  saved: "border-zinc-700/50 bg-zinc-800/50 text-zinc-300",
  applied: "border-blue-700/50 bg-blue-900/30 text-blue-300",
  oa: "border-cyan-700/50 bg-cyan-900/30 text-cyan-300",
  phone: "border-violet-700/50 bg-violet-900/30 text-violet-300",
  technical: "border-indigo-700/50 bg-indigo-900/30 text-indigo-300",
  final: "border-fuchsia-700/50 bg-fuchsia-900/30 text-fuchsia-300",
  offer: "border-emerald-600/50 bg-emerald-900/40 text-emerald-300",
  reject: "border-rose-800/50 bg-rose-950/40 text-rose-400",
  ghosted: "border-zinc-800/50 bg-zinc-900/40 text-zinc-500",
};

export function StatusPill({ status }: { status: ApplicationStatus }) {
  return <Pill className={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>;
}

export const STATUS_OPTIONS = (Object.keys(STATUS_LABEL) as ApplicationStatus[]).map(
  (value) => ({ value, label: STATUS_LABEL[value] })
);

const SEASON_SHORT: Record<TargetSeason, string> = {
  summer: "S",
  fall: "F",
  winter: "W",
  spring: "Sp",
};

export function formatTargetTerm(
  year: number | null,
  season: TargetSeason
): string {
  if (!year) return "—";
  return `${SEASON_SHORT[season]} ${String(year).slice(-2)}`;
}

const WORK_MODEL_LABEL: Record<WorkModel, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "Onsite",
};

export function WorkModelCell({ model }: { model: WorkModel | null }) {
  if (!model) return <span className="text-muted-foreground">—</span>;
  return <Pill>{WORK_MODEL_LABEL[model]}</Pill>;
}

export function formatMaxGradYear(year: number | null): React.ReactNode {
  if (year === null) return <span className="text-muted-foreground">—</span>;
  return <Pill>≤ {year}</Pill>;
}

const RELOCATION_LABEL: Record<RelocationAssistance, string> = {
  provided: "Provided",
  not_provided: "Not provided",
};

export function RelocationAssistanceCell({
  value,
}: {
  value: RelocationAssistance | null;
}) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return <Pill>{RELOCATION_LABEL[value]}</Pill>;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "2-digit" }),
  });
}

export function formatDistance(miles: number | null): React.ReactNode {
  if (miles === null) return <span className="text-muted-foreground">—</span>;
  if (miles < 1) return "<1 mi";
  if (miles < 100) return `${Math.round(miles)} mi`;
  return `${Math.round(miles / 10) * 10} mi`;
}

export function formatLocations(
  locations: RoleLocation[]
): React.ReactNode {
  if (!locations || locations.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (locations.length === 1) return locations[0].text;
  return (
    <span title={locations.map((l) => l.text).join(", ")}>
      {locations[0].text}{" "}
      <span className="text-muted-foreground">
        +{locations.length - 1}
      </span>
    </span>
  );
}

export function formatCompensation(
  hourlyDollars: number | null
): React.ReactNode {
  if (hourlyDollars) {
    return `$${hourlyDollars}/hr`;
  }
  return <span className="text-muted-foreground">—</span>;
}

export function formatNextInterview(
  next: { type: string; scheduled_at: string | null; meeting_url: string | null } | null
): React.ReactNode {
  if (!next) return <span className="text-muted-foreground">—</span>;
  const when = next.scheduled_at ? formatDate(next.scheduled_at) : "TBD";
  const typeLabel = next.type.replace(/_/g, " ");
  return (
    <span className="inline-flex items-center gap-1">
      <span className="capitalize">{typeLabel}</span>
      <span className="text-muted-foreground">·</span>
      <span>{when}</span>
      {next.meeting_url && (
        <span className="text-muted-foreground" aria-label="meeting link">
          ↗
        </span>
      )}
    </span>
  );
}
