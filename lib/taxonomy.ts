// Tech-focused interest tags surfaced in onboarding and used as the
// vocabulary for the fit-score interest-overlap term in lib/scoring/fit.ts.
//
// Adding a tag is safe and additive. Removing a tag would orphan it on
// existing profiles — leave deprecated tags here with a comment if we
// ever want to retire one in a later version.

export const INTEREST_TAGS = [
  "SWE",
  "Web/Frontend",
  "Backend/Systems",
  "Mobile",
  "ML/AI",
  "Quant",
  "Data",
  "DevTools",
  "Security",
  "HCI",
  "Robotics",
  "Hardware",
  "Crypto",
  "Sports Analytics",
  "Research",
] as const;

export type InterestTag = (typeof INTEREST_TAGS)[number];

/** Convenience set for O(1) membership checks. */
export const INTEREST_TAG_SET: ReadonlySet<string> = new Set(INTEREST_TAGS);

export function isInterestTag(value: string): value is InterestTag {
  return INTEREST_TAG_SET.has(value);
}
