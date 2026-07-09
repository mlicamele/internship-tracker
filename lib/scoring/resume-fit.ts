// Resume-fit scoring. A distinct axis from `fit`:
//   fit         = how much the user WANTS the role
//   resume-fit  = how much the role WANTS the user
//
// Both surface side-by-side in the UI, and are composed at read time into a
// user-tunable "combined" score. See lib/scoring/combined.ts.
//
// Design:
//   - 6 rubric categories × 1-10 anchored grades, weighted compose.
//   - LLM picks a described LEVEL for each category (anchors at every
//     integer 1..10), not a raw number — the "ask for tiers, compose
//     numerically" pattern from CLAUDE.md Lessons.
//   - Seniority is non-monotonic on the compose side: grades 5-6 = "at
//     expected level" are the peak, grade 10 = "over-qualified" scores
//     partial credit. Internships treat over-qualification as a flight
//     risk, not a stronger signal.
//   - Weights (3,3,2,2,2,2) are coprime pair 2 & 3 → every integer 20-100
//     in the composed total is reachable given enough combinations.
//   - Insufficient-signal guard: extracted_text < MIN_EXTRACTED_TEXT_CHARS
//     → skip the LLM, return { score: null, tier: 'insufficient' }.
//   - Cache-hash on inputs skips re-scoring unchanged pairs.
//   - Never throws.

import crypto from "node:crypto";
import Groq from "groq-sdk";
import type {
  ResumeFitDetails,
  ResumeFitTier,
  Role,
  RubricGrade,
} from "@/lib/db/types";
import { isRateLimitError, serializeGroqCall } from "@/lib/llm/rate-limiter";

const MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const MAX_JD_CHARS = 6000;
const MAX_RESUME_CHARS = 6000;
/** Below this we don't have enough resume signal to score honestly. */
const MIN_EXTRACTED_TEXT_CHARS = 300;

// ------------------------------------------------------------
// Rubric categories, weights, and grade → contribution mappings.
// Kept here (not in the DB) so we can retune the numeric axis
// without a migration or a re-LLM run — details JSONB stores the
// raw grades, so re-composing is a pure function over stored data.
// ------------------------------------------------------------

export type RubricCategory =
  | "skills_coverage"
  | "domain_depth"
  | "seniority_fit"
  | "impact_evidence"
  | "recency_trajectory"
  | "practical_exposure";

/** Category weights. Sum = 14 by design. */
export const RESUME_FIT_WEIGHTS: Record<RubricCategory, number> = {
  // tunable
  skills_coverage: 3,
  domain_depth: 3,
  seniority_fit: 2,
  impact_evidence: 2,
  recency_trajectory: 2,
  practical_exposure: 2,
};

const WEIGHT_SUM = Object.values(RESUME_FIT_WEIGHTS).reduce((a, b) => a + b, 0);

/** Monotonic 1..10 → 10..100 for all categories except seniority. */
const MONOTONIC_CONTRIB: Record<RubricGrade, number> = {
  1: 10,
  2: 20,
  3: 30,
  4: 40,
  5: 50,
  6: 60,
  7: 70,
  8: 80,
  9: 90,
  10: 100,
};

/**
 * Seniority is peaked at 5-6 ("at expected level"). Grades 8-10
 * ("over-qualified") are weak signals for internships, not stronger.
 * The rubric anchors and this mapping together encode that.
 */
const SENIORITY_CONTRIB: Record<RubricGrade, number> = {
  1: 10,
  2: 25,
  3: 45,
  4: 75,
  5: 100,
  6: 100,
  7: 80,
  8: 55,
  9: 30,
  10: 15,
};

const CATEGORY_LIST: RubricCategory[] = [
  "skills_coverage",
  "domain_depth",
  "seniority_fit",
  "impact_evidence",
  "recency_trajectory",
  "practical_exposure",
];

// ------------------------------------------------------------
// Prompt
// ------------------------------------------------------------

