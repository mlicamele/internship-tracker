"use client";

import { useEffect, useRef, useState } from "react";
import type { InterviewSummary } from "@/lib/db/applications";
import { formatDate, formatNextInterview } from "./cell-formatters";

const TYPE_LABEL: Record<string, string> = {
  phone_screen: "Phone screen",
  technical: "Technical",
  behavioral: "Behavioral",
  system_design: "System design",
  onsite: "Onsite",
  final: "Final",
  other: "Other",
};

/**
 * Inline cell that shows the next interview summary, and on click opens a
 * popover with the full interview details. Click outside to close.
 */
export function InterviewPopover({
  interview,
}: {
  interview: InterviewSummary | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (interview) setOpen((v) => !v);
        }}
        className="text-left hover:underline disabled:cursor-default disabled:no-underline"
        disabled={!interview}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        {formatNextInterview(interview)}
      </button>
      {open && interview && (
        <div
          role="dialog"
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 top-full z-50 mt-1 w-80 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md"
        >
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold">
              {TYPE_LABEL[interview.type] ?? interview.type}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
            <Row label="When">
              {interview.scheduled_at
                ? formatScheduledAt(interview.scheduled_at)
                : "TBD"}
            </Row>
            {interview.duration_minutes !== null && (
              <Row label="Duration">{interview.duration_minutes} min</Row>
            )}
            {interview.location && <Row label="Location">{interview.location}</Row>}
            {interview.interviewer_names && (
              <Row label="Interviewers">{interview.interviewer_names}</Row>
            )}
            {interview.meeting_url && (
              <Row label="Link">
                <a
                  href={interview.meeting_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground underline-offset-2 hover:underline break-all"
                >
                  {shorten(interview.meeting_url)}
                </a>
              </Row>
            )}
            {interview.outcome && <Row label="Outcome">{interview.outcome}</Row>}
            {interview.notes && (
              <Row label="Notes">
                <span className="whitespace-pre-wrap">{interview.notes}</span>
              </Row>
            )}
          </dl>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function formatScheduledAt(iso: string): string {
  const d = new Date(iso);
  return `${formatDate(iso)} · ${d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function shorten(url: string): string {
  try {
    const u = new URL(url);
    return u.host + (u.pathname === "/" ? "" : u.pathname.slice(0, 30));
  } catch {
    return url.slice(0, 40);
  }
}
