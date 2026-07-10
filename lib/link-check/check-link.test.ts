import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkLink,
  classifyBody,
  classifyFinalUrl,
} from "./check-link";

// Minimum body length above which a live response isn't flagged as
// "empty_body". Keep in sync with MIN_LIVE_BODY_CHARS in check-link.ts.
const HEALTHY_BODY = "x".repeat(2000);

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url, init);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

function htmlResponse(status: number, body: string, finalUrl?: string): Response {
  const res = new Response(body, {
    status,
    headers: { "content-type": "text/html" },
  });
  if (finalUrl) {
    Object.defineProperty(res, "url", { value: finalUrl });
  }
  return res;
}

function jsonResponse(status: number, obj: unknown): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("classifyBody", () => {
  it("returns clean on a normal JD body", () => {
    const body =
      "We are looking for a Software Engineering Intern to join our team...";
    expect(classifyBody(body)).toEqual({
      softlyDead: false,
      botWalled: false,
    });
  });

  it("detects 'no longer accepting applications'", () => {
    const c = classifyBody("Thanks for your interest. We are no longer accepting applications for this role.");
    expect(c.softlyDead).toBe(true);
    expect(c.botWalled).toBe(false);
    expect(c.matched).toBeDefined();
  });

  it("detects 'position has been filled'", () => {
    const c = classifyBody("Sorry — this position has been filled.");
    expect(c.softlyDead).toBe(true);
  });

  it("detects 'page not found'", () => {
    const c = classifyBody("<h1>Page not found</h1>");
    expect(c.softlyDead).toBe(true);
  });

  it("detects Cloudflare 'Just a moment...' page", () => {
    const c = classifyBody("<title>Just a moment...</title><div>Please wait</div>");
    expect(c.botWalled).toBe(true);
    expect(c.softlyDead).toBe(false);
  });

  it("detects cf-turnstile bot wall", () => {
    const c = classifyBody('<div class="cf-turnstile" data-sitekey="..."></div>');
    expect(c.botWalled).toBe(true);
  });

  it("soft-404 wins over bot-wall when both patterns match", () => {
    // If a page says both "no longer accepting" and "cf-turnstile", we
    // trust the explicit dead signal over the bot wall.
    const c = classifyBody(
      "We are no longer accepting applications. cf-turnstile."
    );
    expect(c.softlyDead).toBe(true);
    expect(c.botWalled).toBe(false);
  });

  it("only inspects the first 20k chars (perf guard)", () => {
    const filler = " ".repeat(30000);
    const c = classifyBody(filler + " no longer accepting applications ");
    // Signal is past the excerpt window — must not trigger.
    expect(c.softlyDead).toBe(false);
  });
});

describe("classifyFinalUrl", () => {
  it("returns clean when original === final", () => {
    const c = classifyFinalUrl(
      "https://boards.greenhouse.io/anthropic/jobs/4456891",
      "https://boards.greenhouse.io/anthropic/jobs/4456891"
    );
    expect(c.redirectedToIndex).toBe(false);
  });

  it("detects redirect to homepage", () => {
    const c = classifyFinalUrl(
      "https://acme.com/careers/jobs/eng-intern-1234",
      "https://acme.com/"
    );
    expect(c.redirectedToIndex).toBe(true);
  });

  it("detects redirect to /careers", () => {
    const c = classifyFinalUrl(
      "https://acme.com/careers/jobs/eng-intern-1234",
      "https://acme.com/careers"
    );
    expect(c.redirectedToIndex).toBe(true);
  });

  it("detects redirect to /careers/search", () => {
    const c = classifyFinalUrl(
      "https://acme.com/careers/jobs/eng-intern-1234",
      "https://acme.com/careers/search"
    );
    expect(c.redirectedToIndex).toBe(true);
  });

  it("does NOT flag same-shape redirect to a different job", () => {
    // If Workday redirects to a different job path (rare but possible),
    // it's still a job page — not a careers-index redirect.
    const c = classifyFinalUrl(
      "https://acme.wd12.myworkdayjobs.com/site/job/old-slug",
      "https://acme.wd12.myworkdayjobs.com/site/job/new-slug"
    );
    expect(c.redirectedToIndex).toBe(false);
  });

  it("returns clean when either URL is malformed", () => {
    const c = classifyFinalUrl("not a url", "also not a url");
    expect(c.redirectedToIndex).toBe(false);
  });
});

