// Compensation text → hourly dollars (integer).
//
// Converts free-form comp strings ("$50/hr", "$8000/mo", "$80k") into an
// integer hourly-dollar value. Returns matched=false when no monetary
// signal is present — caller decides what to do (typically: leave null).
//
// Conversion assumptions:
//   - 40 hr/week × 4.333 weeks/month = 173.33 hr/month
//   - 2080 hr/year (40 × 52)
//
// We do NOT match bare "$N" without a comp marker to avoid false positives
// like "$80 budget for food".

export interface ParsedComp {
  hourlyDollars: number | null;
  matched: boolean;
}

const HOURS_PER_MONTH = 40 * (52 / 12); // 173.33
const HOURS_PER_YEAR = 2080;

function parseDollarNumber(raw: string): number | null {
  const cleaned = raw.replace(/[,\s$]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Parse compensation text into whole-dollar hourly rate. */
export function parseCompensation(input: string): ParsedComp {
  const text = input.trim();
  if (!text) return { hourlyDollars: null, matched: false };

  // 1. Hourly range: "$45-$55/hr" → midpoint
  const hourlyRange = text.match(
    /\$\s?(\d+(?:\.\d+)?)\s?[-–to]+\s?\$?\s?(\d+(?:\.\d+)?)\s?(?:\/|\sper\s)\s?(?:hr|hour|h)\b/i
  );
  if (hourlyRange) {
    const lo = parseDollarNumber(hourlyRange[1]);
    const hi = parseDollarNumber(hourlyRange[2]);
    if (lo !== null && hi !== null) {
      return { hourlyDollars: Math.round((lo + hi) / 2), matched: true };
    }
  }

  // 2. Hourly single: "$50/hr", "$50 per hour"
  const hourly = text.match(
    /\$\s?(\d+(?:\.\d+)?)\s?(?:\/|\sper\s)\s?(?:hr|hour|h)\b/i
  );
  if (hourly) {
    const n = parseDollarNumber(hourly[1]);
    if (n !== null) return { hourlyDollars: Math.round(n), matched: true };
  }

  // 3. Monthly: "$8000/mo", "$8,000 per month"
  const monthly = text.match(
    /\$\s?(\d+(?:,\d{3})*(?:\.\d+)?)\s?(?:\/|\sper\s)\s?(?:mo|month)\b/i
  );
  if (monthly) {
    const n = parseDollarNumber(monthly[1]);
    if (n !== null) return { hourlyDollars: Math.round(n / HOURS_PER_MONTH), matched: true };
  }

  // 4. Annual explicit: "$80,000 per year", "$80,000/yr"
  const annual = text.match(
    /\$\s?(\d+(?:,\d{3})*(?:\.\d+)?)\s?(?:\/|\sper\s)\s?(?:yr|year|annum)\b/i
  );
  if (annual) {
    const n = parseDollarNumber(annual[1]);
    if (n !== null) return { hourlyDollars: Math.round(n / HOURS_PER_YEAR), matched: true };
  }

  // 5. K-shorthand annual: "$80k"
  const kShorthand = text.match(/\$\s?(\d+(?:\.\d+)?)\s?k\b/i);
  if (kShorthand) {
    const n = parseDollarNumber(kShorthand[1]);
    if (n !== null) {
      return { hourlyDollars: Math.round((n * 1000) / HOURS_PER_YEAR), matched: true };
    }
  }

  return { hourlyDollars: null, matched: false };
}