const SYSTEM_PROMPT = `You grade a candidate's resume against an internship job posting on a 6-category rubric. For each category, pick the integer 1..10 whose ANCHOR DESCRIPTION best matches the resume evidence. Pick a described level — do not interpolate.

For each category ALSO emit a short one-sentence NOTE explaining exactly what in the resume drove that grade (concrete evidence: project names, technologies, roles — not generic praise). Then emit an overall rationale synthesizing the six categories.

OUTPUT STRICT JSON ONLY, no prose, no markdown:
{
  "skills_coverage":         integer 1..10,
  "skills_coverage_note":    string,
  "domain_depth":            integer 1..10,
  "domain_depth_note":       string,
  "seniority_fit":           integer 1..10,
  "seniority_fit_note":      string,
  "impact_evidence":         integer 1..10,
  "impact_evidence_note":    string,
  "recency_trajectory":      integer 1..10,
  "recency_trajectory_note": string,
  "practical_exposure":      integer 1..10,
  "practical_exposure_note": string,
  "matched_skills":          string[] (up to 8, deduped, phrased as they appear in the JD),
  "gaps":                    string[] (up to 5, required JD skills not evidenced in the resume),
  "rationale":               string (1-2 sentences synthesizing the six categories)
}

RUBRIC ANCHORS:

SKILLS COVERAGE — does the resume evidence the JD's required technical skills?
  1  = nothing on-topic in the resume
  2  = one basic skill mentioned in passing
  3  = 2-3 basics named, no depth shown
  4  = partial coverage with real gaps
  5  = about half of JD required skills evidenced
  6  = most JD required skills covered
  7  = all required skills + one adjacent area
  8  = all required + multiple adjacent areas
  9  = exceeds requirements with real breadth
  10 = distinctive breadth AND depth across the JD's stack

DOMAIN DEPTH — beyond keyword matching, how deep is the candidate's on-topic work?
  1  = nothing on-topic in the resume
  2  = single keyword or class name only
  3  = one coursework mention
  4  = one small class project
  5  = one meaningful project OR one small role
  6  = multiple projects OR one substantial role
  7  = sustained multi-month work in the domain
  8  = sustained work with visible impact
  9  = deep expertise across multiple artifacts
  10 = distinctive expertise (publications, sole-authored major work, or production scale)

SENIORITY FIT — does the candidate's experience level match the role's target? Peaked at 5-6 = "at level".
  1  = multiple years below expected
  2  = clearly under, but growing
  3  = slightly under (e.g. freshman applying to a role open to sophomores+)
  4  = just under the expected level
  5  = right at the expected level (typical intern-applying-to-intern-role)
  6  = at expected level with a small edge
  7  = slightly over (e.g. rising senior for a sophomore-open role)
  8  = clearly over (recent grad for intern role)
  9  = multi-year full-time engineer applying to intern role
  10 = senior industry professional (10=WEAK signal — flight risk, role mismatch)

IMPACT & EVIDENCE — outcomes, metrics, and evidence of impact.
  1  = no outcomes, metrics, or artifacts
  2  = vague responsibilities named without evidence
  3  = one specific role/task without metrics
  4  = some qualitative outcomes mentioned
  5  = some quantified outcomes ("reduced X by Y%")
  6  = multiple quantified outcomes
  7  = strong quantified impact across items
  8  = strong impact + one exceptional signal
  9  = exceptional signal (publication, production scale, or award)
  10 = multiple exceptional signals (publications AND scale AND awards)

RECENCY & TRAJECTORY — how fresh is the relevant work, and is the candidate accelerating?
  1  = relevant work is 3+ years old and stopped
  2  = relevant work is 2+ years old, no continuation
  3  = relevant work is 1-2 years old, flat
  4  = relevant work within the past year, no clear growth
  5  = recent work, flat trajectory across projects
  6  = recent work with modest growth (each project a bit bigger)
  7  = recent work with clear growth (each step meaningfully bigger)
  8  = recent work + significant year-over-year growth
  9  = very recent + strong growth trajectory (each project doubles in complexity)
  10 = distinctive recent momentum (multiple recent leaps in scope/ambition)

PRACTICAL EXPOSURE — coursework vs personal projects vs real work.
  1  = only coursework listed, no personal or team projects
  2  = coursework + one small class project
  3  = multiple class projects, no personal or industry work
  4  = personal side projects only
  5  = mix of coursework, personal projects, and one small collaboration
  6  = one meaningful internship, hackathon win, or open-source contribution
  7  = one strong internship OR sustained open-source work
  8  = multiple internships OR sustained contributions to real projects
  9  = substantial industry experience (multiple internships or ongoing part-time role)
  10 = distinctive industry experience (research + industry combined, or founder-track)

RULES:
- Pick the integer whose anchor is CLOSEST to the resume evidence.
- Do NOT default to 5 or 6 across the board — use the full 1-10 range.
- Notes cite CONCRETE evidence from the resume (project names, technologies, roles). Do not restate the anchor description; explain what you SAW.
- Rationale: 1-2 sentences, no line breaks, no markdown.
- matched_skills / gaps: concrete strings phrased as in the JD ("PyTorch", "Distributed systems", "React", "Systems-level networking"), not vague phrases.
- Integers 1..10 only. No floats, no strings.`;

