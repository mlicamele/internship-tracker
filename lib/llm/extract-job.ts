// Groq-backed job extractor (Llama 4 Scout 17B MoE). MoE architecture
// means only ~17B active params per token → Groq gives it ~50k TPM on
// free tier (5× the 70B versatile cap), so a full harness run fits in
// one minute without rate-limiting. Quality is comparable to 3.3 70B
// for structured JSON extraction.
//
// Never throws — returns safe defaults on any error.

import Groq from "groq-sdk";
import type {
  ConfidenceTier,
  RelocationAssistance,
  TargetSeason,
  WorkModel,
} from "@/lib/db/types";
import { INTEREST_TAGS, normalizeTags } from "@/lib/taxonomy";
import { MODEL_FOR } from "./model";
import {
  serializeGroqCall,
  isRateLimitError,
  parseRateLimit,
  formatRateLimit,
  recordTokenUsage,
} from "./rate-limiter";
import { MODEL_TPD } from "./limits";

export interface ExtractedJob {
  company: string | null;
  title: string | null;
  /** All locations the role is listed for. Coords filled in later by the geocoder, not the LLM. */
  locations: { text: string; lat?: number | null; lng?: number | null }[];
  jd_body: string;
  jd_url: string | null;
  deadline_at: string | null;
  posted_at: string | null;
  work_model: WorkModel | null;
  target_year: number | null;
  /** Null when the JD doesn't state a season. Do NOT default to "summer" — see migration 0018. */
  target_season: TargetSeason | null;
  /** Earliest graduation year still eligible (e.g. "Dec 2027 or later" → 2027). Null if no lower bound. */
  min_grad_year: number | null;
  /** Latest graduation year still eligible (e.g. "rising junior+" for SS27 → 2029). Null if no upper bound. */
  max_grad_year: number | null;
  relocation_assistance: RelocationAssistance | null;
  /** Hourly rate in whole dollars (e.g. 50 for $50/hr). Null if not stated or non-numeric. */
  compensation_hourly_dollars: number | null;
  /** 1-3 semantic tags drawn from lib/taxonomy.ts INTEREST_TAGS. Filtered to valid values before returning. */
  tags: string[];
  /** Per-field confidence tier. Keys mirror the field names. Missing keys = no signal. */
  confidences: Record<string, ConfidenceTier>;
  overall_confidence: number;
  notes: string;
}

const SAFE_DEFAULT: ExtractedJob = {
  company: null,
  title: null,
  locations: [],
  jd_body: "",
  jd_url: null,
  deadline_at: null,
  posted_at: null,
  work_model: null,
  target_year: null,
  target_season: null,
  min_grad_year: null,
  max_grad_year: null,
  relocation_assistance: null,
  compensation_hourly_dollars: null,
  tags: [],
  confidences: {},
  overall_confidence: 0,
  notes: "extraction failed",
};

const TARGET_SEASON_VALUES = new Set(["summer", "fall", "winter", "spring"]);
const WORK_MODEL_VALUES = new Set(["remote", "hybrid", "onsite"]);
const RELOCATION_VALUES = new Set(["provided", "not_provided"]);

