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
   * downstream keys off this. Scout 17B MoE is comparable to 3.3 70B
   * for structured extraction and has the highest TPM headroom.
   */
  extraction: "meta-llama/llama-4-scout-17b-16e-instruct",

  /**
   * Resume × JD → 6-category 1-10 rubric grades + notes. Categorical
   * output, so a smaller model is fine. Moved off Scout to isolate the
   * biggest single burst (58-app backfills) from URL extraction.
   */
  scoring: "llama-3.3-70b-versatile",

  /**
   * JD title + body → 1-3 tags from a closed vocabulary. Bounded
   * output, cheapest task. 8B Instant is very fast and has a separate
   * TPD budget that we barely touch.
   */
  classification: "llama-3.1-8b-instant",
} as const;

export type LlmTask = keyof typeof MODEL_FOR;