describe("checkLink — early guards", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("returns unknown/no_url on null", async () => {
    const r = await checkLink(null);
    expect(r).toEqual({ status: "unknown", reason: "no_url" });
  });

  it("returns unknown/invalid_url on malformed input", async () => {
    const r = await checkLink("::::not a url::::");
    expect(r).toEqual({ status: "unknown", reason: "invalid_url" });
  });
});

describe("checkLink — board API layer", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("returns dead when greenhouse API 404s", async () => {
    const spy = mockFetch(async (url) => {
      if (url.includes("boards-api.greenhouse.io")) {
        return jsonResponse(404, { error: "not found" });
      }
      throw new Error("unexpected fetch: " + url);
    });
    const r = await checkLink(
      "https://job-boards.greenhouse.io/anthropic/jobs/4456891"
    );
    expect(r.status).toBe("dead");
    expect(r.reason).toBe("greenhouse_api_404");
    expect(spy).toHaveBeenCalledOnce();
  });

  it("returns live when greenhouse API 200s (short-circuits before direct GET)", async () => {
    const spy = mockFetch(async (url) => {
      if (url.includes("boards-api.greenhouse.io")) {
        return jsonResponse(200, { id: 4456891, title: "SWE Intern" });
      }
      throw new Error("unexpected fetch: " + url);
    });
    const r = await checkLink(
      "https://job-boards.greenhouse.io/anthropic/jobs/4456891"
    );
    expect(r.status).toBe("live");
    expect(r.reason).toBe("greenhouse_api_200");
    expect(spy).toHaveBeenCalledOnce(); // no fallback
  });

  it("falls through to direct probe on board-API 5xx", async () => {
    const spy = mockFetch(async (url) => {
      if (url.includes("boards-api.greenhouse.io")) {
        return jsonResponse(500, { error: "boom" });
      }
      return htmlResponse(200, HEALTHY_BODY);
    });
    const r = await checkLink(
      "https://job-boards.greenhouse.io/anthropic/jobs/4456891"
    );
    expect(r.status).toBe("live");
    expect(r.reason).toBe("http_200_body_ok");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("returns dead when lever API 404s", async () => {
    mockFetch(async (url) => {
      if (url.includes("api.lever.co")) {
        return jsonResponse(404, {});
      }
      throw new Error("unexpected fetch: " + url);
    });
    const r = await checkLink("https://jobs.lever.co/discord/some-posting-id");
    expect(r.status).toBe("dead");
    expect(r.reason).toBe("lever_api_404");
  });

  it("returns dead when workday CXS API 404s", async () => {
    mockFetch(async (url) => {
      if (url.includes("/wday/cxs/")) {
        return jsonResponse(404, {});
      }
      throw new Error("unexpected fetch: " + url);
    });
    const r = await checkLink(
      "https://salesforce.wd12.myworkdayjobs.com/en-US/External_Career_Site/job/some-slug-123"
    );
    expect(r.status).toBe("dead");
    expect(r.reason).toBe("workday_api_404");
  });

  it("board without company/jobId falls through to direct probe", async () => {
    mockFetch(async () => htmlResponse(200, HEALTHY_BODY));
    // greenhouse landing page (company-only, no jobId)
    const r = await checkLink("https://boards.greenhouse.io/anthropic");
    expect(r.status).toBe("live");
    expect(r.reason).toBe("http_200_body_ok");
  });
});

describe("checkLink — direct probe layer (non-board URLs)", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  const jobUrl = "https://acme.com/careers/jobs/eng-intern-1234";

  it("returns dead on http 404", async () => {
    mockFetch(async () => htmlResponse(404, "Not Found", jobUrl));
    const r = await checkLink(jobUrl);
    expect(r.status).toBe("dead");
    expect(r.reason).toBe("http_404");
  });

  it("returns dead on http 410 (Gone)", async () => {
    mockFetch(async () => htmlResponse(410, "Gone", jobUrl));
    const r = await checkLink(jobUrl);
    expect(r.status).toBe("dead");
    expect(r.reason).toBe("http_410");
  });

  it("returns dead on http 451 (legal takedown)", async () => {
    mockFetch(async () => htmlResponse(451, "Unavailable For Legal Reasons", jobUrl));
    const r = await checkLink(jobUrl);
    expect(r.status).toBe("dead");
    expect(r.reason).toBe("http_451");
  });

  it("returns unknown on 5xx", async () => {
    mockFetch(async () => htmlResponse(503, "Service Unavailable", jobUrl));
    const r = await checkLink(jobUrl);
    expect(r.status).toBe("unknown");
    expect(r.reason).toBe("http_503");
  });

  it("returns suspect on 403 (often a bot wall at network edge)", async () => {
    mockFetch(async () => htmlResponse(403, "Forbidden", jobUrl));
    const r = await checkLink(jobUrl);
    expect(r.status).toBe("suspect");
    expect(r.reason).toBe("http_403");
  });

  it("returns dead on soft-404 body copy (200 status)", async () => {
    mockFetch(async () =>
      htmlResponse(
        200,
        HEALTHY_BODY + " This position is no longer available.",
        jobUrl
      )
    );
    const r = await checkLink(jobUrl);
    expect(r.status).toBe("dead");
    expect(r.reason).toBe("soft_404_body");
  });

  it("returns dead when 200 status redirects to /careers", async () => {
    mockFetch(async () =>
      htmlResponse(200, HEALTHY_BODY, "https://acme.com/careers")
    );
    const r = await checkLink(jobUrl);
    expect(r.status).toBe("dead");
    expect(r.reason).toBe("redirected_to_careers_index");
  });

  it("returns suspect on bot-wall body", async () => {
    mockFetch(async () =>
      htmlResponse(
        200,
        "<title>Just a moment...</title>" + "x".repeat(1000),
        jobUrl
      )
    );
    const r = await checkLink(jobUrl);
    expect(r.status).toBe("suspect");
    expect(r.reason).toBe("bot_wall");
  });

  it("returns suspect on suspiciously small body (200 status)", async () => {
    mockFetch(async () => htmlResponse(200, "<html></html>", jobUrl));
    const r = await checkLink(jobUrl);
    expect(r.status).toBe("suspect");
    expect(r.reason).toBe("empty_body");
  });

  it("returns live on healthy 200 body", async () => {
    mockFetch(async () => htmlResponse(200, HEALTHY_BODY, jobUrl));
    const r = await checkLink(jobUrl);
    expect(r.status).toBe("live");
    expect(r.reason).toBe("http_200_body_ok");
  });

  it("returns unknown on network error (timeout / DNS)", async () => {
    mockFetch(async () => {
      throw new Error("ECONNREFUSED");
    });
    const r = await checkLink(jobUrl);
    expect(r.status).toBe("unknown");
    expect(r.reason).toBe("fetch_error");
  });

  it("soft-404 wins over careers-index redirect", async () => {
    // Both signals present — the explicit soft-404 body copy is a
    // stronger dead signal than the URL-based heuristic.
    mockFetch(async () =>
      htmlResponse(
        200,
        HEALTHY_BODY + " This position is no longer accepting applications.",
        "https://acme.com/careers"
      )
    );
    const r = await checkLink(jobUrl);
    expect(r.status).toBe("dead");
    expect(r.reason).toBe("soft_404_body");
  });
});