const SYSTEM_PROMPT = `You extract structured fields from a job/internship posting for an undergrad applicant.

You receive a mix of evidence: rendered HTML excerpts, JSON-LD structured data, per-board parser hints, optionally a user-pasted JD body. Synthesize all of it.

OUTPUT STRICT JSON ONLY — no markdown, no prose, no code fence. Match this exact schema:

{
  "company": string | null,
  "title": string | null,
  "locations": string[],                   // array of distinct locations the role is listed for
  "jd_body": string,
  "deadline_at": string | null,           // ISO 8601 like "2026-06-15T00:00:00Z"
  "posted_at": string | null,             // ISO 8601
  "work_model": "remote" | "hybrid" | "onsite" | null,
  "target_year": integer | null,           // e.g. 2027
  "target_season": "summer" | "fall" | "winter" | "spring" | null,
  "min_grad_year": integer | null,         // EARLIEST grad year still eligible; null if no lower bound stated
  "max_grad_year": integer | null,         // LATEST grad year still eligible; null if no upper bound stated
  "relocation_assistance": "provided" | "not_provided" | null,
  "compensation_hourly_dollars": integer | null,
  "tags": string[],                        // 0-4 tags from the fixed VOCABULARY below. Empty [] if nothing fits.
  "confidences": {                         // per-field "high" | "medium" | "low". Omit a key entirely if no signal.
    "company": "high"|"medium"|"low",
    "title": "high"|"medium"|"low",
    "locations": "high"|"medium"|"low",
    "deadline_at": "high"|"medium"|"low",
    "posted_at": "high"|"medium"|"low",
    "work_model": "high"|"medium"|"low",
    "target_year": "high"|"medium"|"low",
    "target_season": "high"|"medium"|"low",
    "min_grad_year": "high"|"medium"|"low",
    "max_grad_year": "high"|"medium"|"low",
    "relocation_assistance": "high"|"medium"|"low",
    "compensation_hourly_dollars": "high"|"medium"|"low"
  },
  "overall_confidence": number,            // 0.0 - 1.0
  "notes": string                          // 1 sentence internal-only summary
}

Rules:
- company: hiring organization name. Prefer JSON-LD hiringOrganization.name. Capitalize properly ("anthropic" → "Anthropic"). NOT the job board name.
- title: role title only, no company prefix. "Software Engineer Intern" not "Anthropic - SWE Intern".
- locations: ARRAY of distinct GEOGRAPHIC locations the role is listed for. Each item is a short readable string in "City, State" or "City, Country" format ("San Francisco, CA", "London, UK", "Remote"). When a JD lists multiple cities (common for quant roles, big-tech multi-office postings), include each as a separate array element — do NOT join with semicolons or " · ". Order does not matter. Remote → ["Remote"]. Unknown → [].

  CRITICAL — REJECT non-geographic strings. Do NOT emit team names, department names, division names, or program names as locations. These break downstream geocoding (the app tries to compute distance from home and Nominatim will happily code "Ethics Team" to some random village).
    * BAD (do NOT include): "Ethics Team", "Trading Engineering", "US Government Solutions", "Perception Research", "Data Science Group", "Firmware Division", "Multiple Locations", "TBD", "Various"
    * GOOD: "San Francisco, CA", "New York, NY", "Bengaluru, India", "London, UK", "Remote"
    * If the JD lists BOTH a team AND a city ("Trading Engineering — Chicago, IL"), extract only the CITY: "Chicago, IL".
    * If the JD ONLY has vague team/department labels and no real city, return [] and let the user fill it in.
- jd_body: clean plain text. Strip HTML. Preserve paragraphs + bullets. Empty string if unknown.
- min_grad_year / max_grad_year: STRICT. Two INDEPENDENT eligibility bounds on the candidate's graduation year. Read very carefully — "or later" vs "or earlier" is the difference between min and max, and reversing them silently breaks filtering.

  min_grad_year = the EARLIEST grad year still eligible. Used when the JD says "must not have already graduated" or sets a floor like "graduating in YYYY or later."
    * "Graduating December 2027 or later" → min_grad_year = 2027 (no upper bound mentioned → max_grad_year = null)
    * "Class of 2027 and beyond" → min = 2027
    * "Must not have graduated before May 2026" → min = 2026
    * "We hire candidates graduating after June 2027" → min = 2027 (interpret "after" as inclusive of the stated year)

  max_grad_year = the LATEST grad year still eligible. Used when the JD says "must not be too early in degree" or sets a ceiling like "must graduate by Spring YYYY."
    * "Must be graduating by Spring 2028" → max_grad_year = 2028
    * "Graduating no later than December 2028" → max = 2028
    * "Complete your degree by August 2028 or earlier" → max = 2028  (compound month+year with "or earlier" — the "by" and "or earlier" BOTH point to an UPPER bound)
    * "Expected graduation by May 2028 or before" → max = 2028
    * "Senior only / class of 2028" → max = 2028 (also min = 2028 since closed)
    * "Rising junior+" (with internship target_year=Y) → max = Y + 2 (rising junior in summer Y graduates Y+2)
    * "Rising sophomore+" → max = Y + 3
    * "Rising senior only" → max = Y + 1
    * "Open to all undergraduate years" / "any class year" → both null

  BOTH bounds together:
    * "Class of 2028 or 2029" → min = 2028, max = 2029
    * "Graduating between 2027 and 2029" → min = 2027, max = 2029
    * "Rising sophomore to rising senior" (target_year=Y) → min = Y+1, max = Y+3

  KEY DISCRIMINATOR — read the directional word:
    * "or later" / "and beyond" / "after" / "or beyond" → it's a min_grad_year (LOWER bound)
    * "or earlier" / "by" / "no later than" / "before" → it's a max_grad_year (UPPER bound)
    * "between X and Y" / "class of X or Y" → BOTH bounds; X is min, Y is max

  ADDITIONAL SIGNAL PATTERNS to catch (previously under-extracted):
    * "must be enrolled through [date/year]" → sets max_grad_year to that year (student must not have graduated yet)
    * "must be currently enrolled in a degree program returning to school after the internship" (target_year=Y) → max_grad_year = Y + 1 at minimum (returning student means grad after Y)
    * "expected to graduate in YYYY" → BOTH min and max = YYYY (a specific class year)
    * "graduating [month] YYYY" or "graduates [semester] YYYY" without direction → BOTH min and max = YYYY (specific class year)
    * "graduating spring/fall/summer YYYY" → BOTH = YYYY
    * "penultimate year", "final year" (target_year=Y) → penultimate = grad Y+1; final = grad Y
    * "junior year" (target_year=Y) → grad Y+1
    * "sophomore year" (target_year=Y) → grad Y+2
    * "senior year" (target_year=Y) → grad Y
    * "rising [class]" (target_year=Y): rising sophomore → grad Y+3, rising junior → Y+2, rising senior → Y+1
    * "returning to school after internship" without more specificity (target_year=Y) → max = Y + 1 (at least one more year of school)

  DO NOT INFER from very weak context like "Summer 2027 Intern" title alone, "CS student", or vague seniority. But DO extract when the JD says "returning student", "enrolled through", "expected graduation", "final year", or names a class year — those are legitimate signals. When in doubt between "medium" and "low" confidence: prefer emitting the value with "medium" — the user can revert or edit; null gives them nothing to work with.
- confidences: emit a confidence TIER ONLY for fields where you produced a real, non-null value. If a field is null, omit its key from the confidences object — DO NOT emit any tier (not even "low") for null/missing fields. The confidences object should be SHORTER for thin JDs, not the same length with all "low" values. Three valid values:
    * "high"   — pulled directly from a clearly-labeled structured source (JSON-LD field, board-API field) OR an unambiguous explicit statement in the JD prose
    * "medium" — stated in prose with some interpretation needed (e.g. multiple candidate values, geo-specific pay range, derived from "rising junior" + target_year)
    * "low"    — weak inference. If you would have rated lower than this, return null for the field itself and OMIT the confidence key.
  Concrete: if compensation_hourly_dollars is null, then "compensation_hourly_dollars" MUST NOT appear in confidences. Same for every other field.
- relocation_assistance: does the company SUPPORT the candidate moving for the role?
    * PROVIDED signals — extract "provided":
      - Explicit: "Relocation assistance provided" / "we will help you relocate" / "relocation reimbursement" / "relocation package"
      - Housing: "housing stipend" / "corporate housing" / "housing provided" / "furnished apartment"
      - Visa: "visa sponsorship" / "H1B sponsorship" / "will sponsor work visas" (for U.S. roles this strongly implies willingness to relocate an international hire)
      - Travel: "travel reimbursement to/from the internship" / "one-time relocation stipend"
      - Interns from any location: "we welcome applicants from any location" / "no relocation required" (in an ONSITE role, this implies relocation help)
    * NOT_PROVIDED signals — extract "not_provided":
      - Explicit: "no relocation assistance" / "relocation not provided" / "must arrange own housing"
      - Geographic restriction: "Local candidates only" / "must already reside in [city/state/country]" / "must be able to commute daily to [office]"
      - Work-auth restriction on ONSITE role: "must be authorized to work in [country] without visa sponsorship" implies they won't help international candidates relocate
    * Remote roles where relocation is meaningless → null (not "not_provided" — the field is irrelevant)
    * Not mentioned at all → null
- target_year: year the internship runs. "Summer 2027 SWE Intern" → 2027. Null if unstated.
- target_season: null when the JD/URL does NOT clearly state a season. DO NOT DEFAULT TO "summer" — null is the honest signal that no season was mentioned. Populate ONLY when there is direct evidence:
    * Title/URL contains an explicit season word — "Summer 2027 SWE Intern" → "summer"; "Fall 2026 Co-op" → "fall"; "/careers/spring-2027-internship" URL path → "spring"; "Winter 2025 Externship" → "winter"
    * JD body directly says the program's season — "The 12-week Summer 2027 program runs June-August" → "summer"; "Fall semester internship, September-December" → "fall"
    * Month range that unambiguously indicates a season without any other season claim — "June to August" → "summer"; "September through December" → "fall"; "January-April" → "spring"; "December-February" → "winter"
  Do NOT infer a season from:
    * The company being tech / the role being SWE (weak, no signal)
    * "Internship" alone with no dates
    * A due date / posted date (irrelevant to program season)
    * The fact that summer is common (that's an app-level assumption, not evidence)
  When in doubt: return null. The UI now surfaces null as "—", which is honest and lets the user fix it explicitly.
- work_model: "remote" only if explicitly stated remote (NOT "no remote"). "hybrid" for mixed. "onsite" / "in-office" otherwise. null if not mentioned.
- deadline_at: application close date. ISO 8601 → "YYYY-MM-DDT00:00:00Z". Look HARD for these signals (this field is historically under-extracted):
    * Explicit: "Apply by [date]" / "Application deadline: [date]" / "Applications close [date]" / "Submissions must be received by [date]" / "Deadline to apply: [date]"
    * Framed as "priority" or "rolling": "Priority deadline [date]" (use that date), "Rolling review through [date]" (use that date). If ONLY "rolling" with no date → null.
    * Section headers: "How to Apply", "Application Timeline", "Timeline" often contain the deadline in the paragraph beneath.
    * From JSON-LD: the validThrough field is the canonical deadline — always prefer this when present.
    * Distinguish deadline_at from posted_at — "posted [date]" or JSON-LD datePosted is posted_at, NOT deadline_at.
    * Unknown → null.
- posted_at: date the JD was made public. ISO 8601. From JSON-LD datePosted, board API created_at, or explicit "Posted on [date]" text. Unknown → null.
- compensation_hourly_dollars: whole-dollar hourly rate as an integer. SOURCE RULE: if a "Compensation context" section is provided, use ONLY that section as your source for compensation — do NOT pull dollar figures from the jd_body, htmlExcerpt, or anywhere else. The comp-context windows were extracted specifically because they contain pay-keywords + dollar figures; numbers elsewhere in the page (revenue figures, customer counts, "22+ million customers", market sizes, AUM, etc.) are NOT compensation. If NO Compensation context is provided, then you may fall back to scanning the JD body for explicit pay statements.
  VERIFY relevance: within the Compensation context, check each figure refers to THIS role, not a different one. Same-page sidebars, "Related Openings", "Other Programs", "PEAK6 Trials", residency/founder/fellowship listings, or any pay number tied to a DIFFERENT job title than the one we're extracting → IGNORE. If the context is ambiguous or you can't tell which role the pay applies to, return null.

  PRIORITY when multiple comp figures are present (common — Amazon, Salesforce, etc. list both hourly AND annual ranges):
    1. EXPLICIT PER-HOUR RATE WINS — ALWAYS. If the JD anywhere contains "$X/hour", "$X per hour", "$X-Y/hr", "$X.XX/hr", or similar per-hour figure, use that directly. Do NOT fall back to an annual figure even if both are present. Per-hour beats per-year, every time.
    2. RANGES → MIDPOINT, ALWAYS. Any range ("$X-Y", "$X to Y", "$X–Y") MUST be resolved to the integer midpoint, rounded. Examples: "$19.00-$75.00/hr" → 47. "$0-$50/hr" → 25. "$45-55/hour" → 50. "$90,000-$110,000 annualized" → 48 ($100k/2080). Never pick the low end, never pick the high end, never decline a range just because it's wide.
    3. Else, if the JD EXPLICITLY frames the figure as a TOTAL for the program duration — e.g. "$71,000 for the 8-week internship", "$45,000 total stipend for the 10-week program", "interns are paid $X over the summer", "total compensation for the program is $X" — divide that total by (program_weeks × 40). The program duration MUST be stated in the JD or comp context. If duration is stated but unclear (e.g. "summer internship" with no week count), default to 10 weeks. This is common at quant firms (Bridgewater, Citadel, Jane Street, HRT) where the total summer pay IS the headline number.
    4. Else, treat any bare dollar figure as ANNUALIZED → divide by 2080. Most non-quant internship JDs quote the annualized rate (the rate of pay during the internship, as if for a full year), NOT the summer-total payment. "$95,000" or "$80k" or "Pay range: $90k–$110k" without total-framing → divide by 2080.

  Examples:
    * "$50/hr" → 50
    * "$22.50/hour" → 23 (round to nearest dollar)
    * "$45-55/hr" → 50 (midpoint)
    * "$8000/mo" → 46 (8000 / 173.33)
    * "$80k/yr" or "$80,000/year" → 38 (80000 / 2080)
    * "$71,000" (bare, no qualifier) → 34 (assume annualized: 71000 / 2080)
    * "Annualized: $80,000" → 38
    * "Pay range: $90,000–$110,000 USD" → 48 (midpoint 100000 / 2080, annualized)
    * "Hiring range: $45/hour to $55/hour" → 50
    * "Pacific time zone pay range: $100,000 - $130,000" → 55 (geo-specific range, annualized midpoint)
    * "Base salary: $95k. Total comp: $130k" → 46 (use BASE annualized only)
    * "Pay rate: $30 per hour" → 30
    * "TOTAL stipend of $24,000 for the 10-week summer program" → 60 (explicit total: 24000 / (10*40))
    * "$71,000 for the 8-week internship" → 222 (explicit total wording: 71000 / (8*40))
    * "Exceptionally high compensation" → null (no numeric value)
    * "Competitive" → null
    * Compensation not mentioned → null

  PLAUSIBILITY CHECK (before outputting): a realistic internship hourly rate is $15–$100. Above ~$100 is possible only at top quant firms (Bridgewater, Citadel, Jane Street, Hudson River — cap ~$120). If your answer is >$150, you almost certainly forgot to divide an annualized or total figure. Recheck the arithmetic and rules 3–4 above. If still ambiguous, return null — a wrong number ($444, $520) is worse than a missing one.
- tags: 1-3 semantic tags describing what THIS role IS ABOUT. Typical answer is 1-2; ONE tag is often correct. Drawn ONLY from the closed VOCABULARY below. Do not pad.

  VOCABULARY (only these strings are valid; anything else is dropped):
  ${INTEREST_TAGS.join(", ")}

  RULES:
    * TITLE + COMPANY IS ENOUGH SIGNAL. If the title is clearly a Quant / SWE / ML / Full-Stack / etc. role, TAG IT even when the body is thin, missing, or a careers-index blob. A hedge fund + "Quantitative Developer" is ["Quant", "Fintech"]. Do NOT return [] just because the body is weak. Empty [] is only correct when NEITHER title NOR company gives ANY signal (which is rare — most postings have a role-descriptive title).
    * One ROLE-TYPE tag (SWE / Web/Frontend / Quant / ML/AI / Full-Stack / …) is usually enough. Only add more if the role clearly spans domains.
    * Prefer SPECIFIC over GENERIC. If "Computer Vision" applies, do NOT also add "ML/AI"; "Web/Frontend" alone beats "SWE" + "Web/Frontend".
    * Add ONE INDUSTRY tag only when the company's domain is a strong, defining theme (Recursion → "Biotech", Anduril → "Defense/Aerospace", any hedge fund + Quant role → "Fintech"). Skip industry when not central.
    * "SWE" is the generic catch-all — use ONLY when no more-specific engineering tag applies.
    * "Crypto" = blockchain. "Cryptography" = math / applied cryptography. Different tags.
    * Cap at 3. Do NOT invent tags.

  Examples:
    * "SWE Intern - Backend, Snowflake" → ["Backend/Systems"]
    * "Perception Engineer Intern - Zoox" → ["Computer Vision", "Robotics"]
    * "Quantitative Trader Intern - Citadel" → ["Quant", "Fintech"]
    * "Full-Stack Engineer Intern - Recursion Pharmaceuticals" → ["Full-Stack", "Biotech"]
    * "SWE Intern - Apple" → ["SWE"]
- confidence: be honest. Null/unspecified fields should lower overall_confidence.
- notes: 1 short sentence for debugging.

DO NOT fabricate. Prefer null over wrong guesses.`;

