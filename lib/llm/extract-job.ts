// Groq-backed job extractor (Llama 3.3 70B Versatile). Free tier on Groq
// is generous (30 RPM, 14400/day) and the model is strong at structured
// JSON extraction. No Google Cloud billing rabbit hole.
//
// Never throws — returns safe defaults on any error.

import Groq from "groq-sdk";
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

const SYSTEM_PROMPT = `You extract structured fields from a job/internship posting for an undergrad applicant.

You receive a mix of evidence: rendered HTML excerpts, JSON-LD structured data, per-board parser hints, optionally a user-pasted JD body. Synthesize all of it.

OUTPUT STRICT JSON ONLY — no markdown, no prose, no code fence. Match this exact schema:

{
  "company": string | null,
  "title": string | null,
  "location_text": string | null,
  "jd_body": string,
  "deadline_at": string | null,           // ISO 8601 like "2026-06-15T00:00:00Z"
  "posted_at": string | null,             // ISO 8601
  "work_model": "remote" | "hybrid" | "onsite" | "unspecified",
  "target_year": integer | null,           // e.g. 2027
  "target_season": "summer" | "fall" | "winter" | "spring",
  "class_year_tag": "freshman_ok" | "sophomore_ok" | "junior_plus" | "unspecified",
  "class_year_confidence": number,         // 0.0 - 1.0
  "compensation_text": string | null,      // verbatim like "$50/hr + housing"
  "compensation_hourly_cents": integer | null,
  "overall_confidence": number,            // 0.0 - 1.0
  "notes": string                          // 1 sentence internal-only summary
}

Rules:
- company: hiring organization name. Prefer JSON-LD hiringOrganization.name. Capitalize properly ("anthropic" → "Anthropic"). NOT the job board name.
- title: role title only, no company prefix. "Software Engineer Intern" not "Anthropic - SWE Intern".
- location_text: brief human-readable. "Remote", "San Francisco, CA", "Remote · NYC" for hybrid.
- jd_body: clean plain text. Strip HTML. Preserve paragraphs + bullets. Empty string if unknown.
- class_year_tag: who CAN apply (not company preference). "rising junior" or "must be junior" → junior_plus. "open to all class years" → freshman_ok. Unstated → unspecified.
- target_year: year the internship runs. "Summer 2027 SWE Intern" → 2027. Null if unstated.
- target_season: "summer" default (most common). Only other if explicit.
- work_model: "remote" only if explicitly stated remote (NOT "no remote"). "hybrid" for mixed. "onsite" / "in-office" otherwise. "unspecified" if not mentioned.
- deadline_at / posted_at: ISO 8601 string. Only date → "YYYY-MM-DDT00:00:00Z". Unknown → null.
- compensation_text: verbatim if present. compensation_hourly_cents: hourly cents equivalent. "$50/hr" → 5000. "$8000/mo" ≈ 4615 (8000*100/173.33). "$80k/yr" ≈ 3846 (80000*100/2080).
- confidence: be honest. Null/unspecified fields should lower overall_confidence.
- notes: 1 short sentence for debugging.

DO NOT fabricate. Prefer null over wrong guesses.`;

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
const MODEL = "llama-3.3-70b-versatile";

let _client: Groq | null = null;
function client(): Groq {
  if (!_client) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GROQ_API_KEY missing. Get one free at https://console.groq.com/keys and add to .env.local + Vercel."
      );
    }
    _client = new Groq({ apiKey });
  }
  return _client;
}

export async function extractJobFromEvidence(
  input: ExtractJobInput
): Promise<ExtractedJob> {
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
    return {
      ...SAFE_DEFAULT,
      jd_url: input.url,
      notes: "only URL available; nothing to extract",
    };
  }

  try {
    const completion = await client().chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: sections.join("\n\n---\n\n") },
      ],
      temperature: 0,
      max_tokens: 4000,
      response_format: { type: "json_object" },
    });

    const text = completion.choices[0]?.message?.content;
    if (!text) {
      return { ...SAFE_DEFAULT, jd_url: input.url, notes: "empty response" };
    }

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { ...SAFE_DEFAULT, jd_url: input.url, notes: "no JSON found" };
    }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    return {
      company:
        typeof parsed.company === "string" ? parsed.company.trim() || null : null,
      title:
        typeof parsed.title === "string" ? parsed.title.trim() || null : null,
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
