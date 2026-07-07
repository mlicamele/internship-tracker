// Fetch + filter for the vanshb03/Summer2027-Internships upstream list.
//
// Upstream shape (per row):
//   {
//     id: string (UUID, stable dedup key),
//     url: string,
//     company_name: string,
//     title: string,
//     locations: string[],
//     season: "Summer" | "Fall" | "Winter" | "Spring",
//     active: boolean,
//     is_visible: boolean,
//     sponsorship: string,
//     date_posted: number (unix seconds),
//     date_updated: number (unix seconds),
//     source: string,
//     company_url: string,
//   }
//
// Filters applied at ingest time:
//   season === "Summer"    (the app is for SS27; other seasons are noise)
//   active === true        (skip closed postings)
//   is_visible === true    (upstream hides some rows deliberately)
//
// Never throws — returns { rows, skipped, warnings } so the caller can log.

const LISTINGS_URL =
  "https://raw.githubusercontent.com/vanshb03/Summer2027-Internships/refs/heads/dev/.github/scripts/listings.json";

const FETCH_TIMEOUT_MS = 20_000;

export interface SimplifyRow {
  id: string;
  url: string;
  company_name: string;
  title: string;
  locations: string[];
  season: string;
  active: boolean;
  is_visible: boolean;
  date_posted: number | null;
  date_updated: number | null;
  sponsorship: string | null;
}

export interface FetchResult {
  rows: SimplifyRow[];
  fetched: number;
  filtered_out: number;
  skipped_malformed: number;
  warnings: string[];
}

/**
 * Fetch + filter. Requires no auth. Fails loud on network / parse errors
 * (the cron handler catches and reports). Skips (doesn't throw on)
 * individual malformed rows.
 */
export async function fetchSimplifySummerListings(
  overrideUrl?: string
): Promise<FetchResult> {
  const res = await fetch(overrideUrl ?? LISTINGS_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(
      `Simplify listings fetch failed: ${res.status} ${res.statusText}`
    );
  }
  const raw = await res.json();
  if (!Array.isArray(raw)) {
    throw new Error("Simplify listings: expected JSON array at root");
  }

  const rows: SimplifyRow[] = [];
  const warnings: string[] = [];
  let filtered_out = 0;
  let skipped_malformed = 0;

  for (const item of raw) {
    if (!item || typeof item !== "object") {
      skipped_malformed++;
      continue;
    }
    const r = item as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id.trim() : "";
    const url = typeof r.url === "string" ? r.url.trim() : "";
    const company_name =
      typeof r.company_name === "string" ? r.company_name.trim() : "";
    const title = typeof r.title === "string" ? r.title.trim() : "";
    const season = typeof r.season === "string" ? r.season : "";
    const active = r.active === true;
    const is_visible = r.is_visible === true;
    const locations = Array.isArray(r.locations)
      ? r.locations.filter((l): l is string => typeof l === "string" && !!l.trim())
      : [];
    const date_posted =
      typeof r.date_posted === "number" && Number.isFinite(r.date_posted)
        ? r.date_posted
        : null;
    const date_updated =
      typeof r.date_updated === "number" && Number.isFinite(r.date_updated)
        ? r.date_updated
        : null;
    const sponsorship =
      typeof r.sponsorship === "string" ? r.sponsorship : null;

    if (!id || !url || !company_name) {
      skipped_malformed++;
      if (warnings.length < 5) {
        warnings.push(
          `malformed row: id=${id || "?"} url=${url || "?"} company=${company_name || "?"}`
        );
      }
      continue;
    }

    if (season !== "Summer" || !active || !is_visible) {
      filtered_out++;
      continue;
    }

    rows.push({
      id,
      url,
      company_name,
      title: title || "Untitled role",
      locations,
      season,
      active,
      is_visible,
      date_posted,
      date_updated,
      sponsorship,
    });
  }

  return {
    rows,
    fetched: raw.length,
    filtered_out,
    skipped_malformed,
    warnings,
  };
}
