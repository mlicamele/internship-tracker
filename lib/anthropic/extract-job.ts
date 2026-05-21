// Sonnet-based job posting extractor. Takes whatever evidence we have
// (rendered HTML excerpt, JSON-LD structured data, per-board parser hints,
// user-pasted JD body) and returns a fully-structured job posting with
// confidence per field.
//
// This is the headline extraction call. Cost ~$0.01-0.02 per role at
// current Sonnet 4.6 pricing.

import { anthropic, HAIKU_MODEL } from "@/lib/anthropic";
import type {
  ClassYearTag,
  TargetSeason,
  WorkModel,
} from "@/lib/db/types";

export interface ExtractedJob {
  company: string | null;
  title: string | null;
  location_text: string | null;
  jd_body: string;
  jd_url: string | null;
  deadline_at: string | null;
  posted_at: string | null;
  work_model: WorkModel;
  target_year: number | null;
  target_season: TargetSeason;
  class_year_tag: ClassYearTag;
  class_year_confidence: number;
  compensation_text: string | null;
  compensation_hourly_cents: number | null;
  overall_confidence: number;
  notes: string;
}

const SAFE_DEFAULT: ExtractedJob = {
  company: null,
  title: null,
  location_text: null,
  jd_body: "",
  jd_url: null,
  deadline_at: null,
  posted_at: null,
  work_model: "unspecified",
  target_year: null,
  target_season: "summer",
  class_year_tag: "unspecified",
  class_year_confidence: 0,
  compensation_text: null,
  compensation_hourly_cents: null,
  overall_confidence: 0,
  notes: "extraction failed",
};

const CLASS_YEAR_VALUES = new Set([
  "freshman_ok",
  "sophomore_ok",
  "junior_plus",
  "unspecified",
]);

const TARGET_SEASON_VALUES = new Set(["summer", "fall", "winter", "spring"]);

const WORK_MODEL_VALUES = new Set(["remote", "hybrid", "onsite", "unspecified"]);

const SYSTEM_PROMPT = `You are extracting structured fields from a job/internship posting for an undergrad applicant.

You receive a mix of evidence: rendered HTML excerpts, JSON-LD structured data, per-board parser hints, and possibly the URL itself. Your job: synthesize all evidence into the cleanest possible JSON output.

Output STRICT JSON only — no markdown, no prose, no code fence.

Schema:
{
  "company": string | null,
  "title": string | null,
  "location_text": string | null,
  "jd_body": string,
  "deadline_at": string | null,          // ISO 8601 timestamp
  "posted_at": string | null,             // ISO 8601 timestamp
  "work_model": "remote" | "hybrid" | "onsite" | "unspecified",
  "target_year": number | null,           // year the internship occurs, e.g. 2027
  "target_season": "summer" | "fall" | "winter" | "spring",
  "class_year_tag": "freshman_ok" | "sophomore_ok" | "junior_plus" | "unspecified",
  "class_year_confidence": number,        // 0.0 - 1.0
  "compensation_text": string | null,     // verbatim comp text like "$50/hr + housing"
  "compensation_hourly_cents": number | null,  // sortable hourly rate in cents; convert monthly/annual using 40hr/wk * 4.33wk/mo * 12mo/yr (≈2080hr/yr)
  "overall_confidence": number,            // 0.0 - 1.0
  "notes": string                          // 1 sentence: what was clear/unclear, internal only
}

Rules:
- jd_body: clean plain text of the job description. Strip HTML, preserve paragraphs and bullet points. If you don't know the body, return empty string.
- company: the hiring organization. Prefer JSON-LD hiringOrganization.name. If extracted from a URL hostname or path, capitalize properly (e.g., "anthropic" → "Anthropic").
- title: role title only, no company name. e.g. "Software Engineer Intern" not "Anthropic - Software Engineer Intern".
- location_text: brief human-readable location. "Remote", "San Francisco, CA", "Remote · San Francisco" for hybrid with HQ.
- class_year_tag: who can apply (NOT the company's preference). "rising junior" or "must be junior" → junior_plus. "open to all class years" → freshman_ok. If unstated, unspecified.
- target_year: the year the internship runs. "Summer 2027 SWE Intern" → 2027. If unstated, null.
- target_season: "summer" if unstated (most common).
- work_model: only if clearly stated. "Remote" / "Hybrid" / "On-site"/"In-office" → matching value. Else unspecified. "No remote" or "must be on-site" → onsite, not remote.
- deadline_at and posted_at: use ISO 8601. If only a date, use YYYY-MM-DDT00:00:00Z. If the value is relative ("posted 2 weeks ago"), do your best.
- compensation_text: verbatim shorthand if present. compensation_hourly_cents: convert to hourly cents if possible. "$50/hr" → 5000. "$8000/mo" → ~4615 (8000*100 / 173.33). "$80k/yr" → ~3846 (80000*100 / 2080).
- confidence: be honest. If you're guessing, lower the score. If a field is null/unspecified, confidence should reflect that you don't know.
- If the evidence is too sparse to extract anything meaningful, return mostly nulls with overall_confidence near 0.

DO NOT fabricate. Prefer null over a wrong guess.`;

