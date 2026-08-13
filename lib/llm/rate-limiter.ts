// Process-wide single-slot lock for Groq calls.
//
// Rationale: all three active models cap at 30 RPM on free tier
// (llama-3.3-70b-versatile for extraction, gpt-oss-20b for scoring,
// 8b-instant for classification — see model.ts + limits.ts). Each has
// independent server-side per-minute + per-day buckets — calls to
// different models don't compete for the same TPM. But we still enforce
// a process-wide serializer so:
//   1. Concurrent calls (Promise.all-style batches) don't create bursts.
//   2. A fast classifier call (~500ms) followed by another one doesn't
//      exceed 30 RPM (2000ms gap ensures ≤30 calls/min ceiling for the
//      fastest model in the mix).
//
// `groq-sdk` handles transient 429 retry-with-backoff on top (bumped from
// default 2 to 4 retries), so a TPM-limit hit on one model auto-recovers.
//
// TPD is a separate concern this doesn't solve — if the daily budget is
// exhausted, SDK retries won't help. Callers should log distinctly on
// 429 so the failure mode doesn't look identical to a broken prompt.
//
// Applies to: extractJobFromEvidence, classifyRoleTags, scoreResumeFit,
// and any future Groq caller. See lib/llm/extract-job.ts +
// lib/scoring/resume-fit.ts.

// 30 RPM ceiling → 60s/30 = 2000ms minimum spacing between call starts.
// Since we measure gap from lastCallEndedAt (call finished), this
// conservatively enforces ≤30 RPM even for very fast (sub-second) calls.
const MIN_INTER_CALL_MS = 2000;

let lock: Promise<unknown> = Promise.resolve();
let lastCallEndedAt = 0;

/**
 * Test-only reset of the serializer's in-flight state. Vitest tests that
 * swap between real and fake timers otherwise deadlock — `lastCallEndedAt`
 * carries over as a real-time timestamp, and after `vi.useFakeTimers()`
 * flips Date.now() to fake-epoch 0, the subtraction yields a huge `wait`
 * and `setTimeout` under fake timers never fires. Not part of the public
 * API.
 */
export function _resetSerializerForTests(): void {
  lock = Promise.resolve();
  lastCallEndedAt = 0;
}

/**
 * Run `fn` serially with respect to all other Groq calls in this process.
 * Waits for the prior call to finish, then enforces a minimum gap since
 * the last call ended. Preserves `fn`'s return + throw behavior.
 */
export async function serializeGroqCall<T>(fn: () => Promise<T>): Promise<T> {
  const priorLock = lock;
  let releaseNext!: () => void;
  lock = new Promise<void>((r) => {
    releaseNext = r;
  });
  try {
    await priorLock;
    const wait = Math.max(
      0,
      lastCallEndedAt + MIN_INTER_CALL_MS - Date.now()
    );
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    return await fn();
  } finally {
    lastCallEndedAt = Date.now();
    releaseNext();
  }
}

// ============================================================
// Token-usage tracker — proactive TPD budget monitoring.
// ============================================================
//
// After each successful Groq call, callers pass response.usage.total_tokens
// through recordTokenUsage(model, tokens). We keep cumulative per-model
// counts (in-memory, resets every 24h) and warn at WARN_PCT of the daily
// budget so we see exhaustion coming instead of getting surprise 429s.
//
// This is a defense against the class of bug we hit today: extraction
// silently maxed 100K TPD across an interactive session with no warning,
// then paste_url calls started failing. With this tracker, once we cross
// 80K used on a 100K bucket, every subsequent call logs a bright warning.
//
// Deliberately in-memory only — for a solo-user single-process app the
// numbers are useful within one server lifetime. If we ever scale to
// multi-process, this needs Redis (or Groq's response headers alone,
// which report per-minute buckets but not TPD).

/** Warn once cumulative daily use crosses this fraction of the budget. */
const TPD_WARN_PCT = 0.8;

interface UsageWindow {
  /** Cumulative tokens consumed in the current 24h window. */
  tokens: number;
  /** Cumulative successful requests in the current 24h window. */
  requests: number;
  /** ms since epoch when the current window opened. */
  windowStart: number;
  /** True after we've already emitted the >80% warning this window. */
  warned: boolean;
}

const usageByModel = new Map<string, UsageWindow>();
const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Record a successful Groq call's token usage. Auto-resets the per-model
 * window every 24h. Logs a bright warning the first time this window
 * crosses TPD_WARN_PCT of the model's daily budget (looked up from
 * `budgetForModel`), so a batch script or a long user session sees
 * exhaustion coming before the 429s start.
 *
 * Safe to call from a fire-and-forget context; never throws.
 */
