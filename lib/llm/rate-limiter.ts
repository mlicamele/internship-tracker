// Process-wide single-slot lock for Groq calls.
//
// Rationale: on the free tier, meta-llama/llama-4-scout-17b-16e-instruct
// caps at 30 RPM / 30K TPM / 500K TPD. We're a single-user app, so
// serializing every Groq call (concurrency=1) with a small inter-call
// gap keeps us well under the per-minute burst limits without needing a
// full token-bucket implementation. `groq-sdk` handles the transient
// 429 retry-with-backoff on top (bumped from default 2 to 4 retries).
//
// TPD is a separate concern this doesn't solve — if the daily budget is
// exhausted, SDK retries won't help. Callers should log distinctly on
// 429 so the failure mode doesn't look identical to a broken prompt.
//
// Applies to: extractJobFromEvidence, classifyRoleTags, and any future
// Groq caller. See lib/llm/extract-job.ts.

const MIN_INTER_CALL_MS = 400;

let lock: Promise<unknown> = Promise.resolve();
let lastCallEndedAt = 0;

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

/**
 * Cheap heuristic to detect whether an error caught inside a Groq call
 * wrapper looks like a rate-limit refusal. Used by the `never-throws`
 * extractor path so we can log distinctly without misdiagnosing as a
 * prompt bug (see Lesson: "Silent Groq TPD-limit failures look like a
 * broken prompt").
 */
export function isRateLimitError(err: unknown): boolean {
  if (!err) return false;
  const anyErr = err as { status?: number; message?: string; name?: string };
  if (anyErr.status === 429) return true;
  if (anyErr.name === "RateLimitError") return true;
  const msg = String(anyErr.message ?? "").toLowerCase();
  return (
    msg.includes("rate limit") ||
    msg.includes("rate_limit") ||
    msg.includes("tokens per day") ||
    msg.includes("tokens per minute")
  );
}
