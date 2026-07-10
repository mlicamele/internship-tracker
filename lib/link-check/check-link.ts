// Detect whether a role's jd_url still points at a live posting.
// Called by scripts/validate-links.ts and /api/cron/validate-links.
//
// Detection ladder (returns on the first conclusive answer):
//   1. Null / malformed URL         → unknown / no_url|invalid_url
//   2. Board-specific public API    → dead|live (real 404 vs 200)
//   3. Direct HTTP GET
//        3a. 404/410/451             → dead
//        3b. 5xx                     → unknown (server error, not proof)
//        3c. other 4xx               → suspect (403 often = bot wall)
//        3d. soft-404 body copy      → dead
//        3e. redirected to careers   → dead
//        3f. bot-wall body copy      → suspect (can't tell for sure)
//        3g. body suspiciously small → suspect
//        3h. otherwise               → live
//   4. Fetch throws (timeout, DNS)  → unknown / fetch_error
//
// "suspect" means "human should look" — surfaced with an amber badge
// alongside "dead" (red). "unknown" is never badged (either not yet
// probed, or the probe itself was inconclusive).
//
// Only uses the public URL / board APIs; no auth, no headless browser.
// A bot-walled page (Cloudflare Turnstile) is inherently ambiguous —
// we can't tell if the underlying posting is live or gone.

import { identifyBoard } from "@/lib/scrape/identify";
import type { LinkStatus } from "@/lib/db/types";

export interface LinkCheckResult {
  status: LinkStatus;
  /** Short machine-readable reason (e.g. "http_404", "soft_404_body"). */
  reason: string;
  /** Diagnostic detail — HTTP status, final URL after redirect, matched regex, etc. */
  details?: Record<string, unknown>;
}

const USER_AGENT =
  "Mozilla/5.0 (compatible; InternshipTracker-LinkValidator/1.0)";
const FETCH_TIMEOUT_MS = 10000;
const MIN_LIVE_BODY_CHARS = 500;

// ------------------------------------------------------------
// Body-content patterns
// ------------------------------------------------------------
// Soft-404: the server returned 200 but the copy explicitly says the
// posting is gone / closed / not accepting apps. Order doesn't matter,
// first hit wins.
const SOFT_404_PATTERNS: RegExp[] = [
  /no longer accepting applications/i,
  /this (?:job|position|posting|opportunity|role) (?:has been|is) closed/i,
  /this (?:job|position|posting|role) (?:is )?no longer (?:available|active|open)/i,
  /this (?:job|position|role) (?:has been|is) filled/i,
  /we (?:couldn't|could not|cannot) find (?:the |that )?(?:job|posting|page|position)/i,
  /page not found/i,
  /this posting has been removed/i,
  /the position you (?:were|are) looking for (?:is )?no longer/i,
  /job (?:not found|does not exist)/i,
  /position has been filled/i,
];

// Bot-wall: Cloudflare, Akamai, etc. The underlying posting may still be
// live — we just can't see it from a raw fetch. Surface as suspect so a
// human eyeballs it.
const BOT_WALL_PATTERNS: RegExp[] = [
  /just a moment/i,
  /please verify (?:you are (?:a )?human|that you'?re not a robot)/i,
  /enable javascript.*continue/i,
  /cf-turnstile|__cf_chl_/i,
  /attention required.*cloudflare/i,
  /checking your browser (?:before|to)/i,
  /distil_r_captcha|_incapsula_/i,
  /access denied.*edgesuite/i,
];

// After following redirects, if the final URL's path matches any of
// these it means the posting URL bounced back to a careers landing /
// homepage — strong dead signal. Match on pathname only.
const CAREERS_INDEX_PATH_PATTERNS: RegExp[] = [
  /^\/?$/, // homepage
  /^\/careers\/?$/i,
  /^\/careers\/(?:search|jobs|all|open)\/?$/i,
  /^\/jobs\/?$/i,
  /^\/opportunities\/?$/i,
  /^\/[a-z]{2}-[A-Z]{2}\/?$/i, // workday locale-only landing
  /^\/wday\/cxs\/[^/]+\/[^/]+\/?$/i, // workday tenant/site with no job
];

// ------------------------------------------------------------
// Pure classifiers — exposed for unit tests
// ------------------------------------------------------------

export interface BodyClassification {
  softlyDead: boolean;
  botWalled: boolean;
  matched?: string;
}

export function classifyBody(body: string): BodyClassification {
  const excerpt = body.slice(0, 20000);
  for (const p of SOFT_404_PATTERNS) {
    if (p.test(excerpt)) {
      return { softlyDead: true, botWalled: false, matched: p.source };
    }
  }
  for (const p of BOT_WALL_PATTERNS) {
    if (p.test(excerpt)) {
      return { softlyDead: false, botWalled: true, matched: p.source };
    }
  }
  return { softlyDead: false, botWalled: false };
}

export interface FinalUrlClassification {
  redirectedToIndex: boolean;
  matchedPattern?: string;
}

export function classifyFinalUrl(
  originalUrl: string,
  finalUrl: string
): FinalUrlClassification {
  let orig: URL;
  let fin: URL;
  try {
    orig = new URL(originalUrl);
    fin = new URL(finalUrl);
  } catch {
    return { redirectedToIndex: false };
  }
  if (orig.href === fin.href) return { redirectedToIndex: false };
  for (const p of CAREERS_INDEX_PATH_PATTERNS) {
    if (p.test(fin.pathname)) {
      return { redirectedToIndex: true, matchedPattern: p.source };
    }
  }
  return { redirectedToIndex: false };
}

// ------------------------------------------------------------
// Layer 1: board API probe
// ------------------------------------------------------------
// Ashby uses a POST GraphQL endpoint that's non-trivial to probe safely
// (a bad request looks the same as a missing job). We fall through to
// direct HTTP for Ashby URLs — Ashby returns real 404s on the jobs page.

interface BoardApiProbe {
  apiUrl: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: BodyInit;
  kind: string;
}

function boardApiProbeFor(url: string): BoardApiProbe | null {
  const board = identifyBoard(url);
  if (!board.company || !board.jobId) return null;
  if (board.kind === "greenhouse") {
    return {
      kind: "greenhouse",
      apiUrl: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.company)}/jobs/${encodeURIComponent(board.jobId)}`,
      method: "GET",
      headers: { Accept: "application/json" },
    };
  }
  if (board.kind === "lever") {
    return {
      kind: "lever",
      apiUrl: `https://api.lever.co/v0/postings/${encodeURIComponent(board.company)}/${encodeURIComponent(board.jobId)}`,
      method: "GET",
      headers: { Accept: "application/json" },
    };
  }
  if (
    board.kind === "workday" &&
    board.extras?.host &&
    board.extras?.site
  ) {
    return {
      kind: "workday",
      apiUrl: `https://${board.extras.host}/wday/cxs/${encodeURIComponent(board.company)}/${encodeURIComponent(board.extras.site)}/job/${board.jobId}`,
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: "{}",
    };
  }
  return null;
}

