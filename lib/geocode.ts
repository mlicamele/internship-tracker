// Geocoding stubs. Real implementation lands in Phase 1 Track 1-B (Nominatim wrapper).

const NOT_IMPLEMENTED = "Not implemented yet — see Phase 1 Track 1-B in the build plan.";

export interface LatLng {
  lat: number;
  lng: number;
}

/** Geocode a free-form address string. Returns null if no match. */
export async function geocode(_address: string): Promise<LatLng | null> {
  throw new Error(NOT_IMPLEMENTED);
}

/** Great-circle distance between two lat/lng points, in miles. */
export function haversineMiles(_a: LatLng, _b: LatLng): number {
  throw new Error(NOT_IMPLEMENTED);
}
