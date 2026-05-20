// Interest-tag taxonomy. Real list lands in Phase 1 Track 1-B.
// Keep the export type stable; only the array contents change.

export const INTEREST_TAGS: readonly string[] = [];

export type InterestTag = (typeof INTEREST_TAGS)[number];
