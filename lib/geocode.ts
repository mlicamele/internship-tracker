// Geocoding via Nominatim (OpenStreetMap).
//
// Free-tier ToS: max 1 request/sec, real User-Agent required, no
// commercial use. Fine for solo-user v1; if usage spikes or this
// gets shared widely, upgrade to Mapbox dev tier (100k geocodes/mo
// free) — same interface, just swap the fetcher.

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const MIN_REQUEST_INTERVAL_MS = 1500; // a bit above 1s for safety

export interface LatLng {
  lat: number;
  lng: number;
}

// Module-scoped in-memory cache. Cleared on server restart, which is
// fine — Phase 1 also persists geocoded addresses on profiles.home_lat/lng,
// so repeated lookups of the same user's address never re-hit Nominatim.
const cache = new Map<string, LatLng | null>();
let lastRequestAt = 0;

async function throttle() {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_REQUEST_INTERVAL_MS - elapsed));
  }
  lastRequestAt = Date.now();
}

/**
 * Terms that should NEVER be geocoded because they describe a *work mode*,
 * not a place. Without this, Nominatim happily maps "Remote" → Remote, OR
 * (pop. ~1 in Coos County), and distance sort gets meaningless.
 */
const VIRTUAL_LOCATION_TERMS = new Set([
  "remote",
  "anywhere",
  "distributed",
  "virtual",
  "us remote",
  "usa remote",
  "remote (us)",
  "remote us",
  "worldwide",
  "global",
  "flexible",
  "hybrid",
  "onsite",
  "on-site",
  "in-office",
  "tbd",
  "multiple locations",
  "various",
  "various locations",
  "any location",
]);

/**
 * Keywords that indicate the string is a TEAM / DEPT / ROLE description,
 * not a geographic location. LLM occasionally emits these when the JD lists
 * team assignments alongside offices ("Ethics Team", "Trading Engineering",
 * "US Government Solutions"). Nominatim happily codes these to real places
 * (e.g. "Ethics Team" → some village), silently breaking distance.
 *
 * We only reject when a team-token is present AND the string lacks
 * location-y structure (comma, state code, country name). That way
 * a real "New York Research Office" or "Bengaluru, Karnataka" still passes,
 * but bare "Ethics Team" doesn't.
 */
const NON_PLACE_TOKENS = [
  " team",
  "department",
  " dept",
  " division",
  " group ",
  " engineering",
  " operations",
  " research",
  " trading",
  " solutions",
  " practice",
  " unit",
  " function",
];

/**
 * Country names that mark a bare (no-comma) string as a real place.
 * Deliberately omits "US"/"USA" — those are too common in team names
 * ("US Government Solutions", "USA Sales") to be reliable hints. Real
 * US locations almost always have a state code or comma anyway.
 */
const LOCATION_HINT = /\b(uk|canada|india|singapore|germany|france|australia|japan|china|brazil|mexico|spain|italy|netherlands|switzerland|ireland|israel)\b/;

/** Trailing 2-letter US state code like ", CA" or " CA". */
const US_STATE_SUFFIX = /(?:,|\s)[a-z]{2}\s*$/;

export function looksLikeNonPlace(address: string): boolean {
  const padded = ` ${address.toLowerCase()} `;
  const hasTeamToken = NON_PLACE_TOKENS.some((t) => padded.includes(t));
  if (!hasTeamToken) return false;
  // Location-y structure = comma, state code, or country name → allow through.
  if (address.includes(",")) return false;
  if (US_STATE_SUFFIX.test(padded)) return false;
  if (LOCATION_HINT.test(padded)) return false;
  return true;
}

/** Geocode a free-form address string. Returns null if no match or if
 *  the string is a work-mode / team-name / dept-name (not a real place). */
export async function geocode(address: string): Promise<LatLng | null> {
  const key = address.trim().toLowerCase();
  if (!key) return null;
  if (VIRTUAL_LOCATION_TERMS.has(key)) return null;
  if (looksLikeNonPlace(key)) return null;
  if (cache.has(key)) return cache.get(key) ?? null;

  const userAgent = process.env.NOMINATIM_USER_AGENT;
  if (!userAgent) {
    throw new Error(
      "NOMINATIM_USER_AGENT env var is required for geocoding (see .env.example)."
    );
  }

  await throttle();

  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(address)}&format=json&limit=1`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": userAgent,
        "Accept-Language": "en-US,en",
      },
    });
  } catch (err) {
    // Network error — Nominatim unreachable. Log so we notice full-service
    // outages (same silent-fail class as the Scout 404 was).
    console.warn(
      `[nominatim-network-error] address="${address}" err=${
        err instanceof Error ? err.message : String(err)
      }`
    );
    cache.set(key, null);
    return null;
  }

  if (!res.ok) {
    // 429 / 5xx / 403 → Nominatim throttling or refusing us. Distinct from
    // 404-ish empty-results (which we handle silently below via empty array).
    console.warn(
      `[nominatim-http-error] status=${res.status} address="${address}"`
    );
    cache.set(key, null);
    return null;
  }

  const results = (await res.json()) as Array<{ lat: string; lon: string }>;
  if (!results || results.length === 0) {
    cache.set(key, null);
    return null;
  }

  const result: LatLng = {
    lat: parseFloat(results[0].lat),
    lng: parseFloat(results[0].lon),
  };
  cache.set(key, result);
  return result;
}

/**
 * Great-circle distance between two lat/lng points, in miles.
 * Uses the haversine formula — accurate to ~0.5% over typical distances.
 */
export function haversineMiles(a: LatLng, b: LatLng): number {
  const EARTH_RADIUS_MILES = 3958.8;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}