export interface ExtractJobInput {
  url: string;
  htmlExcerpt?: string;
  jsonLd?: unknown;
  perBoardHints?: {
    company?: string | null;
    title?: string | null;
    locations?: string[];
    jd_body?: string;
  };
  userPastedJdBody?: string;
  /** Untruncated windows around pay-keyword matches from the full body. Use this as the AUTHORITATIVE comp source. */
  compensationContext?: string | null;
}

const MAX_HTML_CHARS = 12000;
const MAX_BODY_CHARS = 8000;

let _client: Groq | null = null;
function client(): Groq {
  if (!_client) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GROQ_API_KEY missing. Get one free at https://console.groq.com/keys and add to .env.local + Vercel."
      );
    }
    // maxRetries bumped from SDK default of 2. Combined with the process-wide
    // semaphore in lib/llm/rate-limiter.ts (concurrency=1 + 400ms inter-call
    // gap), this gives us four attempts at transient 429/timeouts before we
    // surface an error. TPD-exhaustion still fails after retries — expected.
    _client = new Groq({ apiKey, maxRetries: 4 });
  }
  return _client;
}

export async function extractJobFromEvidence(
  input: ExtractJobInput
): Promise<ExtractedJob> {
  const sections: string[] = [];
  sections.push(`URL: ${input.url}`);

  if (input.jsonLd) {
    sections.push(
      `JSON-LD structured data (most authoritative):\n${JSON.stringify(input.jsonLd, null, 2).slice(0, 4000)}`
    );
  }

  if (input.userPastedJdBody) {
    sections.push(
      `User-pasted JD body (authoritative if present):\n${input.userPastedJdBody.slice(0, MAX_BODY_CHARS)}`
    );
  }

  if (input.compensationContext) {
    sections.push(
      `Compensation context (pulled from FULL JD body around pay keywords — USE THIS for compensation_hourly_dollars; it may contain pay-disclosure text that was truncated elsewhere):\n${input.compensationContext}`
    );
  }

  if (input.perBoardHints) {
    const hints = Object.entries(input.perBoardHints)
      .filter(([, v]) => {
        if (v === null || v === undefined || v === "") return false;
        if (Array.isArray(v) && v.length === 0) return false;
        return true;
      })
      .map(([k, v]) => {
        if (typeof v === "string") return `  ${k}: ${v.slice(0, 500)}`;
        if (Array.isArray(v)) return `  ${k}: ${v.join(" | ")}`;
        return `  ${k}: ${v}`;
      })
      .join("\n");
    if (hints) sections.push(`Per-board parser hints:\n${hints}`);
  }

  if (input.htmlExcerpt) {
    sections.push(
      `Rendered HTML excerpt (last resort):\n${input.htmlExcerpt.slice(0, MAX_HTML_CHARS)}`
    );
  }

  if (sections.length === 1) {
    return {
      ...SAFE_DEFAULT,
      jd_url: input.url,
      notes: "only URL available; nothing to extract",
    };
  }

  try {
    const completion = await serializeGroqCall(() =>
      client().chat.completions.create({
        model: MODEL_FOR.extraction,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: sections.join("\n\n---\n\n") },
        ],
        temperature: 0,
        max_tokens: 4000,
        response_format: { type: "json_object" },
      })
    );

    // Feed token usage to the tracker so we get an 80%-TPD warning
    // before the next call gets 429'd. Silently no-op if the SDK ever
    // stops returning `.usage`.
    if (completion.usage?.total_tokens) {
      recordTokenUsage(
        MODEL_FOR.extraction,
        completion.usage.total_tokens,
        MODEL_TPD[MODEL_FOR.extraction]
      );
    }

    const text = completion.choices[0]?.message?.content;
    if (!text) {
      return { ...SAFE_DEFAULT, jd_url: input.url, notes: "empty response" };
    }

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { ...SAFE_DEFAULT, jd_url: input.url, notes: "no JSON found" };
    }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    const result: ExtractedJob = {
      company:
        typeof parsed.company === "string" ? parsed.company.trim() || null : null,
      title:
        typeof parsed.title === "string" ? parsed.title.trim() || null : null,
      locations: parseLocations(parsed.locations),
      jd_body: typeof parsed.jd_body === "string" ? parsed.jd_body : "",
      jd_url: input.url,
      deadline_at: parseIsoDate(parsed.deadline_at),
      posted_at: parseIsoDate(parsed.posted_at),
      work_model: WORK_MODEL_VALUES.has(parsed.work_model as string)
        ? (parsed.work_model as WorkModel)
        : null,
      target_year: parseTargetYear(parsed.target_year),
      // Null when the LLM didn't emit a valid season — see migration 0018.
      // The UI renders null as "—" so extraction gaps are visible, not masked.
      target_season: TARGET_SEASON_VALUES.has(parsed.target_season as string)
        ? (parsed.target_season as TargetSeason)
        : null,
      min_grad_year: parseGradYear(parsed.min_grad_year),
      max_grad_year: parseGradYear(parsed.max_grad_year),
      // NOTE: min/max are re-validated below via sanityCheckGradYears
      // after the object is built.
      relocation_assistance: RELOCATION_VALUES.has(
        parsed.relocation_assistance as string
      )
        ? (parsed.relocation_assistance as RelocationAssistance)
        : null,
      // Cap at $300/hr — no internship pays more; anything higher is an LLM
      // arithmetic error (missed divide-by-2080 on annualized figures, etc.).
      compensation_hourly_dollars:
        typeof parsed.compensation_hourly_dollars === "number" &&
        Number.isFinite(parsed.compensation_hourly_dollars) &&
        parsed.compensation_hourly_dollars > 0 &&
        parsed.compensation_hourly_dollars <= 300
          ? Math.round(parsed.compensation_hourly_dollars)
          : null,
      tags: parseTags(parsed.tags),
      confidences: parseConfidencesMap(parsed.confidences),
      overall_confidence: parseConfidence(parsed.overall_confidence),
      notes: typeof parsed.notes === "string" ? parsed.notes : "",
    };

    // Safety net for a specific LLM failure mode: on compound phrases like
    // "by August 2028 or earlier" the model sometimes puts the year in
    // min_grad_year when the "or earlier" / "no later than" / "before"
    // language unambiguously indicates an UPPER bound. Detect and swap.
    sanityCheckGradYears(result);

    // Strip confidence keys for fields that ended up null/default — keeps
    // the badge from appearing on empty values even if the LLM emits "low".
    result.confidences = filterConfidencesToPopulated(result);
    return result;
  } catch (err) {
    if (isRateLimitError(err)) {
      console.warn(
        `[groq-rate-limit] extractJobFromEvidence: ${formatRateLimit(parseRateLimit(err))}`
      );
    }
    return {
      ...SAFE_DEFAULT,
      jd_url: input.url,
      notes: err instanceof Error ? err.message : "extract error",
    };
  }
}