export function recordTokenUsage(
  model: string,
  tokens: number,
  budgetForModel?: number
): void {
  if (!Number.isFinite(tokens) || tokens <= 0) return;
  const now = Date.now();
  let w = usageByModel.get(model);
  if (!w || now - w.windowStart > WINDOW_MS) {
    w = { tokens: 0, requests: 0, windowStart: now, warned: false };
    usageByModel.set(model, w);
  }
  w.tokens += tokens;
  w.requests += 1;

  if (
    !w.warned &&
    budgetForModel &&
    budgetForModel > 0 &&
    w.tokens / budgetForModel >= TPD_WARN_PCT
  ) {
    w.warned = true;
    const pct = Math.round((w.tokens / budgetForModel) * 100);
    console.warn(
      `[groq-budget-warn] model=${model} used=${w.tokens}/${budgetForModel} (${pct}%) requests=${w.requests} — approaching TPD; further calls may 429 soon`
    );
  }
}

/** Snapshot of the current token-usage state — useful for tests + debugging. */
export function getUsageSnapshot(model: string): UsageWindow | null {
  return usageByModel.get(model) ?? null;
}

/** Test-only reset. Not part of the module's public API contract. */
export function _resetUsageForTests(): void {
  usageByModel.clear();
}

// ============================================================
// Fast-fail cooldown after a recent rate-limit — batch-stall guard.
// ============================================================
//
// Problem: `serializeGroqCall` runs concurrent Promise.all siblings strictly
// serially (single-slot lock). When TPD is already exhausted at the top of a
// cron run, row 1's call 429s → SDK retries with exponential backoff (~30s
// per failed call at the current `maxRetries: 4`) → row 2 was already queued
// in the lock chain and starts *immediately* when row 1's promise releases,
// with no way to react to the 429 that just happened. Row 2 burns another
// ~30s. Vercel kills the function at 60s. The between-batch abort in the
// caller (see ingest.ts's `rateLimitHit`) doesn't help because we never
// reach the between-batch check.
//
// Fix: any 429 sets `recentRateLimitAt`. Callers check
// `shouldFastFailForRateLimit()` BEFORE entering `serializeGroqCall`. Within
// the cooldown window, subsequent calls skip Groq entirely and return SAFE
// defaults in microseconds instead of ~30s. Batch 1 collapses from ~90s
// (3 × 30s serial retries) to ~30s (real 429 + microsecond fast-fails).
//
// Cooldown is intentionally short (30s) so an interactive paste_url call
// arriving after a TPM squeeze has cleared can attempt Groq again. TPD walls
// last hours, but a longer cooldown would harm interactive resilience under
// transient TPM squeezes. If the fast-fail proves too aggressive we can key
// by model/limitKind (TPD → longer, TPM → shorter).

const RATE_LIMIT_FAST_FAIL_COOLDOWN_MS = 30_000;
let recentRateLimitAt: number | null = null;

/** Note that a Groq call was just refused for rate-limit reasons. */
export function noteRateLimit(): void {
  recentRateLimitAt = Date.now();
}

/**
 * True if a rate-limit was noted within the last COOLDOWN window.
 * Callers that batch (e.g. `Promise.all(rows.map(scrapeUrl))`) should skip
 * the actual Groq call and return a rate-limited-shaped safe default so
 * queued siblings don't each burn the SDK's retry-backoff budget.
 */
export function shouldFastFailForRateLimit(): boolean {
  return (
    recentRateLimitAt !== null &&
    Date.now() - recentRateLimitAt < RATE_LIMIT_FAST_FAIL_COOLDOWN_MS
  );
}

/** Test-only reset. Not part of the module's public API contract. */
export function _resetRateLimitFastFailForTests(): void {
  recentRateLimitAt = null;
}

/**
 * Cheap heuristic to detect whether an error caught inside a Groq call
 * wrapper looks like a rate-limit refusal. Used by the `never-throws`
 * extractor path so we can log distinctly without misdiagnosing as a
 * prompt bug (see Lesson: "Silent Groq TPD-limit failures look like a
 * broken prompt").
 */
export function isRateLimitError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof RateLimitFastFailError) return true;
  const anyErr = err as { status?: number; message?: string; name?: string };
  if (anyErr.status === 429) return true;
  if (anyErr.name === "RateLimitError") return true;
  if (anyErr.name === "RateLimitFastFailError") return true;
  const msg = String(anyErr.message ?? "").toLowerCase();
  return (
    msg.includes("rate limit") ||
    msg.includes("rate_limit") ||
    msg.includes("tokens per day") ||
    msg.includes("tokens per minute")
  );
}

