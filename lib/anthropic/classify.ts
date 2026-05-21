// LLM-based extraction of fields that regex/scrape couldn't capture cleanly.
// Single Haiku call per role. Never throws — returns safe defaults on any error.

import { anthropic, HAIKU_MODEL } from "@/lib/anthropic";
import type {
  ClassYearTag,
  TargetSeason,
  WorkModel,
} from "@/lib/db/types";

export interface RoleClassification {
  class_year_tag: ClassYearTag;
  target_year: number | null;
  target_season: TargetSeason;
  work_model: WorkModel;
  confidence: number;
  reasoning: string;
}

const SAFE_DEFAULT: RoleClassification = {
  class_year_tag: "unspecified",
  target_year: null,
  target_season: "summer",
  work_model: "unspecified",
  confidence: 0,
  reasoning: "no body or call failed",
};

const CLASS_YEAR_VALUES: ReadonlySet<string> = new Set([
  "freshman_ok",
  "sophomore_ok",
  "junior_plus",
  "unspecified",
]);

const TARGET_SEASON_VALUES: ReadonlySet<string> = new Set([
  "summer",
  "fall",
  "winter",
  "spring",
]);

const WORK_MODEL_VALUES: ReadonlySet<string> = new Set([
  "remote",
  "hybrid",
  "onsite",
  "unspecified",
]);

const SYSTEM_PROMPT = `You classify a CS internship/job description for an undergrad applicant.

Output STRICT JSON ONLY. No markdown, no prose, no code fence.

Schema:
{
  "class_year_tag": "freshman_ok" | "sophomore_ok" | "junior_plus" | "unspecified",
  "target_year": number | null,
  "target_season": "summer" | "fall" | "winter" | "spring",
  "work_model": "remote" | "hybrid" | "onsite" | "unspecified",
  "confidence": number,
  "reasoning": string
}

Rules:
- class_year_tag: who can apply, NOT what year the company likes. "rising junior" = junior_plus. "open to all class years" = freshman_ok. "intern, summer 2027" with no year guidance = unspecified.
- target_year: the year the internship occurs (e.g. "Summer 2027 SWE intern" → 2027). null if unstated.
- target_season: summer is most common; only pick others if explicitly mentioned.
- work_model: 'remote' if the JD says fully remote; 'hybrid' if mixed; 'onsite'/'in-office' otherwise; 'unspecified' if not mentioned. Do NOT mark 'remote' if the JD says "no remote".
- confidence: 0.0-1.0. Be honest. If you cannot tell a field, use the unspecified/null default AND lower the confidence.
- reasoning: one sentence, internal use only.

DO NOT guess. Prefer 'unspecified' / null when uncertain.`;

interface ClassifyArgs {
  jd_body: string;
  title?: string | null;
}

/**
 * Classify a role via Haiku. Always resolves — returns safe defaults on
 * any failure (API error, parse failure, invalid enum values). Callers
 * should still check confidence and decide whether to apply.
 */
export async function classifyRole(
  args: ClassifyArgs
): Promise<RoleClassification> {
  const body = args.jd_body.trim();
  if (body.length < 100) {
    return { ...SAFE_DEFAULT, reasoning: "jd body too short" };
  }

  const titleLine = args.title ? `Title: ${args.title}\n\n` : "";
  // Cap body to 6000 chars to keep prompt cost predictable
  const userMessage = `${titleLine}Job description:\n${body.slice(0, 6000)}`;

  try {
    const response = await anthropic().messages.create({
      model: HAIKU_MODEL,
      max_tokens: 400,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { ...SAFE_DEFAULT, reasoning: "no text block in response" };
    }

    const raw = textBlock.text.trim();
    // Tolerate stray markdown by extracting the first JSON object
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { ...SAFE_DEFAULT, reasoning: "no JSON in response" };
    }

    const parsed = JSON.parse(jsonMatch[0]) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return { ...SAFE_DEFAULT, reasoning: "non-object JSON" };
    }

    const p = parsed as Record<string, unknown>;

    const classYearTag = CLASS_YEAR_VALUES.has(p.class_year_tag as string)
      ? (p.class_year_tag as ClassYearTag)
      : "unspecified";

    const targetSeason = TARGET_SEASON_VALUES.has(p.target_season as string)
      ? (p.target_season as TargetSeason)
      : "summer";

    const workModel = WORK_MODEL_VALUES.has(p.work_model as string)
      ? (p.work_model as WorkModel)
      : "unspecified";

    const targetYearRaw = p.target_year;
    const targetYear =
      typeof targetYearRaw === "number" &&
      Number.isInteger(targetYearRaw) &&
      targetYearRaw >= 2024 &&
      targetYearRaw <= 2032
        ? targetYearRaw
        : null;

    const confidenceRaw = p.confidence;
    const confidence =
      typeof confidenceRaw === "number" &&
      Number.isFinite(confidenceRaw) &&
      confidenceRaw >= 0 &&
      confidenceRaw <= 1
        ? confidenceRaw
        : 0;

    const reasoning =
      typeof p.reasoning === "string" ? p.reasoning : "";

    return {
      class_year_tag: classYearTag,
      target_year: targetYear,
      target_season: targetSeason,
      work_model: workModel,
      confidence,
      reasoning,
    };
  } catch (err) {
    return {
      ...SAFE_DEFAULT,
      reasoning: err instanceof Error ? err.message : "unknown error",
    };
  }
}
