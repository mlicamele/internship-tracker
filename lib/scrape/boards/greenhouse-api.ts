// Greenhouse public board API. No auth required. Returns clean structured
// data for any posting hosted on Greenhouse.
//
// Docs (informal): https://developers.greenhouse.io/job-board.html
// API base: https://boards-api.greenhouse.io/v1/boards/{company}/jobs/{job_id}

import type { EvidenceLayer } from "../types";

interface GreenhouseLocation {
  name?: string;
}

interface GreenhouseDepartment {
  id?: number;
  name?: string;
}

interface GreenhouseMetadata {
  id?: number;
  name?: string;
  value?: unknown;
  value_type?: string;
}

interface GreenhousePay {
  min_value?: number;
  max_value?: number;
  currency?: string;
  pay_period?: string;
}

interface GreenhouseJob {
  id?: number;
  title?: string;
  content?: string; // HTML
  absolute_url?: string;
  location?: GreenhouseLocation;
  offices?: { name?: string }[];
  departments?: GreenhouseDepartment[];
  metadata?: GreenhouseMetadata[];
  updated_at?: string;
  first_published?: string;
  requisition_id?: string;
  internal_job_id?: number;
  company_name?: string;
  pay_input_ranges?: GreenhousePay[];
  pay_ranges?: GreenhousePay[];
}

function decodeHtml(html: string): string {
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
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function fetchGreenhouseJob(
  company: string,
  jobId: string
): Promise<EvidenceLayer | null> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(company)}/jobs/${encodeURIComponent(jobId)}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const job = (await res.json()) as GreenhouseJob;

    const officeNames = (job.offices ?? [])
      .map((o) => o.name)
      .filter((n): n is string => !!n);
    const locationTexts =
      officeNames.length > 0
        ? officeNames
        : job.location?.name
          ? [job.location.name]
          : [];

    const body = job.content ? decodeHtml(job.content) : "";

    const pay = (job.pay_ranges && job.pay_ranges[0]) || (job.pay_input_ranges && job.pay_input_ranges[0]);
    const payText = pay
      ? formatGreenhousePay(pay)
      : null;

    return {
      source: "greenhouse_api",
      company: job.company_name ?? null,
      title: job.title ?? null,
      location_texts: locationTexts,
      jd_body: body,
      jd_url: job.absolute_url ?? null,
      posted_at: job.first_published ?? null,
      compensation_text: payText,
      // The rest stays undefined; the LLM extractor will fill them in.
      raw: job as unknown as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

function formatGreenhousePay(p: GreenhousePay): string | null {
  if (!p.min_value && !p.max_value) return null;
  const currency = p.currency || "USD";
  const sym = currency === "USD" ? "$" : `${currency} `;
  const period =
    p.pay_period === "Hourly"
      ? "/hr"
      : p.pay_period === "Monthly"
        ? "/mo"
        : p.pay_period === "Annual"
          ? "/yr"
          : "";
  if (p.min_value && p.max_value && p.min_value !== p.max_value) {
    return `${sym}${p.min_value}-${p.max_value}${period}`;
  }
  const v = p.min_value ?? p.max_value;
  return `${sym}${v}${period}`;
}
