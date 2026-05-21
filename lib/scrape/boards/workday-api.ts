// Workday's CXS endpoint returns clean job JSON including ALL locations
// (additionalLocations[]). Beats trying to scrape Workday's client-rendered
// HTML, which usually only exposes the primary location.
//
//   GET https://{host}/wday/cxs/{tenant}/{site}/job/{jobPath}
//
// Example:
//   https://salesforce.wd12.myworkdayjobs.com/wday/cxs/salesforce/External_Career_Site/job/Summer-2027-Intern---Software-Engineer_JR340771-1

import type { EvidenceLayer } from "../types";
import { stripHtml } from "../jsonld";

interface WorkdayJobResponse {
  jobPostingInfo?: {
    id?: string;
    title?: string;
    jobDescription?: string;
    location?: string;
    additionalLocations?: string[];
    postedOn?: string;
    startDate?: string;
    endDate?: string;
    timeType?: string;
    jobReqId?: string;
    jobPostingId?: string;
    country?: { descriptor?: string };
    remoteType?: string;
    externalUrl?: string;
  };
  hiringOrganization?: { name?: string };
}

function parseRemoteType(rt: string | undefined): EvidenceLayer["work_model"] {
  if (!rt) return undefined;
  const t = rt.toLowerCase();
  if (t.includes("remote") && !t.includes("no remote")) return "remote";
  if (t.includes("hybrid")) return "hybrid";
  if (t.includes("on-site") || t.includes("onsite") || t.includes("on site"))
    return "onsite";
  return undefined;
}

/**
 * Convert "Posted N Days Ago" / "Posted Yesterday" / "Posted Today" to an ISO
 * date relative to now. Returns null for any other format.
 */
function parsePostedOn(s: string | undefined): string | null {
  if (!s) return null;
  const lower = s.toLowerCase();
  const now = new Date();
  if (lower.includes("today")) return now.toISOString();
  if (lower.includes("yesterday")) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString();
  }
  const m = lower.match(/(\d+)\s*\+?\s*days?\s*ago/);
  if (m) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - parseInt(m[1], 10));
    return d.toISOString();
  }
  const m2 = lower.match(/(\d+)\s*\+?\s*months?\s*ago/);
  if (m2) {
    const d = new Date(now);
    d.setUTCMonth(d.getUTCMonth() - parseInt(m2[1], 10));
    return d.toISOString();
  }
  return null;
}

export async function fetchWorkdayJob(
  host: string,
  tenant: string,
  site: string,
  jobPath: string
): Promise<EvidenceLayer | null> {
  const url = `https://${host}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}/job/${jobPath}`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as WorkdayJobResponse;
    const jp = data.jobPostingInfo;
    if (!jp) return null;

    const locationTexts: string[] = [];
    const seen = new Set<string>();
    function addLoc(s: string | undefined) {
      if (!s) return;
      const t = s.trim();
      if (!t) return;
      const k = t.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      locationTexts.push(t);
    }
    addLoc(jp.location);
    for (const l of jp.additionalLocations ?? []) addLoc(l);

    const body = jp.jobDescription ? stripHtml(jp.jobDescription) : "";
    const postedAt = parsePostedOn(jp.postedOn) ?? jp.startDate ?? null;

    return {
      source: "workday_api",
      company: data.hiringOrganization?.name ?? null,
      title: jp.title ?? null,
      location_texts: locationTexts,
      jd_body: body,
      jd_url: jp.externalUrl ?? null,
      posted_at: postedAt,
      deadline_at: jp.endDate ?? null,
      work_model: parseRemoteType(jp.remoteType),
      raw: jp as unknown as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}
