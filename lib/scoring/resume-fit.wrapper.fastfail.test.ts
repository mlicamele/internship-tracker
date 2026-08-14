// @vitest-environment node
//
// Verify scoreResumeFit's fast-fail cooldown at the wrapper boundary.
// Mirrors lib/llm/extract-job.wrapper.test.ts — same load-bearing behavior,
// same class of production bug (batched sequential LLM calls each burning
// ~30s of SDK retry-backoff under a TPD wall, blowing Vercel's 60s cap).
// Distinct test file because it needs the REAL serializeGroqCall to
// verify the post-lock-recheck behavior on concurrent Promise.all callers.
// The neighboring resume-fit.wrapper.test.ts mocks the serializer as a
// passthrough, which would defeat the very seam this file verifies.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Role } from "@/lib/db/types";

const createMock = vi.fn();

vi.mock("groq-sdk", () => ({
  default: class Groq {
    chat = { completions: { create: createMock } };
    constructor(_opts: unknown) {}
  },
}));

import { scoreResumeFit } from "./resume-fit";
import {
  _resetRateLimitFastFailForTests,
  _resetSerializerForTests,
} from "@/lib/llm/rate-limiter";

process.env.GROQ_API_KEY = "test-key";

/** Real-shape Groq 429 error string as observed in production. */
const TPD_429_ERROR = Object.assign(
  new Error(
    '429 {"error":{"message":"Rate limit reached for model `llama-3.3-70b-versatile` in organization `org_x` service tier `on_demand` on tokens per day (TPD): Limit 100000, Used 97843, Requested 9191. Please try again in 1h53m56s.","type":"tokens","code":"rate_limit_exceeded"}}'
  ),
  { status: 429 }
);

/** Baseline scoring input with enough resume text to pass the min-signal guard. */
function scoringInput(resumeVersionId = "resume-1") {
  return {
    role: {
      title: "Software Engineer Intern",
      tags: ["SWE", "React"],
      jd_body_text:
        "Build fast web apps at scale using React and TypeScript. Rising junior expected.",
    } as Pick<Role, "title" | "tags" | "jd_body_text">,
    companyName: "Acme",
    resumeVersionId,
    resumeExtractedText:
      "Rising junior. Built a React dashboard reducing latency by 30%. TypeScript, Node.js, PostgreSQL. Summer intern at BetaCorp.".repeat(
        5
      ),
  };
}

beforeEach(() => {
  createMock.mockReset();
  _resetRateLimitFastFailForTests();
  _resetSerializerForTests();
  vi.useRealTimers();
});

describe("scoreResumeFit — rate-limit fast-fail cooldown", () => {
  it("first call hits Groq; catches 429; returns llm_error skippedReason", async () => {
    createMock.mockRejectedValueOnce(TPD_429_ERROR);
    const result = await scoreResumeFit(scoringInput("resume-1"));

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(result.score).toBeNull();
    expect(result.skippedReason).toBe("llm_error");
  });

  it("second call within cooldown does NOT hit Groq (fast-fails)", async () => {
    // Warm up the cooldown by burning one 429 on the first call.
    createMock.mockRejectedValueOnce(TPD_429_ERROR);
    await scoreResumeFit(scoringInput("resume-1"));
    expect(createMock).toHaveBeenCalledTimes(1);

    // Now the second call: should skip Groq entirely.
    createMock.mockClear();
    const result = await scoreResumeFit(scoringInput("resume-2"));

    expect(createMock).toHaveBeenCalledTimes(0);
    expect(result.score).toBeNull();
    expect(result.skippedReason).toBe("llm_error");
  });

  it("call after cooldown expires DOES hit Groq again", async () => {
    // Fake timers so we can advance past the 30s cooldown without waiting.
    vi.useFakeTimers();

    createMock.mockRejectedValueOnce(TPD_429_ERROR);
    await scoreResumeFit(scoringInput("resume-1"));
    expect(createMock).toHaveBeenCalledTimes(1);

    // Just under the cooldown boundary: still fast-fail.
    vi.advanceTimersByTime(29_000);
    createMock.mockClear();
    const inCooldown = await scoreResumeFit(scoringInput("resume-2"));
    expect(createMock).toHaveBeenCalledTimes(0);
    expect(inCooldown.skippedReason).toBe("llm_error");

    // Advance past the cooldown boundary: next call attempts Groq again.
    vi.advanceTimersByTime(2_000);
    createMock.mockClear();
    // Intentionally short message with no substrings that trip isRateLimitError:
    // "rate limit", "rate_limit", "tokens per day", "tokens per minute".
    createMock.mockRejectedValueOnce(new Error("kaboom"));
    const afterCooldown = await scoreResumeFit(scoringInput("resume-3"));
    expect(createMock).toHaveBeenCalledTimes(1);
    // Non-rate-limit error → still returns llm_error skippedReason.
    expect(afterCooldown.skippedReason).toBe("llm_error");
  });

  it("three concurrent calls after a 429 collapse to one Groq hit", async () => {
    // The batch-in-flight scenario: rescoreResumeFitBatch fires N sequential
    // scoreResumeFit calls, but a future concurrent caller (or interleaved
    // classification + scoring in the same process) would hit the same shape.
    // Row 1 triggers a real 429; rows 2 & 3 should fast-fail without calling
    // Groq. Under serializeGroqCall's single-slot lock the three run
    // strictly serially; the post-lock recheck inside the callback catches
    // rows 2/3 that passed the early check before row 1 flipped the flag.
    // In prod that collapses ~90s → ~30s per batch — the load-bearing
    // property for the 58-app main-swap rescore path in setMainResumeAction.
    createMock.mockRejectedValueOnce(TPD_429_ERROR);
    // Defensive: any extra call should give a clear failure signature.
    createMock.mockRejectedValue(new Error("unexpected extra call"));

    const results = await Promise.all([
      scoreResumeFit(scoringInput("resume-r1")),
      scoreResumeFit(scoringInput("resume-r2")),
      scoreResumeFit(scoringInput("resume-r3")),
    ]);

    expect(createMock).toHaveBeenCalledTimes(1);
    for (const r of results) {
      expect(r.skippedReason).toBe("llm_error");
    }
  });
});