/**
 * Thrown when a queued Groq caller acquires `serializeGroqCall`'s lock only
 * to find that another caller within the cooldown window just 429'd. Callers
 * catch this the same way they catch a real 429 — never-throws contract is
 * preserved, `isRateLimitError` returns true, and the outer wrapper's SAFE
 * default (with `rate_limited: true`) is returned to the user.
 *
 * Distinguishes from a "real" 429 for debugging: prod logs show whether we
 * short-circuited (this class) vs actually hit Groq's rate-limit response.
 */
export class RateLimitFastFailError extends Error {
  constructor() {
    super("skipped: rate-limit fast-fail after serializer lock");
    this.name = "RateLimitFastFailError";
  }
}

/**
 * Structured breakdown of a Groq 429 error. Fields are best-effort:
 * we parse the human-readable error string because groq-sdk doesn't
 * always surface `retry-after` header via its typed error class. Returns
 * `{ isRateLimit: false }` when the input isn't a rate-limit error.
 *
 * The parsed `retryAt` is the exact moment the limit resets — much more
 * useful than "in about 2 hours" for both logs and any future
 * fail-fast-and-schedule-retry logic.
 */
export interface RateLimitInfo {
  isRateLimit: boolean;
  /** Which bucket tripped, if identifiable from the error message. */
  limitKind?: "TPD" | "TPM" | "RPD" | "RPM" | "unknown";
  /** Model identifier the error mentioned (e.g. "llama-3.3-70b-versatile"). */
  model?: string;
  /** Total budget of the exceeded bucket. */
  limit?: number;
  /** Tokens/requests consumed at the moment of the 429. */
  used?: number;
  /** Tokens the rejected request would have consumed. */
  requested?: number;
  /** Absolute time the exceeded bucket resets. */
  retryAt?: Date;
  /** Seconds until reset — convenience derived from retryAt. */
  retryAfterSeconds?: number;
}

export function parseRateLimit(err: unknown): RateLimitInfo {
  const isRateLimit = isRateLimitError(err);
  if (!isRateLimit) return { isRateLimit: false };
  const msg = String((err as { message?: string })?.message ?? "");

  // Limit kind
  let limitKind: RateLimitInfo["limitKind"] = "unknown";
  if (/tokens per day\s*\(TPD\)/i.test(msg)) limitKind = "TPD";
  else if (/tokens per minute\s*\(TPM\)/i.test(msg)) limitKind = "TPM";
  else if (/requests per day\s*\(RPD\)/i.test(msg)) limitKind = "RPD";
  else if (/requests per minute\s*\(RPM\)/i.test(msg)) limitKind = "RPM";

  // Model
  const modelMatch = msg.match(/model `([^`]+)`/);
  const model = modelMatch ? modelMatch[1] : undefined;

  // Limit / Used / Requested numbers — "Limit 100000, Used 97843, Requested 9191"
  const numMatch = msg.match(/Limit\s+(\d+),\s*Used\s+(\d+),\s*Requested\s+(\d+)/i);
  const limit = numMatch ? Number(numMatch[1]) : undefined;
  const used = numMatch ? Number(numMatch[2]) : undefined;
  const requested = numMatch ? Number(numMatch[3]) : undefined;

  // "try again in 1h53m56.832s" / "in 2m59.56s" / "in 7.66s"
  let retryAfterSeconds: number | undefined;
  let retryAt: Date | undefined;
  const retryMatch = msg.match(
    /try again in\s+(?:(\d+)h)?(?:(\d+)m)?(?!s)([\d.]+)s/i
  );
  if (retryMatch) {
    const h = Number(retryMatch[1] ?? 0);
    const m = Number(retryMatch[2] ?? 0);
    const s = Number(retryMatch[3] ?? 0);
    retryAfterSeconds = h * 3600 + m * 60 + s;
    retryAt = new Date(Date.now() + retryAfterSeconds * 1000);
  }

  return {
    isRateLimit: true,
    limitKind,
    model,
    limit,
    used,
    requested,
    retryAt,
    retryAfterSeconds,
  };
}

/**
 * Human-readable one-liner for a rate-limit info. Safe to drop into
 * console.warn from a never-throws wrapper.
 */
export function formatRateLimit(info: RateLimitInfo): string {
  if (!info.isRateLimit) return "not a rate-limit error";
  const parts: string[] = [];
  if (info.model) parts.push(`model=${info.model}`);
  if (info.limitKind) parts.push(`limit=${info.limitKind}`);
  if (info.used != null && info.limit != null) {
    const pct = Math.round((info.used / info.limit) * 100);
    parts.push(`used=${info.used}/${info.limit} (${pct}%)`);
  }
  if (info.requested != null) parts.push(`requested=${info.requested}`);
  if (info.retryAt) {
    parts.push(`resets=${info.retryAt.toISOString()}`);
  }
  return parts.join(" · ");
}
