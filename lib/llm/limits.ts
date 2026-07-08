// Canonical Groq free-tier limits for the extraction model.
//
// Source: Groq console dashboard for meta-llama/llama-4-scout-17b-16e-instruct
// as observed 2026-07-08. Update these numbers if you change tier or model —
// everything downstream (cron cap, batch scripts, summary reporting) derives
// from here.

export const GROQ_LIMITS = {
  requestsPerMinute: 30,
  requestsPerDay: 1_000,
  tokensPerMinute: 30_000,
  tokensPerDay: 500_000,
} as const;

/**
 * Budget carved out every day for the user's own manual actions —
 * paste_url on /applications/new, iOS Shortcut capture, and any other
 * interactive LLM extraction Michael triggers by hand.
 *
 * Assumes up to 5 interactive extractions at ~8K tokens each (thin JDs
 * are cheaper; fat postings can exceed). Cron + batch scripts must not
 * consume tokens or requests that fall inside this reservation.
 */
export const USER_MANUAL_RESERVE = {
  extractions: 5,
  avgTokensPerExtraction: 8_000,
  tokens: 5 * 8_000,     // 40K
  requests: 5,
} as const;

/**
 * What the daily cron + batch scripts are allowed to consume in aggregate.
 * Derived: total daily limit minus the user-manual reserve.
 */
export const AUTOMATED_DAILY_BUDGET = {
  tokens: GROQ_LIMITS.tokensPerDay - USER_MANUAL_RESERVE.tokens,      // 460K
  requests: GROQ_LIMITS.requestsPerDay - USER_MANUAL_RESERVE.requests, // 995
} as const;

/** Empirical average tokens per Simplify extraction (JD body dominates the count). */
export const AVG_TOKENS_PER_EXTRACTION = 8_000;
export const AVG_TOKENS_PER_TAG_CLASSIFY = 2_000;

/**
 * Cron per-run cap. Two constraints:
 *   - Vercel free-tier hard timeout: 60s. Each extraction ~5-8s incl. geocoding.
 *   - Daily token budget: 420K / 8K = ~52 extractions/day headroom.
 *
 * The 60s timeout dominates; 6 leaves ~30s of headroom for slow batches.
 * At 6/day sustained we use ~48K tokens/day of the 420K automated budget,
 * so any bump (either safer margin or catching up on backlog) is safe token-wise.
 */
export const CRON_MAX_NEW_EXTRACTIONS_PER_RUN = 6;

/**
 * Estimate whether a planned batch of N extractions fits inside the
 * daily-automated budget. Rough — assumes AVG_TOKENS_PER_EXTRACTION.
 */
export function estimateBatchCost(count: number, tokensPerCall = AVG_TOKENS_PER_EXTRACTION) {
  const tokens = count * tokensPerCall;
  return {
    tokens,
    requests: count,
    pctOfDailyTPD: Math.round((tokens / GROQ_LIMITS.tokensPerDay) * 100),
    pctOfAutomatedTPD: Math.round((tokens / AUTOMATED_DAILY_BUDGET.tokens) * 100),
    exceedsAutomatedTPD: tokens > AUTOMATED_DAILY_BUDGET.tokens,
    exceedsAutomatedRPD: count > AUTOMATED_DAILY_BUDGET.requests,
  };
}