async function probeBoardApi(url: string): Promise<LinkCheckResult | null> {
  const probe = boardApiProbeFor(url);
  if (!probe) return null;
  try {
    const res = await fetch(probe.apiUrl, {
      method: probe.method,
      headers: probe.headers,
      body: probe.body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 404) {
      return {
        status: "dead",
        reason: `${probe.kind}_api_404`,
        details: { httpStatus: 404, apiUrl: probe.apiUrl },
      };
    }
    if (res.ok) {
      return {
        status: "live",
        reason: `${probe.kind}_api_200`,
        details: { httpStatus: res.status, apiUrl: probe.apiUrl },
      };
    }
    // 5xx or other inconclusive — let the direct probe try.
    return null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------
// Layer 2: direct HTTP probe
// ------------------------------------------------------------

async function probeDirect(url: string): Promise<LinkCheckResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: "unknown",
      reason: "fetch_error",
      details: { error: msg },
    };
  }

  const finalUrl = res.url || url;

  if (res.status === 404 || res.status === 410 || res.status === 451) {
    return {
      status: "dead",
      reason: `http_${res.status}`,
      details: { httpStatus: res.status, finalUrl },
    };
  }

  if (res.status >= 500) {
    return {
      status: "unknown",
      reason: `http_${res.status}`,
      details: { httpStatus: res.status, finalUrl },
    };
  }

  if (!res.ok) {
    return {
      status: "suspect",
      reason: `http_${res.status}`,
      details: { httpStatus: res.status, finalUrl },
    };
  }

  let body: string;
  try {
    body = await res.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: "unknown",
      reason: "body_read_error",
      details: { error: msg, finalUrl },
    };
  }

  const bodyClass = classifyBody(body);
  if (bodyClass.softlyDead) {
    return {
      status: "dead",
      reason: "soft_404_body",
      details: { finalUrl, matched: bodyClass.matched },
    };
  }

  const urlClass = classifyFinalUrl(url, finalUrl);
  if (urlClass.redirectedToIndex) {
    return {
      status: "dead",
      reason: "redirected_to_careers_index",
      details: {
        originalUrl: url,
        finalUrl,
        matchedPattern: urlClass.matchedPattern,
      },
    };
  }

  if (bodyClass.botWalled) {
    return {
      status: "suspect",
      reason: "bot_wall",
      details: { finalUrl, matched: bodyClass.matched },
    };
  }

  if (body.trim().length < MIN_LIVE_BODY_CHARS) {
    return {
      status: "suspect",
      reason: "empty_body",
      details: { finalUrl, bodyLength: body.length },
    };
  }

  return {
    status: "live",
    reason: "http_200_body_ok",
    details: { finalUrl, bodyLength: body.length },
  };
}

// ------------------------------------------------------------
// Public entry point
// ------------------------------------------------------------

export async function checkLink(url: string | null): Promise<LinkCheckResult> {
  if (!url) return { status: "unknown", reason: "no_url" };
  try {
    new URL(url);
  } catch {
    return { status: "unknown", reason: "invalid_url" };
  }

  const boardResult = await probeBoardApi(url);
  if (boardResult) return boardResult;

  return probeDirect(url);
}