/**
 * Strip per-field confidence entries for any field whose value is null,
 * empty, or otherwise unpopulated. Defensive — the prompt asks the LLM to
 * omit these, but Scout sometimes emits "low" anyway, which would surface
 * a misleading confidence badge in the UI.
 */
function filterConfidencesToPopulated(
  r: ExtractedJob
): Record<string, ConfidenceTier> {
  const populated: Record<string, boolean> = {
    company: r.company !== null,
    title: r.title !== null,
    locations: r.locations.length > 0,
    deadline_at: r.deadline_at !== null,
    posted_at: r.posted_at !== null,
    work_model: r.work_model !== null,
    target_year: r.target_year !== null,
    target_season: r.target_season !== null && r.target_season !== undefined,
    min_grad_year: r.min_grad_year !== null,
    max_grad_year: r.max_grad_year !== null,
    relocation_assistance: r.relocation_assistance !== null,
    compensation_hourly_dollars: r.compensation_hourly_dollars !== null,
    tags: r.tags.length > 0,
  };
  const out: Record<string, ConfidenceTier> = {};
  for (const [k, v] of Object.entries(r.confidences)) {
    if (populated[k]) out[k] = v;
  }
  return out;
}

/** Filter LLM-emitted tags to the closed vocabulary; drop unknowns, dedupe, cap at 3. */
function parseTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const strings: string[] = [];
  for (const item of v) {
    if (typeof item === "string" && item.trim()) strings.push(item.trim());
  }
  return normalizeTags(strings).slice(0, 3);
}

