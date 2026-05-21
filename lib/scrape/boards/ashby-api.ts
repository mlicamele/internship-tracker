// Ashby public job board API. No auth for the public posting endpoint.
//
// API: https://api.ashbyhq.com/posting-api/job-board/{company}?includeCompensation=true
// Returns a list of all open postings. We filter by jobId to find the one we want.

import type { EvidenceLayer } from "../types";

interface AshbyJob {
  id?: string;
  title?: string;
  jobUrl?: string;
  location?: string;
  department?: string;
  team?: string;
  isRemote?: boolean;
  employmentType?: string;
  publishedAt?: string;
  updatedAt?: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  address?: { postalAddress?: { addressLocality?: string; addressRegion?: string; addressCountry?: string } };
  compensation?: {
    summaryComponents?: {
      compensationType?: string;
      interval?: string;
      currencyCode?: string;
      minValue?: number;
      maxValue?: number;
    }[];
    summary?: string;
  };
}

interface AshbyBoardResponse {
  apiVersion?: string;
  jobs?: AshbyJob[];
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/li>/gi, "")
    .replace(/<\/?(ul|ol|h\d|div|span)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function fetchAshbyJob(
  company: string,
  jobId: string
): Promise<EvidenceLayer | null> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(company)}?includeCompensation=true`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const board = (await res.json()) as AshbyBoardResponse;
    const job = board.jobs?.find((j) => j.id === jobId);
    if (!job) return null;

    const body = job.descriptionPlain
      ? job.descriptionPlain
      : job.descriptionHtml
        ? stripHtml(job.descriptionHtml)
        : "";

    const payText = formatAshbyPay(job.compensation);

    return {
      source: "ashby_api",
      company: null, // Ashby API doesn't return company name in job; comes from path
      title: job.title ?? null,
      location_texts: job.location ? [job.location] : [],
      jd_body: body,
      jd_url: job.jobUrl ?? null,
      posted_at: job.publishedAt ?? null,
      work_model: job.isRemote ? "remote" : undefined,
      compensation_text: payText,
      raw: job as unknown as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

function formatAshbyPay(c: AshbyJob["compensation"]): string | null {
  if (c?.summary) return c.summary;
  const comp = c?.summaryComponents?.[0];
  if (!comp || (!comp.minValue && !comp.maxValue)) return null;
  const currency = comp.currencyCode || "USD";
  const sym = currency === "USD" ? "$" : `${currency} `;
  const interval =
    comp.interval === "Hourly" || comp.interval === "hour"
      ? "/hr"
      : comp.interval === "Monthly" || comp.interval === "month"
        ? "/mo"
        : comp.interval === "Annual" || comp.interval === "year"
          ? "/yr"
          : "";
  if (comp.minValue && comp.maxValue && comp.minValue !== comp.maxValue) {
    return `${sym}${comp.minValue}-${comp.maxValue}${interval}`;
  }
  const v = comp.minValue ?? comp.maxValue;
  return `${sym}${v}${interval}`;
}
