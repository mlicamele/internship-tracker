// Canonical Groq free-tier limits for the extraction model.
//
// Source: Groq console model catalog for llama-3.3-70b-versatile
// (extraction model — see model.ts). We tried openai/gpt-oss-120b briefly
// but its 8K TPM is a per-request size cap, so our 9-12K-token extraction
// payloads all 413'd. 70b's 12K TPM handles them cleanly. Trade: 100K TPD
// is smaller than gpt-oss's 200K, but scoring is now isolated onto
// gpt-oss-20b so this 100K belongs entirely to extraction.
// Update these numbers if you change tier or model — everything downstream
// (cron cap, batch scripts, summary reporting) derives from here.

export const GROQ_LIMITS = {
  requestsPerMinute: 30,
  requestsPerDay: 1_000,
  tokensPerMinute: 12_000,
  tokensPerDay: 100_000,
} as const;

/**
 * Per-model daily token budgets (free tier). Used by recordTokenUsage()
 * in rate-limiter.ts to warn before we exhaust a specific model's TPD.
 * Keys match MODEL_FOR values. Extend when adding a new model to MODEL_FOR.
 * Source: Groq console model catalog (verified 2026-08-12).
 */
export const MODEL_TPD: Readonly<Record<string, number>> = {
  "llama-3.3-70b-versatile": 100_000,
  "openai/gpt-oss-20b": 200_000,
  "openai/gpt-oss-120b": 200_000,
  "llama-3.1-8b-instant": 500_000,
} as const;

/**
 * Budget carved out every day for the user's own manual actions —
 * paste_url on /applications/new, iOS Shortcut capture, and any other
 * interactive LLM extraction Michael triggers by hand.
 *
 * With 100K TPD, we reserve 3 extractions × 8K = 24K tokens (24% of daily).
 * Cron + batch scripts must not consume tokens or requests that fall
 * inside this reservation.
 */
export const USER_MANUAL_RESERVE = {
  extractions: 3,
  avgTokensPerExtraction: 8_000,
  tokens: 3 * 8_000,     // 24K
  requests: 3,
} as const;

/**
 * What the daily cron + batch scripts are allowed to consume in aggregate.
 * Derived: total daily limit minus the user-manual reserve.
 */
export const AUTOMATED_DAILY_BUDGET = {
  tokens: GROQ_LIMITS.tokensPerDay - USER_MANUAL_RESERVE.tokens,      // 76K
  requests: GROQ_LIMITS.requestsPerDay - USER_MANUAL_RESERVE.requests, // 997
} as const;

/** Empirical average tokens per Simplify extraction (JD body dominates the count). */
export const AVG_TOKENS_PER_EXTRACTION = 8_000;
export const AVG_TOKENS_PER_TAG_CLASSIFY = 2_000;

/**
 * Cron per-run cap on 70b-versatile (100K TPD, 12K TPM):
 *   - Vercel free-tier hard timeout: 60s. Each extraction ~5-8s incl. geocoding.
 *   - Daily token budget: 76K / 8K = ~9 extractions/day of automated headroom.
 *   - TPM: 12K/min lets a big single call through without cooldown.
 *
 * 3/run × 3 runs/day = 9 extractions/day fits inside TPD.
 * If we need more throughput, upgrade to Dev Tier or slim the extraction
 * prompt + evidence to fit gpt-oss-120b's 8K TPM cap.
 */
export const CRON_MAX_NEW_EXTRACTIONS_PER_RUN = 3;

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