function parseLocations(v: unknown): ExtractedJob["locations"] {
  if (!Array.isArray(v)) return [];
  const out: ExtractedJob["locations"] = [];
  const seen = new Set<string>();
  for (const item of v) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text });
  }
  return out;
}

function parseIsoDate(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function parseTargetYear(v: unknown): number | null {
  if (typeof v !== "number") return null;
  if (!Number.isInteger(v) || v < 2024 || v > 2032) return null;
  return v;
}

function parseGradYear(v: unknown): number | null {
  if (typeof v !== "number") return null;
  if (!Number.isInteger(v) || v < 2024 || v > 2034) return null;
  return v;
}

/**
 * Safety net for a specific LLM failure mode. On compound phrases like
 * "you will complete your degree by August 2028 or earlier", the model
 * sometimes stores the year in min_grad_year even though "or earlier" /
 * "no later than" / "before" unambiguously indicate the UPPER bound.
 *
 * If the JD body contains unambiguous upper-bound language AND the extractor
 * put a value in min_grad_year but LEFT max_grad_year null, swap. Only fires
 * on this specific mismatch — never swaps when both bounds were extracted.
 * Mutates `r` in place.
 *
 * See the CLAUDE.md Lesson: "In JD eligibility text, the directional word
 * is everything".
 */
function sanityCheckGradYears(r: ExtractedJob): void {
  if (r.min_grad_year == null || r.max_grad_year != null) return;
  const body = r.jd_body.toLowerCase();
  const upperBoundSignals = [
    /\bor earlier\b/,
    /\bor before\b/,
    /\bno later than\b/,
    /\bby\s+(january|february|march|april|may|june|july|august|september|october|november|december|spring|summer|fall|winter|q[1-4])?\s*\d{4}\b/,
  ];
  const hasUpperBoundSignal = upperBoundSignals.some((re) => re.test(body));
  if (!hasUpperBoundSignal) return;

  // Also require the OPPOSITE signal is absent — if both "or later" and
  // "or earlier" appear (rare bilateral bounds), the LLM's assignment is
  // trustworthy and we should NOT flip.
  const lowerBoundSignals = [/\bor later\b/, /\band beyond\b/, /\bor after\b/];
  if (lowerBoundSignals.some((re) => re.test(body))) return;

  // Swap.
  r.max_grad_year = r.min_grad_year;
  r.min_grad_year = null;
  // Mirror the confidence key too so the revert-button + badge stay honest.
  if (r.confidences.min_grad_year) {
    r.confidences.max_grad_year = r.confidences.min_grad_year;
    delete r.confidences.min_grad_year;
  }
}

function parseConfidence(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

const TIER_VALUES = new Set<ConfidenceTier>(["high", "medium", "low"]);

function parseConfidencesMap(v: unknown): Record<string, ConfidenceTier> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, ConfidenceTier> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string" && TIER_VALUES.has(val as ConfidenceTier)) {
      out[k] = val as ConfidenceTier;
      continue;
    }
    // Legacy: numeric 0..1. Bucket the same way the migration does.
    if (typeof val === "number" && Number.isFinite(val)) {
      if (val >= 0.85) out[k] = "high";
      else if (val >= 0.6) out[k] = "medium";
      else if (val > 0) out[k] = "low";
    }
  }
  return out;
}