export interface ExtractJobInput {
  url: string;
  htmlExcerpt?: string;
  jsonLd?: unknown;
  perBoardHints?: {
    company?: string | null;
    title?: string | null;
    location?: string | null;
    jd_body?: string;
  };
  userPastedJdBody?: string;
}

const MAX_HTML_CHARS = 12000;
const MAX_BODY_CHARS = 8000;

/**
 * Extract a fully-structured job posting via Sonnet. Always resolves; returns
 * safe defaults on any failure. Caller should check overall_confidence and
 * mark missing fields for user editing.
 */
export async function extractJobFromEvidence(
  input: ExtractJobInput
): Promise<ExtractedJob> {
  // Build the prompt context: most useful evidence first
  const sections: string[] = [];
  sections.push(`URL: ${input.url}`);

  if (input.jsonLd) {
    sections.push(
      `JSON-LD structured data (most authoritative):\n${JSON.stringify(input.jsonLd, null, 2).slice(0, 4000)}`
    );
  }

  if (input.userPastedJdBody) {
    sections.push(
      `User-pasted JD body (authoritative if present):\n${input.userPastedJdBody.slice(0, MAX_BODY_CHARS)}`
    );
  }

  if (input.perBoardHints) {
    const hints = Object.entries(input.perBoardHints)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `  ${k}: ${typeof v === "string" ? v.slice(0, 500) : v}`)
      .join("\n");
    if (hints) sections.push(`Per-board parser hints:\n${hints}`);
  }

  if (input.htmlExcerpt) {
    sections.push(
      `Rendered HTML excerpt (last resort):\n${input.htmlExcerpt.slice(0, MAX_HTML_CHARS)}`
    );
  }

  if (sections.length === 1) {
    // Only the URL is known — can't extract much
    return {
      ...SAFE_DEFAULT,
      jd_url: input.url,
      notes: "only URL available; nothing to extract",
    };
  }

  try {
    const response = await anthropic().messages.create({
      model: HAIKU_MODEL,
      max_tokens: 2000,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: sections.join("\n\n---\n\n"),
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { ...SAFE_DEFAULT, jd_url: input.url, notes: "no text block" };
    }

    const raw = textBlock.text.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { ...SAFE_DEFAULT, jd_url: input.url, notes: "no JSON found" };
    }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    return {
      company: typeof parsed.company === "string" ? parsed.company.trim() || null : null,
      title: typeof parsed.title === "string" ? parsed.title.trim() || null : null,
      location_text:
        typeof parsed.location_text === "string"
          ? parsed.location_text.trim() || null
          : null,
      jd_body: typeof parsed.jd_body === "string" ? parsed.jd_body : "",
      jd_url: input.url,
      deadline_at: parseIsoDate(parsed.deadline_at),
      posted_at: parseIsoDate(parsed.posted_at),
      work_model: WORK_MODEL_VALUES.has(parsed.work_model as string)
        ? (parsed.work_model as WorkModel)
        : "unspecified",
      target_year: parseTargetYear(parsed.target_year),
      target_season: TARGET_SEASON_VALUES.has(parsed.target_season as string)
        ? (parsed.target_season as TargetSeason)
        : "summer",
      class_year_tag: CLASS_YEAR_VALUES.has(parsed.class_year_tag as string)
        ? (parsed.class_year_tag as ClassYearTag)
        : "unspecified",
      class_year_confidence: parseConfidence(parsed.class_year_confidence),
      compensation_text:
        typeof parsed.compensation_text === "string"
          ? parsed.compensation_text.trim() || null
          : null,
      compensation_hourly_cents:
        typeof parsed.compensation_hourly_cents === "number" &&
        Number.isFinite(parsed.compensation_hourly_cents) &&
        parsed.compensation_hourly_cents > 0
          ? Math.round(parsed.compensation_hourly_cents)
          : null,
      overall_confidence: parseConfidence(parsed.overall_confidence),
      notes: typeof parsed.notes === "string" ? parsed.notes : "",
    };
  } catch (err) {
    return {
      ...SAFE_DEFAULT,
      jd_url: input.url,
      notes: err instanceof Error ? err.message : "extract error",
    };
  }
}

function parseIsoDate(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function parseTargetYear(v: unknown): number | null {
  if (typeof v !== "number") return null;
  if (!Number.isInteger(v) || v < 2024 || v > 2032) return null;
  return v;
}

function parseConfidence(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}
