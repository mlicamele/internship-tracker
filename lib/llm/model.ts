// Single source of truth for which Groq model each LLM task uses.
//
// Why split by task:
//   - Groq free-tier TPD limits are PER MODEL. Running every task on
//     Scout meant a resume-fit backfill could drain the daily budget
//     and block URL extractions from `paste_url` / capture. One model
//     per task multiplies our effective daily headroom by the number
//     of tasks (currently 3× vs the single-model era).
//   - Model quality demand differs by task. Extraction is the trunk
//     (every downstream field depends on it) → keep on the strongest
//     model. Categorical grading + tag classification have narrower
//     output space and tolerate a smaller model.
//
// Groq server-side handles per-model TPM/TPD independently, so no
// per-model bookkeeping is required in `rate-limiter.ts` — the shared
// serializer + 400ms gap is enough to keep us under per-minute burst
// caps for any single model.

/**
 * Which Groq model handles which task family.
 *
 * When you change one of these values, any downstream cache key that
 * folds `MODEL_FOR.<task>` into its hash automatically invalidates on
 * next run (see `computeInputHash` in `lib/scoring/resume-fit.ts`).
 */
export const MODEL_FOR = {
  /**
   * Full JD → structured JSON. Highest quality demand — every field
   * downstream keys off this. Progression:
   *   - Scout (17B MoE) — deprecated by Groq 2026-08 (404, broke everything)
   *   - openai/gpt-oss-120b — tried 2026-08-12; 8K TPM is a per-request cap,
   *     our 9-12K-token extraction payloads got 413'd. Reverted immediately.
   *   - llama-3.3-70b-versatile (current) — 12K TPM comfortably fits our
   *     payload; 100K TPD, now isolated (scoring moved to gpt-oss-20b).
   */
  extraction: "llama-3.3-70b-versatile",

  /**
   * Resume × JD → 6-category 1-10 rubric grades + notes. Progression:
   *   - llama-3.3-70b-versatile — original, worked fine
   *   - openai/gpt-oss-20b — tried for TPD isolation (200K vs 70b's 100K)
   *     but the 20b model reliably fails to emit valid JSON for the full
   *     6-category rubric ("Failed to validate JSON" / "max completion
   *     tokens reached before generating a valid document"). Reverted.
   *   - llama-3.3-70b-versatile (current) — shared 100K TPD with extraction
   *     is the trade for reliable scoring. Token tracker in rate-limiter.ts
   *     warns at 80% so we see exhaustion coming.
   * NOTE: Swapping models auto-invalidates the resume_fit_input_hash cache
   * (see computeInputHash), so the next batch rescores all rows.
   */
  scoring: "llama-3.3-70b-versatile",

  /**
   * Role title + company → 1-3 tags from a closed vocabulary. Bounded
   * output, cheapest task. Progression:
   *   - llama-3.1-8b-instant — original, deprecated by Groq 2026-08.
   *   - openai/gpt-oss-20b — tried post-deprecation. Empirically worse
   *     than 8B: 3/7 regressions on tagged real roles (2026-08-13
   *     verification), non-determinism at temp=0 on identical inputs,
   *     hedges to [] on obvious cases (Akuna/SWE C++, Radix/Quant).
   *   - openai/gpt-oss-120b (current) — same 200K TPD envelope as 20b
   *     (isolation preserved from the 70B extraction/scoring pool),
   *     6x the parameters. Fits our ~2.5K classification payload
   *     under the 8K TPM per-request cap. Verified against 25 real
   *     roles to confirm classification quality is materially better
   *     than 20b before shipping.
   */
  classification: "openai/gpt-oss-120b",
} as const;

export type LlmTask = keyof typeof MODEL_FOR;
