// Pure regex extractors that run over a JD body (or any text blob) to pull
// out structured fields. Used by both the scrape library (lib/scrape/url.ts)
// and the user-pasted JD body path in the new-application server action.
//
// All extractors are lenient: they return null/unspecified on miss, never throw.

import type { TargetSeason, WorkModel } from "@/lib/db/types";
import { parseCompensation } from "@/lib/comp/parse";

const SEASON_RE = /\b(summer|fall|autumn|winter|spring)\s+(20\d{2})\b/i;

/** Extract a deadline ISO timestamp, or null. */
export function extractDeadline(text: string): string | null {
  if (!text) return null;

  // Pattern variants — first match wins
  const patterns: RegExp[] = [
    /\bapply\s+by\s+([^.\n]{3,40})/i,
    /\b(?:deadline|due)\s*[:\-]?\s+([^.\n]{3,40})/i,
    /\bapplications?\s+(?:close|due)\s+(?:by|on)?\s+([^.\n]{3,40})/i,
    /\b(?:close|closes|closing)\s+(?:on)?\s+([^.\n]{3,40})/i,
  ];

  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const parsed = tryParseLooseDate(m[1]);
      if (parsed) return parsed;
    }
  }

  // Last resort: ISO date 20YY-MM-DD
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return `${iso[1]}T00:00:00Z`;

  return null;
}

/** Extract a posted date ISO timestamp, or null. */
export function extractPostedDate(text: string): string | null {
  if (!text) return null;
  const m = text.match(/\bposted\s+(?:on)?\s+([^.\n]{3,40})/i);
  if (m) {
    const parsed = tryParseLooseDate(m[1]);
    if (parsed) return parsed;
  }
  return null;
}

function tryParseLooseDate(raw: string): string | null {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const d = new Date(cleaned);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Extract work model from JD body. */
export function extractWorkModel(text: string): WorkModel {
  if (!text) return "unspecified";

  // Negation first — "no remote" / "not remote" / "in-office only" should not match remote
  const negatedRemote = /\b(?:no|not)\s+remote\b/i.test(text);

  if (!negatedRemote && /\bfully\s+remote\b/i.test(text)) return "remote";
  if (/\bhybrid\b/i.test(text)) return "hybrid";
  if (/\b(?:in[\s-]?office|on[\s-]?site|in[\s-]?person)\b/i.test(text)) {
    return "onsite";
  }
  if (!negatedRemote && /\bremote\b/i.test(text)) return "remote";

  return "unspecified";
}

/** Extract target year + season. */
export function extractTargetTerm(text: string): {
  year: number | null;
  season: TargetSeason | null;
} {
  if (!text) return { year: null, season: null };

  const m = text.match(SEASON_RE);
  if (m) {
    let season: TargetSeason = "summer";
    const tag = m[1].toLowerCase();
    if (tag === "summer") season = "summer";
    else if (tag === "fall" || tag === "autumn") season = "fall";
    else if (tag === "winter") season = "winter";
    else if (tag === "spring") season = "spring";
    const year = parseInt(m[2], 10);
    return { year: Number.isFinite(year) ? year : null, season };
  }

  return { year: null, season: null };
}

/** Extract first plausible compensation phrase. Delegates to lib/comp/parse. */
export function extractCompensation(text: string): {
  text: string | null;
  hourlyCents: number | null;
} {
  if (!text) return { text: null, hourlyCents: null };

  // Grab any phrase containing a dollar sign + a comp marker
  // (e.g. "$50/hr", "$80k/year", "$8000 per month", "$X stipend")
  const candidates = text.match(
    /\$[\d.,]+\s?[a-zA-Z]?\s?(?:\/|per\s)?\s?(?:hr|hour|mo|month|yr|year|annum|k|stipend|total)\b[^.\n]{0,40}/gi
  );
  if (!candidates) return { text: null, hourlyCents: null };

  for (const candidate of candidates) {
    const parsed = parseCompensation(candidate);
    if (parsed.matched) {
      return { text: candidate.trim(), hourlyCents: parsed.hourlyCents };
    }
  }

  return { text: null, hourlyCents: null };
}

/** Convenience: run all extractors and return a merged partial role-shaped object. */
export interface BodyExtractions {
  deadline_at: string | null;
  posted_at: string | null;
  work_model: WorkModel;
  target_year: number | null;
  target_season: TargetSeason | null;
  compensation_text: string | null;
  compensation_hourly_cents: number | null;
}

export function extractAll(text: string): BodyExtractions {
  const term = extractTargetTerm(text);
  const comp = extractCompensation(text);
  return {
    deadline_at: extractDeadline(text),
    posted_at: extractPostedDate(text),
    work_model: extractWorkModel(text),
    target_year: term.year,
    target_season: term.season,
    compensation_text: comp.text,
    compensation_hourly_cents: comp.hourlyCents,
  };
}