// ------------------------------------------------------------
// Client (lazy singleton)
// ------------------------------------------------------------

let _client: Groq | null = null;
function client(): Groq {
  if (!_client) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GROQ_API_KEY missing. Add to .env.local and Vercel env."
      );
    }
    _client = new Groq({ apiKey, maxRetries: 4 });
  }
  return _client;
}

// ------------------------------------------------------------
// Public: input hash for the DAL cache-skip check
// ------------------------------------------------------------

type RoleHashInput = Pick<Role, "tags" | "jd_body_text" | "title">;

/**
 * Hash the inputs that determine the resume-fit score. Two calls with the
 * same hash MUST produce the same score, so the DAL can skip the LLM.
 * Bump the "v" prefix when the rubric or prompt materially changes.
 */
export function computeInputHash(
  role: RoleHashInput,
  resumeVersionId: string
): string {
  const tags = [...(role.tags ?? [])]
    .map((t) => t.toLowerCase().trim())
    .sort()
    .join(",");
  const body = (role.jd_body_text ?? "").replace(/\s+/g, " ").trim();
  const title = (role.title ?? "").trim().toLowerCase();
  const raw = [
    "v4-6cat-1to10", // bump when hashing scheme or prompt shape changes
    resumeVersionId,
    title,
    tags,
    body,
  ].join(" ");
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// ------------------------------------------------------------
// Public: score
// ------------------------------------------------------------

export interface ResumeFitInput {
  role: Pick<Role, "title" | "tags" | "jd_body_text">;
  companyName: string | null;
  resumeVersionId: string;
  resumeExtractedText: string | null;
}

export interface ResumeFitResult {
  score: number | null;
  details: ResumeFitDetails | null;
  skippedReason: "insufficient_text" | "no_resume" | "llm_error" | null;
}

const NULL_RESULT_NO_RESUME: ResumeFitResult = {
  score: null,
  details: null,
  skippedReason: "no_resume",
};

export async function scoreResumeFit(
  input: ResumeFitInput
): Promise<ResumeFitResult> {
  const text = (input.resumeExtractedText ?? "").trim();

  if (!input.resumeVersionId || text.length === 0) {
    return NULL_RESULT_NO_RESUME;
  }

  if (text.length < MIN_EXTRACTED_TEXT_CHARS) {
    return {
      score: null,
      details: insufficientDetails(input.resumeVersionId),
      skippedReason: "insufficient_text",
    };
  }

  const user = buildUserMessage(input, text);

  try {
    const completion = await serializeGroqCall(() =>
      client().chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: user },
        ],
        temperature: 0,
        max_tokens: 900,
        response_format: { type: "json_object" },
      })
    );

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = extractJsonObject(raw);
    if (!parsed) {
      return { score: null, details: null, skippedReason: "llm_error" };
    }

    const details = normalizeDetails(parsed, input.resumeVersionId);
    if (!details) {
      return { score: null, details: null, skippedReason: "llm_error" };
    }

    const total = composeNumeric(details);
    const tier = tierFromTotal(total);
    return {
      score: total,
      details: { ...details, tier },
      skippedReason: null,
    };
  } catch (err) {
    if (isRateLimitError(err)) {
      console.warn(
        `[groq-rate-limit] scoreResumeFit: ${
          err instanceof Error ? err.message : "429"
        }`
      );
    } else {
      console.warn(
        `[resume-fit] LLM error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return { score: null, details: null, skippedReason: "llm_error" };
  }
}

// ------------------------------------------------------------
// Compose: grades → 0-100 total
// ------------------------------------------------------------

function contributionFor(
  category: RubricCategory,
  grade: RubricGrade
): number {
  return category === "seniority_fit"
    ? SENIORITY_CONTRIB[grade]
    : MONOTONIC_CONTRIB[grade];
}

/** Deterministic weighted mix. Exported for unit tests. */
export function composeNumeric(
  details: Omit<ResumeFitDetails, "tier">
): number {
  let weighted = 0;
  for (const cat of CATEGORY_LIST) {
    const grade = details[cat] as RubricGrade;
    weighted += contributionFor(cat, grade) * RESUME_FIT_WEIGHTS[cat];
  }
  const total = weighted / WEIGHT_SUM;
  return Math.round(Math.max(0, Math.min(100, total)) * 100) / 100;
}

export function tierFromTotal(total: number): ResumeFitTier {
  if (total >= 75) return "strong";
  if (total >= 50) return "partial";
  return "weak";
}

// ------------------------------------------------------------
// Internals
// ------------------------------------------------------------

function buildUserMessage(input: ResumeFitInput, text: string): string {
  const jd = (input.role.jd_body_text ?? "").slice(0, MAX_JD_CHARS);
  const resume = text.slice(0, MAX_RESUME_CHARS);
  const tags = (input.role.tags ?? []).join(", ");
  return [
    `Company: ${input.companyName ?? "(unknown)"}`,
    `Title: ${input.role.title}`,
    tags ? `Role tags: ${tags}` : "",
    "",
    "JD body:",
    jd || "(no JD body available — grade from title + tags alone)",
    "",
    "Resume text:",
    resume,
  ]
    .filter(Boolean)
    .join("\n");
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function coerceGrade(v: unknown): RubricGrade | null {
  const n =
    typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 1 || rounded > 10) return null;
  return rounded as RubricGrade;
}

function normalizeDetails(
  parsed: Record<string, unknown>,
  resumeVersionId: string
): ResumeFitDetails | null {
  const grades: Partial<Record<RubricCategory, RubricGrade>> = {};
  for (const cat of CATEGORY_LIST) {
    const g = coerceGrade(parsed[cat]);
    if (!g) return null;
    grades[cat] = g;
  }
  return {
    tier: "weak", // overwritten from composed total by the caller
    skills_coverage: grades.skills_coverage!,
    domain_depth: grades.domain_depth!,
    seniority_fit: grades.seniority_fit!,
    impact_evidence: grades.impact_evidence!,
    recency_trajectory: grades.recency_trajectory!,
    practical_exposure: grades.practical_exposure!,
    skills_coverage_note: safeString(parsed.skills_coverage_note, 220),
    domain_depth_note: safeString(parsed.domain_depth_note, 220),
    seniority_fit_note: safeString(parsed.seniority_fit_note, 220),
    impact_evidence_note: safeString(parsed.impact_evidence_note, 220),
    recency_trajectory_note: safeString(parsed.recency_trajectory_note, 220),
    practical_exposure_note: safeString(parsed.practical_exposure_note, 220),
    matched_skills: safeStringArray(parsed.matched_skills, 8),
    gaps: safeStringArray(parsed.gaps, 5),
    rationale: safeString(parsed.rationale, 400),
    resume_version_id_used: resumeVersionId,
  };
}

function safeStringArray(v: unknown, cap: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const el of v) {
    if (typeof el !== "string") continue;
    const trimmed = el.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    out.push(trimmed);
    if (out.length >= cap) break;
  }
  return out;
}

function safeString(v: unknown, cap: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/\s+/g, " ").trim().slice(0, cap);
}

function insufficientDetails(resumeVersionId: string): ResumeFitDetails {
  return {
    tier: "insufficient",
    skills_coverage: 5,
    domain_depth: 5,
    seniority_fit: 5,
    impact_evidence: 5,
    recency_trajectory: 5,
    practical_exposure: 5,
    skills_coverage_note: "",
    domain_depth_note: "",
    seniority_fit_note: "",
    impact_evidence_note: "",
    recency_trajectory_note: "",
    practical_exposure_note: "",
    matched_skills: [],
    gaps: [],
    rationale: "Resume text too short to score honestly.",
    resume_version_id_used: resumeVersionId,
  };
}

// ------------------------------------------------------------
// Public: rubric anchors for UI display
// ------------------------------------------------------------

/**
 * Compact one-liner per (category, grade) — used by the hover popover.
 * Concise phrasing (kept short so 10 anchors fit in a small popover).
 * Verbatim intent matches SYSTEM_PROMPT — keep in sync.
 */
export const RUBRIC_ANCHORS: Record<
  RubricCategory,
  Record<RubricGrade, string>
> = {
  skills_coverage: {
    1: "Nothing on-topic",
    2: "One basic skill in passing",
    3: "2-3 basics, no depth",
    4: "Partial, real gaps",
    5: "About half of JD skills",
    6: "Most required skills",
    7: "All required + one adjacent",
    8: "All required + multi-adjacent",
    9: "Exceeds requirements",
    10: "Distinctive breadth + depth",
  },
  domain_depth: {
    1: "Nothing on-topic",
    2: "One keyword or class name",
    3: "One coursework mention",
    4: "One small class project",
    5: "One meaningful project or role",
    6: "Multiple projects or one big role",
    7: "Sustained multi-month work",
    8: "Sustained work with visible impact",
    9: "Deep expertise, multiple artifacts",
    10: "Distinctive expertise (pub / scale)",
  },
  seniority_fit: {
    1: "Multiple years below expected",
    2: "Clearly under, growing",
    3: "Slightly under",
    4: "Just under expected",
    5: "At expected level",
    6: "At level with a small edge",
    7: "Slightly over",
    8: "Clearly over (recent grad)",
    9: "Multi-year pro applying to intern",
    10: "Senior pro (weak signal)",
  },
  impact_evidence: {
    1: "No outcomes or metrics",
    2: "Vague responsibilities",
    3: "One specific task, no metrics",
    4: "Some qualitative outcomes",
    5: "Some quantified outcomes",
    6: "Multiple quantified outcomes",
    7: "Strong quantified impact",
    8: "Strong + one exceptional signal",
    9: "Exceptional (pub / scale / award)",
    10: "Multiple exceptional signals",
  },
  recency_trajectory: {
    1: "3+ years old, stopped",
    2: "2+ years old, no continuation",
    3: "1-2 years old, flat",
    4: "Past year, no growth",
    5: "Recent, flat trajectory",
    6: "Recent, modest growth",
    7: "Recent + clear growth",
    8: "Significant year-over-year growth",
    9: "Very recent + strong trajectory",
    10: "Distinctive recent momentum",
  },
  practical_exposure: {
    1: "Coursework only",
    2: "Coursework + one class project",
    3: "Multiple class projects",
    4: "Personal side projects only",
    5: "Mix + one small collaboration",
    6: "One meaningful internship/OSS",
    7: "Strong internship or OSS",
    8: "Multiple internships/contributions",
    9: "Substantial industry experience",
    10: "Distinctive (research + industry)",
  },
};

export const RUBRIC_CATEGORY_LABELS: Record<RubricCategory, string> = {
  skills_coverage: "Skills coverage",
  domain_depth: "Domain depth",
  seniority_fit: "Seniority fit",
  impact_evidence: "Impact & evidence",
  recency_trajectory: "Recency & trajectory",
  practical_exposure: "Practical exposure",
};

/** Ordered display list for the popover. Matches SYSTEM_PROMPT order. */
export const RUBRIC_CATEGORIES_ORDERED: RubricCategory[] = [...CATEGORY_LIST];
