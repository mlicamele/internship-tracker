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
   * Resume × JD → 6-category 1-10 rubric grades + notes. Categorical
   * output, so a smaller model is fine. Moved to gpt-oss-20b so it has
   * its own 200K TPD budget separate from extraction — a 58-app backfill
   * won't touch the extraction budget.
   * NOTE: Swapping models auto-invalidates the resume_fit_input_hash cache
   * (see computeInputHash), so the next batch rescores all rows.
   */
  scoring: "openai/gpt-oss-20b",

  /**
   * JD title + body → 1-3 tags from a closed vocabulary. Bounded
   * output, cheapest task. 8B Instant is very fast and has a separate
   * 500K TPD budget that we barely touch.
   */
  classification: "llama-3.1-8b-instant",
} as const;

export type LlmTask = keyof typeof MODEL_FOR;
