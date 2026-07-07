// Shared tag vocabulary. The same list is offered to the user in the
// interests picker (onboarding / settings) AND to the LLM as the closed
// set of tags it may apply to a role. Keeping a single source guarantees
// that interest-fit overlap is meaningful — no vocabulary mismatch.
//
// Adding a tag is safe and additive. Removing a tag would orphan it on
// existing profiles + role.tags rows — leave deprecated tags here with
// a comment if we ever want to retire one in a later version.
//
// Order within a group is deliberate (broad → specific). Groups are for
// readability only; the exported list is flat.

export const INTEREST_TAGS = [
  // Engineering
  "SWE",
  "Web/Frontend",
  "Backend/Systems",
  "Full-Stack",
  "Mobile",
  "Distributed Systems",
  "Databases",
  "Cloud Infrastructure",
  "DevOps/SRE",
  "Embedded Systems",
  "Platform Engineering",
  "DevTools",

  // ML / AI
  "ML/AI",
  "NLP",
  "Computer Vision",
  "LLMs",

  // Data
  "Data",
  "Data Engineering",
  "Data Science",
  "Analytics",

  // Finance / Quant
  "Quant",
  "Algorithmic Trading",
  "Fintech",

  // Security
  "Security",
  "Cryptography",

  // Robotics / Hardware
  "Robotics",
  "Hardware",

  // HCI / Design
  "HCI",
  "UX Research",
  "Product Design",

  // Web3
  "Crypto",
  "Web3",

  // Domain / Industry
  "Healthtech",
  "Biotech",
  "Gaming",
  "Sports Analytics",
  "Climate/Energy",
  "Defense/Aerospace",
  "Consumer",
  "Enterprise SaaS",

  // Research
  "Research",
] as const;

export type InterestTag = (typeof INTEREST_TAGS)[number];

/** Convenience set for O(1) membership checks. */
export const INTEREST_TAG_SET: ReadonlySet<string> = new Set(INTEREST_TAGS);

export function isInterestTag(value: string): value is InterestTag {
  return INTEREST_TAG_SET.has(value);
}

/** Filter an arbitrary string[] down to valid, unique tags in canonical order. */
export function normalizeTags(raw: readonly string[]): InterestTag[] {
  const seen = new Set<string>();
  const out: InterestTag[] = [];
  for (const tag of raw) {
    if (!isInterestTag(tag)) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}
