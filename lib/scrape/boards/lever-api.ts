// Lever public postings API. No auth required.
//
// API: https://api.lever.co/v0/postings/{company}/{posting_id}?mode=json
// Or list all: https://api.lever.co/v0/postings/{company}?mode=json

import type { EvidenceLayer } from "../types";

interface LeverPosting {
  id?: string;
  text?: string; // title
  hostedUrl?: string;
  applyUrl?: string;
  categories?: {
    team?: string;
    department?: string;
    location?: string;
    commitment?: string;
    allLocations?: string[];
  };
  lists?: { text: string; content: string }[];
  description?: string;
  descriptionPlain?: string;
  additional?: string;
  additionalPlain?: string;
  createdAt?: number;
  country?: string;
  workplaceType?: string; // 'remote' | 'on-site' | 'hybrid' | 'unspecified'
  salaryRange?: {
    min?: number;
    max?: number;
    currency?: string;
    interval?: string;
  };
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

export async function fetchLeverPosting(
  company: string,
  jobId: string
): Promise<EvidenceLayer | null> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(company)}/${encodeURIComponent(jobId)}?mode=json`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const job = (await res.json()) as LeverPosting;

    // Build body from descriptionPlain → description → lists → additional
    const parts: string[] = [];
    if (job.descriptionPlain) parts.push(job.descriptionPlain);
    else if (job.description) parts.push(stripHtml(job.description));
    if (job.lists) {
      for (const list of job.lists) {
        if (list.text && list.content) {
          parts.push(`\n${list.text}\n${stripHtml(list.content)}`);
        }
      }
    }
    if (job.additionalPlain) parts.push("\n" + job.additionalPlain);
    else if (job.additional) parts.push("\n" + stripHtml(job.additional));
    const body = parts.join("\n").trim();

    const locationTexts =
      job.categories?.allLocations && job.categories.allLocations.length > 0
        ? job.categories.allLocations
        : job.categories?.location
          ? [job.categories.location]
          : [];

    const workModel: EvidenceLayer["work_model"] = job.workplaceType
      ? job.workplaceType.toLowerCase().includes("remote")
        ? "remote"
        : job.workplaceType.toLowerCase().includes("hybrid")
          ? "hybrid"
          : job.workplaceType.toLowerCase().includes("on")
            ? "onsite"
            : undefined
      : undefined;

    const payText = formatLeverPay(job.salaryRange);

    return {
      source: "lever_api",
      company: null, // Lever API doesn't return company name; we'll let URL/path infer
      title: job.text ?? null,
      location_texts: locationTexts,
      jd_body: body,
      jd_url: job.hostedUrl ?? null,
      posted_at: job.createdAt ? new Date(job.createdAt).toISOString() : null,
      work_model: workModel,
      compensation_text: payText,
      raw: job as unknown as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

function formatLeverPay(sr: LeverPosting["salaryRange"]): string | null {
  if (!sr || (!sr.min && !sr.max)) return null;
  const currency = sr.currency || "USD";
  const sym = currency === "USD" ? "$" : `${currency} `;
  const interval =
    sr.interval === "per-year-salary" || sr.interval === "annual"
      ? "/yr"
      : sr.interval === "per-month"
        ? "/mo"
        : sr.interval === "per-hour"
          ? "/hr"
          : "";
  if (sr.min && sr.max && sr.min !== sr.max) {
    return `${sym}${sr.min}-${sr.max}${interval}`;
  }
  const v = sr.min ?? sr.max;
  return `${sym}${v}${interval}`;
}
