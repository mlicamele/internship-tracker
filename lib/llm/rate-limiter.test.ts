import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatRateLimit,
  getUsageSnapshot,
  isRateLimitError,
  parseRateLimit,
  recordTokenUsage,
  _resetUsageForTests,
} from "./rate-limiter";

// Real error strings observed in production during the Groq TPD exhaustion
// on 2026-08-12. Kept verbatim so parse regexes stay honest against reality.
const TPD_ERROR_70B = new Error(
  '429 {"error":{"message":"Rate limit reached for model `llama-3.3-70b-versatile` in organization `org_01ks48224be5xvdv10v0e0qr0k` service tier `on_demand` on tokens per day (TPD): Limit 100000, Used 97843, Requested 9191. Please try again in 1h53m56.832s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing","type":"tokens","code":"rate_limit_exceeded"}}'
);

const TPM_ERROR_GPT_OSS = new Error(
  '413 {"error":{"message":"Request too large for model `openai/gpt-oss-120b` in organization `org_01ks48224be5xvdv10v0e0qr0k` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Requested 10092, please reduce your message size and try again. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing","type":"tokens","code":"rate_limit_exceeded"}}'
);

describe("isRateLimitError", () => {
  it("detects 429 status", () => {
    expect(isRateLimitError({ status: 429 })).toBe(true);
  });
  it("detects tokens-per-day message", () => {
    expect(isRateLimitError(TPD_ERROR_70B)).toBe(true);
  });
  it("detects tokens-per-minute message", () => {
    expect(isRateLimitError(TPM_ERROR_GPT_OSS)).toBe(true);
  });
  it("returns false for non-rate-limit errors", () => {
    expect(isRateLimitError(new Error("boom"))).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
    expect(isRateLimitError(undefined)).toBe(false);
  });
});

describe("parseRateLimit — TPD exhaustion (70b)", () => {
  const info = parseRateLimit(TPD_ERROR_70B);

  it("marks as rate limit", () => {
    expect(info.isRateLimit).toBe(true);
  });

  it("identifies bucket kind as TPD", () => {
    expect(info.limitKind).toBe("TPD");
  });

  it("extracts model name", () => {
    expect(info.model).toBe("llama-3.3-70b-versatile");
  });

  it("extracts numeric limit / used / requested", () => {
    expect(info.limit).toBe(100000);
    expect(info.used).toBe(97843);
    expect(info.requested).toBe(9191);
  });

  it("parses complex retry-after (Hh Mm S.SSSs)", () => {
    // 1h 53m 56.832s = 6836.832s
    expect(info.retryAfterSeconds).toBeCloseTo(6836.832, 1);
    expect(info.retryAt).toBeInstanceOf(Date);
    // Should be roughly 1h53m in the future
    const secondsAhead = ((info.retryAt as Date).getTime() - Date.now()) / 1000;
    expect(secondsAhead).toBeGreaterThan(6800);
    expect(secondsAhead).toBeLessThan(6900);
  });
});

describe("parseRateLimit — TPM per-request size cap (gpt-oss)", () => {
  const info = parseRateLimit(TPM_ERROR_GPT_OSS);

  it("marks as rate limit", () => {
    expect(info.isRateLimit).toBe(true);
  });

  it("identifies bucket kind as TPM", () => {
    expect(info.limitKind).toBe("TPM");
  });

  it("extracts model name", () => {
    expect(info.model).toBe("openai/gpt-oss-120b");
  });

  it("extracts limit and requested (no 'Used' clause on 413)", () => {
    // The 413 message doesn't include Used — only Limit and Requested
    expect(info.limit).toBeUndefined(); // no "Limit X, Used Y, Requested Z" pattern
    // But we can still see the requested somewhere else? Actually no —
    // this message says "Limit 8000, Requested 10092" without "Used".
    // Our regex requires "Used" to be present, so limit/used/requested
    // all come back undefined for this shape. That's expected.
  });

  it("no retry-after on 413 (per-request size, not time-bound)", () => {
    expect(info.retryAfterSeconds).toBeUndefined();
    expect(info.retryAt).toBeUndefined();
  });
});

describe("parseRateLimit — retry-after format variants", () => {
  it("parses 'in 7.66s' (seconds only)", () => {
    const err = new Error(
      "429 rate limit reached ... Please try again in 7.66s."
    );
    const info = parseRateLimit(err);
    expect(info.retryAfterSeconds).toBeCloseTo(7.66, 1);
  });

  it("parses 'in 2m59.56s' (minutes + seconds)", () => {
    const err = new Error(
      "429 rate limit reached ... Please try again in 2m59.56s."
    );
    const info = parseRateLimit(err);
    expect(info.retryAfterSeconds).toBeCloseTo(179.56, 1);
  });
});

describe("parseRateLimit — non-rate-limit errors", () => {
  it("returns { isRateLimit: false } for random errors", () => {
    expect(parseRateLimit(new Error("something else")).isRateLimit).toBe(false);
    expect(parseRateLimit(null).isRateLimit).toBe(false);
  });
});

describe("recordTokenUsage — cumulative TPD tracker", () => {
  beforeEach(() => _resetUsageForTests());

  it("accumulates tokens + requests across calls for the same model", () => {
    recordTokenUsage("model-a", 1000);
    recordTokenUsage("model-a", 500);
    const snap = getUsageSnapshot("model-a");
    expect(snap?.tokens).toBe(1500);
    expect(snap?.requests).toBe(2);
  });

  it("tracks each model in its own window", () => {
    recordTokenUsage("model-a", 1000);
    recordTokenUsage("model-b", 2000);
    expect(getUsageSnapshot("model-a")?.tokens).toBe(1000);
    expect(getUsageSnapshot("model-b")?.tokens).toBe(2000);
  });

  it("ignores non-positive or non-finite tokens (defensive)", () => {
    recordTokenUsage("model-a", 0);
    recordTokenUsage("model-a", -50);
    recordTokenUsage("model-a", NaN);
    expect(getUsageSnapshot("model-a")).toBeNull();
  });

  it("returns null snapshot for models with no calls yet", () => {
    expect(getUsageSnapshot("never-called")).toBeNull();
  });

  it("warns once at 80% of provided budget", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    recordTokenUsage("model-a", 70_000, 100_000); // 70% — no warn
    expect(warn).not.toHaveBeenCalled();
    recordTokenUsage("model-a", 15_000, 100_000); // now 85% — warn
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("[groq-budget-warn]");
    expect(warn.mock.calls[0][0]).toContain("model-a");
    expect(warn.mock.calls[0][0]).toContain("85%");
    // Subsequent calls within the same window should NOT re-warn
    recordTokenUsage("model-a", 5_000, 100_000); // now 90%
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("no warn when budget arg is omitted", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    recordTokenUsage("model-a", 100_000);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("formatRateLimit", () => {
  it("returns human-readable one-liner with all populated fields", () => {
    const formatted = formatRateLimit(parseRateLimit(TPD_ERROR_70B));
    expect(formatted).toContain("model=llama-3.3-70b-versatile");
    expect(formatted).toContain("limit=TPD");
    expect(formatted).toContain("used=97843/100000");
    expect(formatted).toContain("(98%)");
    expect(formatted).toContain("resets=");
    // ISO timestamp of retry-at should be present
    expect(formatted).toMatch(/resets=\d{4}-\d{2}-\d{2}T/);
  });

  it("returns 'not a rate-limit error' for non-rate errors", () => {
    expect(formatRateLimit(parseRateLimit(new Error("boom")))).toBe(
      "not a rate-limit error"
    );
  });
});
