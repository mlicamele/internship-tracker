// Extract structured job data from JSON-LD <script type="application/ld+json">
// blocks. Many sites (including Greenhouse boards, custom career pages,
// even some client-rendered apps) embed JobPosting schema for SEO. When
// present, this gives near-100% accuracy with zero LLM cost.
//
// Schema: https://schema.org/JobPosting

import type * as cheerio from "cheerio";

type CheerioAPI = ReturnType<typeof cheerio.load>;

export interface JsonLdJobPosting {
  title?: string;
  description?: string;
  hiringOrganization?:
    | string
    | {
        name?: string;
        sameAs?: string;
        url?: string;
      };
  jobLocation?:
    | JobLocation
    | JobLocation[];
  datePosted?: string;
  validThrough?: string;
  baseSalary?: {
    currency?: string;
    value?: {
      value?: number | string;
      minValue?: number | string;
      maxValue?: number | string;
      unitText?: string;
    };
  };
  employmentType?: string | string[];
  jobLocationType?: string; // "TELECOMMUTE" = remote
  industry?: string | string[];
  occupationalCategory?: string;
  qualifications?: string;
  educationRequirements?: string | { credentialCategory?: string };
}

interface JobLocation {
  address?: {
    addressLocality?: string;
    addressRegion?: string;
    addressCountry?: string;
    streetAddress?: string;
  };
}

/** Find the first JSON-LD JobPosting object in the page. */
export function extractJobLd($: CheerioAPI): JsonLdJobPosting | null {
  const scripts = $('script[type="application/ld+json"]').toArray();
  for (const script of scripts) {
    const raw = $(script).text().trim();
    if (!raw) continue;
    const parsed = safeParseJson(raw);
    if (!parsed) continue;
    // Could be a single object or an array (or @graph)
    const candidates = collectCandidates(parsed);
    for (const c of candidates) {
      if (isJobPosting(c)) return c as JsonLdJobPosting;
    }
  }
  return null;
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // Some sites embed multiple JSON objects newline-separated — try recovery
    try {
      // Wrap in array brackets and parse as JSON
      const wrapped = `[${raw.replace(/}\s*{/g, "},{")}]`;
      return JSON.parse(wrapped);
    } catch {
      return null;
    }
  }
}

function collectCandidates(node: unknown): unknown[] {
  const out: unknown[] = [];
  if (Array.isArray(node)) {
    for (const item of node) out.push(...collectCandidates(item));
  } else if (node && typeof node === "object") {
    out.push(node);
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj["@graph"])) {
      for (const item of obj["@graph"]) out.push(...collectCandidates(item));
    }
  }
  return out;
}

function isJobPosting(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const t = (node as Record<string, unknown>)["@type"];
  if (typeof t === "string") return t === "JobPosting";
  if (Array.isArray(t)) return t.some((x) => x === "JobPosting");
  return false;
}

/** Strip HTML tags from the JSON-LD description if present. */
export function stripHtml(html: string | undefined): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<li>/gi, "\n• ")
    .replace(/<\/li>/gi, "")
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

/** Coerce JSON-LD location(s) into an array of readable strings. */
export function flattenLocations(
  jobLocation: JobLocation | JobLocation[] | undefined
): string[] {
  if (!jobLocation) return [];
  const list = Array.isArray(jobLocation) ? jobLocation : [jobLocation];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const loc of list) {
    const a = loc.address;
    if (!a) continue;
    const pieces = [a.addressLocality, a.addressRegion, a.addressCountry].filter(
      Boolean
    );
    if (pieces.length === 0) continue;
    const joined = pieces.join(", ");
    if (seen.has(joined)) continue;
    seen.add(joined);
    out.push(joined);
  }
  return out;
}

/** Coerce hiringOrganization to a simple name string. */
export function organizationName(
  org: JsonLdJobPosting["hiringOrganization"]
): string | null {
  if (!org) return null;
  if (typeof org === "string") return org;
  return org.name ?? null;
}
