// Company data-access stubs. Implementations land in Phase 2 Track 2-B.

import type { Company } from "./types";

const NOT_IMPLEMENTED = "Not implemented yet — see Phase 2 Track 2-B in the build plan.";

/** Return existing company by normalized name or insert a new one. */
export async function findOrCreate(_name: string): Promise<Company> {
  throw new Error(NOT_IMPLEMENTED);
}

export async function getById(_companyId: string): Promise<Company | null> {
  throw new Error(NOT_IMPLEMENTED);
}

/** Normalize a company name for dedup (lowercase, strip suffixes, trim). */
export function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc\.?|llc|ltd\.?|co\.?|corp\.?|corporation|limited)\b/gi, "")
    .replace(/[,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
