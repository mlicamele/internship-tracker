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

/** Geocode a free-form address string. Returns null if no match. */
export async function geocode(address: string): Promise<LatLng | null> {
  const key = address.trim().toLowerCase();
  if (!key) return null;
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
  } catch {
    cache.set(key, null);
    return null;
  }

  if (!res.ok) {
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