// ============================================================
// Tag-only classifier — used by the backfill script to tag existing
// roles cheaply. Reuses the vocabulary/rules from SYSTEM_PROMPT but
// scoped to a single field for token efficiency.
// ============================================================

const TAGS_SYSTEM_PROMPT = `You classify an internship posting with 1-3 semantic tags from a closed vocabulary. Typical answer is 1-2 tags; ONE tag is often correct. Do not pad.

OUTPUT STRICT JSON ONLY: {"tags": string[]}

VOCABULARY (only these strings are valid; anything else is dropped):
${INTEREST_TAGS.join(", ")}

RULES:
- One ROLE-TYPE tag (SWE / Web/Frontend / Quant / ML/AI / Full-Stack / …) is usually enough. Only add more if the role clearly spans domains.
- Prefer SPECIFIC over GENERIC. If "Computer Vision" applies, do NOT also add "ML/AI"; "Web/Frontend" alone beats "SWE" + "Web/Frontend".
- Add ONE INDUSTRY tag only when the company's domain is a strong, defining theme (Recursion → "Biotech", Anduril → "Defense/Aerospace", any hedge fund + Quant role → "Fintech"). Skip industry when not central — most big-tech roles don't need one.
- "SWE" is the generic catch-all — use ONLY when no more-specific engineering tag applies.
- "Crypto" = blockchain. "Cryptography" = math / applied cryptography. Different tags.
- Cap at 3. Do NOT invent tags.

TITLE + COMPANY IS ENOUGH SIGNAL. If the title is clearly a Quant / SWE / ML / Full-Stack / etc. role, TAG IT even when the body is thin, missing, or off-topic (e.g. the JD body is a careers-index page listing other roles). A hedge fund + "Quantitative Developer" is ["Quant", "Fintech"]. Do NOT return [] just because the body is weak or off-topic. Empty [] is only correct when neither the title nor the company gives ANY signal.

Examples:
- "SWE Intern - Backend, Snowflake" → ["Backend/Systems"]
- "Perception Engineer Intern - Zoox" → ["Computer Vision", "Robotics"]
- "Quantitative Trader Intern - Citadel Securities" → ["Quant", "Fintech"]
- "Quantitative Developer Intern - Cubist" → ["Quant", "Fintech"]
- "SWE Intern - Citadel" → ["SWE", "Fintech"]
- "LLM Post-training Engineer - TikTok" → ["LLMs"]
- "Full-Stack Engineer Intern - Recursion Pharmaceuticals" → ["Full-Stack", "Biotech"]
- "SWE Intern - Apple" → ["SWE"]
- "Firmware Intern - Etched" → ["Embedded Systems"]`;

