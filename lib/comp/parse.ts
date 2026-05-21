// Compensation text → sortable hourly cents.
//
// Returns matched=false when the text doesn't look like comp at all (or is
// non-monetary like "free housing"). Callers should still store the raw text
// in `roles.compensation_text` even when matched=false; only the sortable
// `roles.compensation_hourly_cents` is conditional.
//
// Conversion assumptions:
//   - 40 hr/week × 4.333 weeks/month = 173.32 hr/month
//   - 2080 hr/year (40 × 52)
//
// We deliberately do NOT match bare "$N" without a comp marker (e.g. /hr,
// /mo, /yr, k, stipend) to avoid false positives like "$80 budget for food".

export interface ParsedComp {
  hourlyCents: number | null;
  matched: boolean;
}

const HOURS_PER_MONTH = 40 * (52 / 12); // 173.33
const HOURS_PER_YEAR = 2080;

function dollarsToHourlyCentsFromAnnual(dollars: number): number {
  return Math.round((dollars * 100) / HOURS_PER_YEAR);
}

function dollarsToHourlyCentsFromMonthly(dollars: number): number {
  return Math.round((dollars * 100) / HOURS_PER_MONTH);
}

function parseDollarNumber(raw: string): number | null {
  const cleaned = raw.replace(/[,\s$]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Parse compensation text into an hourly-cents value for sortable display. */
export function parseCompensation(input: string): ParsedComp {
  const text = input.trim();
  if (!text) return { hourlyCents: null, matched: false };

  // 1. Hourly range: "$45-$55/hr" or "$45 - $55 per hour" → midpoint
  const hourlyRange = text.match(
    /\$\s?(\d+(?:\.\d+)?)\s?[-–to]+\s?\$?\s?(\d+(?:\.\d+)?)\s?(?:\/|\sper\s)\s?(?:hr|hour|h)\b/i
  );
  if (hourlyRange) {
    const lo = parseDollarNumber(hourlyRange[1]);
    const hi = parseDollarNumber(hourlyRange[2]);
    if (lo !== null && hi !== null) {
      const mid = (lo + hi) / 2;
      return { hourlyCents: Math.round(mid * 100), matched: true };
    }
  }

  // 2. Hourly single: "$50/hr", "$50 per hour", "$50/h"
  const hourly = text.match(
    /\$\s?(\d+(?:\.\d+)?)\s?(?:\/|\sper\s)\s?(?:hr|hour|h)\b/i
  );
  if (hourly) {
    const n = parseDollarNumber(hourly[1]);
    if (n !== null) return { hourlyCents: Math.round(n * 100), matched: true };
  }

  // 3. Monthly: "$8000/mo", "$8,000 per month"
  const monthly = text.match(
    /\$\s?(\d+(?:,\d{3})*(?:\.\d+)?)\s?(?:\/|\sper\s)\s?(?:mo|month)\b/i
  );
  if (monthly) {
    const n = parseDollarNumber(monthly[1]);
    if (n !== null) return { hourlyCents: dollarsToHourlyCentsFromMonthly(n), matched: true };
  }

  // 4. Annual explicit: "$80,000 per year", "$80,000/yr"
  const annual = text.match(
    /\$\s?(\d+(?:,\d{3})*(?:\.\d+)?)\s?(?:\/|\sper\s)\s?(?:yr|year|annum)\b/i
  );
  if (annual) {
    const n = parseDollarNumber(annual[1]);
    if (n !== null) return { hourlyCents: dollarsToHourlyCentsFromAnnual(n), matched: true };
  }

  // 5. K-shorthand annual: "$80k", "$80K/yr", "$80k base"
  const kShorthand = text.match(/\$\s?(\d+(?:\.\d+)?)\s?k\b/i);
  if (kShorthand) {
    const n = parseDollarNumber(kShorthand[1]);
    if (n !== null) {
      return { hourlyCents: dollarsToHourlyCentsFromAnnual(n * 1000), matched: true };
    }
  }

  // 6. Explicit stipend / total — store text only, no hourly equivalent
  if (/\$\s?\d/.test(text) && /\b(?:stipend|total|relocation|signing|bonus|housing)\b/i.test(text)) {
    return { hourlyCents: null, matched: true };
  }

  return { hourlyCents: null, matched: false };
}
