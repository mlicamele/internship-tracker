// @vitest-environment node
//
// Verify the fast-fail cooldown at the wrapper boundary: after a 429,
// subsequent calls within the cooldown window must NOT hit the Groq client.
// This is the load-bearing behavior the advisor identified as the actual
// fix for the 2026-08-13 simplify-cron 504 — Layer 1 (batch defer) alone
// leaves queued Promise.all siblings still calling Groq behind
// serializeGroqCall's single-slot lock. Verified end-to-end via a stubbed
// Groq client so the mock call count tells us exactly what the SDK saw.

import { describe, it, expect, vi, beforeEach } from "vitest";

const createMock = vi.fn();

vi.mock("groq-sdk", () => ({
  default: class Groq {
    chat = { completions: { create: createMock } };
    constructor(_opts: unknown) {}
  },
}));

// The real serializeGroqCall is used, NOT a passthrough — the concurrent
// Promise.all test depends on the actual single-slot lock behavior to
// verify that queued rows recheck the fast-fail flag after acquiring the
// lock. Passthrough mock would defeat the very seam we're verifying.
// Tradeoff: 2s inter-call gap on serial runs; acceptable for a small
// integration test file.

import { extractJobFromEvidence } from "./extract-job";
import {
  _resetRateLimitFastFailForTests,
  _resetSerializerForTests,
} from "./rate-limiter";

process.env.GROQ_API_KEY = "test-key";

/** Baseline extractor input — enough sections that we DON'T take the "only URL"
 *  early-out. Two sections (per-board hints + jd_body) is enough. */
function inputWithBody(url = "https://example.com/job") {
  return {
    url,
    perBoardHints: {
      company: "Acme",
      title: "Software Engineer Intern",
      locations: ["Remote"],
      jd_body: "We're looking for a rising junior with React experience.".repeat(20),
    },
  };
}

/** Real-shape Groq 429 error string as observed in production. */
const TPD_429_ERROR = Object.assign(new Error(
  '429 {"error":{"message":"Rate limit reached for model `llama-3.3-70b-versatile` in organization `org_x` service tier `on_demand` on tokens per day (TPD): Limit 100000, Used 97843, Requested 9191. Please try again in 1h53m56s.","type":"tokens","code":"rate_limit_exceeded"}}'
), { status: 429 });

beforeEach(() => {
  createMock.mockReset();
  _resetRateLimitFastFailForTests();
  _resetSerializerForTests();
  vi.useRealTimers();
});

describe("extractJobFromEvidence — rate-limit fast-fail cooldown", () => {
  it("first call hits Groq; catches 429; returns rate_limited=true", async () => {
    createMock.mockRejectedValueOnce(TPD_429_ERROR);
    const result = await extractJobFromEvidence(inputWithBody("https://example.com/1"));

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(result.rate_limited).toBe(true);
    expect(result.jd_url).toBe("https://example.com/1");
  });

  it("second call within cooldown does NOT hit Groq (fast-fails)", async () => {
    // Warm up the cooldown by burning one 429 on the first call.
    createMock.mockRejectedValueOnce(TPD_429_ERROR);
    await extractJobFromEvidence(inputWithBody("https://example.com/1"));
    expect(createMock).toHaveBeenCalledTimes(1);

    // Now the second call: should skip Groq entirely.
    createMock.mockClear();
    const result = await extractJobFromEvidence(inputWithBody("https://example.com/2"));

    expect(createMock).toHaveBeenCalledTimes(0);
    expect(result.rate_limited).toBe(true);
    expect(result.jd_url).toBe("https://example.com/2");
    expect(result.notes).toMatch(/skipped/i);
  });

  it("call after cooldown expires DOES hit Groq again", async () => {
    // Fake timers so we can advance past the 30s cooldown without waiting.
    vi.useFakeTimers();

    createMock.mockRejectedValueOnce(TPD_429_ERROR);
    await extractJobFromEvidence(inputWithBody("https://example.com/1"));
    expect(createMock).toHaveBeenCalledTimes(1);

    // Just under the cooldown boundary: still fast-fail.
    vi.advanceTimersByTime(29_000);
    createMock.mockClear();
    const inCooldown = await extractJobFromEvidence(inputWithBody("https://example.com/2"));
    expect(createMock).toHaveBeenCalledTimes(0);
    expect(inCooldown.rate_limited).toBe(true);

    // Advance past the cooldown boundary: next call attempts Groq again.
    vi.advanceTimersByTime(2_000);
    createMock.mockClear();
    // Intentionally short message with no substrings that trip isRateLimitError:
    // "rate limit", "rate_limit", "tokens per day", "tokens per minute".
    createMock.mockRejectedValueOnce(new Error("kaboom"));
    const afterCooldown = await extractJobFromEvidence(inputWithBody("https://example.com/3"));
    expect(createMock).toHaveBeenCalledTimes(1);
    // Non-rate-limit error → still returns SAFE_DEFAULT but rate_limited=false.
    expect(afterCooldown.rate_limited).toBe(false);
  });

  it("three concurrent calls after a 429 collapse to one Groq hit", async () => {
    // The batch-in-flight scenario: three rows fired via Promise.all. Row 1
    // triggers a real 429 (~30s in prod under retry-backoff, ~0ms here);
    // rows 2 & 3 should fast-fail without calling Groq.
    //
    // Under serializeGroqCall's single-slot lock, rows 1/2/3 run strictly
    // serially. Row 1 sets the cooldown timestamp inside its catch block;
    // rows 2/3 check the timestamp before their own serializeGroqCall entry
    // and short-circuit. In prod that collapses ~90s → ~30s, well under
    // Vercel's 60s cap. Verified here by asserting createMock.callCount=1.
    createMock.mockRejectedValueOnce(TPD_429_ERROR);
    // The other rejections shouldn't fire — but stage them defensively so a
    // regression that DOES hit Groq gives a clear failure signature (not
    // silent success on stale mock state).
    createMock.mockRejectedValue(new Error("unexpected extra call"));

    const results = await Promise.all([
      extractJobFromEvidence(inputWithBody("https://example.com/r1")),
      extractJobFromEvidence(inputWithBody("https://example.com/r2")),
      extractJobFromEvidence(inputWithBody("https://example.com/r3")),
    ]);

    expect(createMock).toHaveBeenCalledTimes(1);
    for (const r of results) {
      expect(r.rate_limited).toBe(true);
    }
  });
});