export interface ClassifyRoleTagsInput {
  company: string | null;
  title: string;
  body: string;
}

/** Classify an existing role by title + body only. Returns [] on error. Never throws. */
export async function classifyRoleTags(
  input: ClassifyRoleTagsInput
): Promise<string[]> {
  const parts: string[] = [];
  if (input.company) parts.push(`Company: ${input.company}`);
  parts.push(`Title: ${input.title}`);
  if (input.body) parts.push(`\nJD body:\n${input.body.slice(0, MAX_BODY_CHARS)}`);
  const user = parts.join("\n");

  try {
    const completion = await serializeGroqCall(() =>
      client().chat.completions.create({
        model: MODEL_FOR.classification,
        messages: [
          { role: "system", content: TAGS_SYSTEM_PROMPT },
          { role: "user", content: user },
        ],
        temperature: 0,
        max_tokens: 200,
        response_format: { type: "json_object" },
      })
    );
    if (completion.usage?.total_tokens) {
      recordTokenUsage(
        MODEL_FOR.classification,
        completion.usage.total_tokens,
        MODEL_TPD[MODEL_FOR.classification]
      );
    }
    const text = completion.choices[0]?.message?.content;
    if (!text) return [];
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    return parseTags(parsed.tags);
  } catch (err) {
    if (isRateLimitError(err)) {
      console.warn(
        `[groq-rate-limit] classifyRoleTags: ${formatRateLimit(parseRateLimit(err))}`
      );
    }
    return [];
  }
}
