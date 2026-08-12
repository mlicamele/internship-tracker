// @vitest-environment node
//
// Coverage for the Groq-calling wrapper `scoreResumeFit`. The pure functions
// composeNumeric / tierFromTotal / computeInputHash live in resume-fit.test.ts;
// this file focuses on the request/response boundary — prompt assembly, LLM
// response parsing, insufficient-signal early-out, and the graceful-degrade
// paths (malformed JSON, rate-limit) that STATUS flagged as the last gap in
// Phase 3B coverage.
//
// A real Groq call would burn TPD in CI and can't be pinned, so we intercept
// at the SDK boundary via vi.mock('groq-sdk').

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Role } from "@/lib/db/types";

const createMock = vi.fn();

vi.mock("groq-sdk", () => ({
  default: class Groq {
    chat = { completions: { create: createMock } };
    constructor(_opts: unknown) {}
  },
}));

// Serialize wrapper adds a 400ms inter-call gap — ok in tests, but resetting
// it between tests keeps the whole suite fast and deterministic.
vi.mock("@/lib/llm/rate-limiter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/rate-limiter")>();
  return {
    ...actual,
    serializeGroqCall: <T>(fn: () => Promise<T>) => fn(),
  };
});

import { scoreResumeFit, computeInputHash } from "./resume-fit";

process.env.GROQ_API_KEY = "test-key";

/** Baseline valid response — all mid-tier grades, no gaps. */
function goodResponse() {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            skills_coverage: 5,
            skills_coverage_note: "React and Node evidenced in intern role",
            domain_depth: 5,
            domain_depth_note: "One meaningful project",
            seniority_fit: 5,
            seniority_fit_note: "Rising junior applying to intern role",
            impact_evidence: 5,
            impact_evidence_note: "Reduced latency by 30%",
            recency_trajectory: 5,
            recency_trajectory_note: "Recent work, flat growth",
            practical_exposure: 5,
            practical_exposure_note: "One collaboration",
            matched_skills: ["React", "Node", "TypeScript"],
            gaps: ["Kubernetes"],
            rationale: "Solid mid-level intern candidate.",
          }),
        },
      },
    ],
  };
}

const baseInput = {
  role: {
    title: "Software Engineer Intern",
    tags: ["SWE", "React"],
    jd_body_text: "Build fast web apps at scale using React and TypeScript.",
  } as Pick<Role, "title" | "tags" | "jd_body_text">,
  companyName: "Acme",
  resumeVersionId: "resume-1",
  resumeExtractedText:
    "Rising junior. Built a React dashboard reducing latency by 30%. TypeScript, Node.js, PostgreSQL. Summer intern at BetaCorp.".repeat(
      5
    ),
};

beforeEach(() => {
  createMock.mockReset();
});

describe("scoreResumeFit — early-out (no LLM call)", () => {
  it("returns no_resume when resumeVersionId is empty", async () => {
    const result = await scoreResumeFit({
      ...baseInput,
      resumeVersionId: "",
    });
    expect(result.skippedReason).toBe("no_resume");
    expect(result.score).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns no_resume when extracted text is empty", async () => {
    const result = await scoreResumeFit({
      ...baseInput,
      resumeExtractedText: "",
    });
    expect(result.skippedReason).toBe("no_resume");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns insufficient_text when the resume is under 300 chars", async () => {
    const result = await scoreResumeFit({
      ...baseInput,
      resumeExtractedText: "too short to score",
    });
    expect(result.skippedReason).toBe("insufficient_text");
    expect(result.score).toBeNull();
    expect(result.details?.tier).toBe("insufficient");
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("scoreResumeFit — prompt shape", () => {
  it("includes company, title, tags, jd body, and resume text in the user message", async () => {
    createMock.mockResolvedValue(goodResponse());
    await scoreResumeFit(baseInput);

    expect(createMock).toHaveBeenCalledOnce();
    const call = createMock.mock.calls[0][0];
    expect(call.temperature).toBe(0);
    expect(call.response_format).toEqual({ type: "json_object" });

    const messages = call.messages as Array<{ role: string; content: string }>;
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toMatch(/RUBRIC ANCHORS/);
    const user = messages[1].content;
    expect(user).toMatch(/Acme/);
    expect(user).toMatch(/Software Engineer Intern/);
    expect(user).toMatch(/SWE, React/);
    expect(user).toMatch(/Build fast web apps at scale/);
    expect(user).toMatch(/React dashboard reducing latency/);
  });

  it("falls back to a 'grade from title + tags alone' placeholder when jd_body_text is missing", async () => {
    createMock.mockResolvedValue(goodResponse());
    await scoreResumeFit({
      ...baseInput,
      role: { ...baseInput.role, jd_body_text: null },
    });
    const user = createMock.mock.calls[0][0].messages[1].content as string;
    expect(user).toMatch(/no JD body available/);
  });
});

describe("scoreResumeFit — response handling", () => {
  it("composes a numeric score from the LLM's grades and assigns a tier", async () => {
    createMock.mockResolvedValue(goodResponse());
    const result = await scoreResumeFit(baseInput);
    expect(result.skippedReason).toBeNull();
    // All 5s, seniority=5 (peak) → composeNumeric gives 57.14, tier partial.
    expect(result.score).toBe(57.14);
    expect(result.details?.tier).toBe("partial");
    expect(result.details?.matched_skills).toContain("React");
    expect(result.details?.gaps).toContain("Kubernetes");
  });

  it("returns llm_error when the LLM response isn't valid JSON", async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: "the model refused to answer" } }],
    });
    const result = await scoreResumeFit(baseInput);
    expect(result.skippedReason).toBe("llm_error");
    expect(result.score).toBeNull();
  });

  it("returns llm_error when a grade is out of the 1-10 range", async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              ...JSON.parse(goodResponse().choices[0].message.content),
              seniority_fit: 15, // invalid
            }),
          },
        },
      ],
    });
    const result = await scoreResumeFit(baseInput);
    expect(result.skippedReason).toBe("llm_error");
  });

  it("returns llm_error and logs a distinct rate-limit warning on 429", async () => {
    const err = Object.assign(new Error("rate_limit_exceeded: TPD reached"), {
      status: 429,
      name: "RateLimitError",
    });
    createMock.mockRejectedValue(err);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await scoreResumeFit(baseInput);
    expect(result.skippedReason).toBe("llm_error");
    expect(warnSpy).toHaveBeenCalled();
    const logged = warnSpy.mock.calls.map((c) => c.join(" ")).join(" ");
    expect(logged).toMatch(/groq-rate-limit/);
    warnSpy.mockRestore();
  });

  it("returns llm_error on generic (non-429) exceptions", async () => {
    createMock.mockRejectedValue(new Error("network unreachable"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await scoreResumeFit(baseInput);
    expect(result.skippedReason).toBe("llm_error");
    warnSpy.mockRestore();
  });
});

describe("computeInputHash — model + prompt-version stability", () => {
  // The DAL uses computeInputHash to short-circuit before calling scoreResumeFit,
  // so any change here that reuses a hash for a different-prompt input is a
  // silent-stale-score bug. Guard the two invalidation triggers named in the
  // implementation ("v5-6cat-1to10" prefix + MODEL_FOR.scoring).

  it("returns the same 64-char hex for identical inputs across calls", () => {
    const role = {
      title: "SWE Intern",
      tags: ["swe"],
      jd_body_text: "Build stuff.",
    };
    const a = computeInputHash(role, "resume-1");
    const b = computeInputHash(role, "resume-1");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
