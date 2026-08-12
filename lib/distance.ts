// Weighted nearest-destination distance for roles that can have multiple
// locations against user profiles that may eventually have multiple
// preferred destinations with weights.

import { haversineMiles, type LatLng } from "./geocode";
import type { RoleLocation } from "./db/types";

export interface WeightedDestination extends LatLng {
  /** Relative weight in (0, 1]. Higher = matters more. */
  weight: number;
}

/**
 * Sort a role's locations so the closest to `home` comes first. Locations
 * without geocoded coords are placed at the end (order-stable among themselves).
 * Non-mutating — returns a new array. Safe to call with no home coords or
 * an empty locations array.
 *
 * Used at server render time so the pipeline / inbox cells that display
 * only `locations[0]` show the location the user actually cares about
 * most (their nearest office) — not whatever order the LLM emitted or
 * the DB happened to store.
 */
export function sortLocationsByDistance(
  locations: RoleLocation[],
  home: LatLng | null
): RoleLocation[] {
  if (!home || locations.length <= 1) return locations;
  return [...locations].sort((a, b) => {
    const aGeo = a.lat != null && a.lng != null;
    const bGeo = b.lat != null && b.lng != null;
    if (!aGeo && !bGeo) return 0;
    if (!aGeo) return 1;
    if (!bGeo) return -1;
    const da = haversineMiles({ lat: a.lat!, lng: a.lng! }, home);
    const db = haversineMiles({ lat: b.lat!, lng: b.lng! }, home);
    return da - db;
  });
}

/**
 * For each preferred destination, find the closest of the role's locations.
 * Return a weighted-average distance (weighted by destination weights).
 *
 * Today the profile has a single home → one destination with weight 1, and
 * this collapses to "distance to the role's closest location from home." When
 * we add multiple weighted destinations to the profile later, the same
 * function generalizes without changes at call sites.
 *
 * Returns null if no role locations are geocoded or no destinations supplied.
 */
export function weightedNearestDistance(
  roleLocations: RoleLocation[],
  destinations: WeightedDestination[]
): number | null {
  const geocoded = roleLocations.filter(
    (l): l is RoleLocation & { lat: number; lng: number } =>
      l.lat != null && l.lng != null
  );
  if (geocoded.length === 0) return null;

  const active = destinations.filter((d) => d.weight > 0);
  if (active.length === 0) return null;

  let weightedSum = 0;
  let totalWeight = 0;
  for (const dest of active) {
    let minDist = Infinity;
    for (const loc of geocoded) {
      const d = haversineMiles(
        { lat: loc.lat, lng: loc.lng },
        { lat: dest.lat, lng: dest.lng }
      );
      if (d < minDist) minDist = d;
    }
    weightedSum += minDist * dest.weight;
    totalWeight += dest.weight;
  }
  return weightedSum / totalWeight;
}
