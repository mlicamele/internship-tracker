// Server-side URL scraper. Fetches an HTML page, looks for JSON-LD
// structured data, applies per-board hints, then hands everything to
// Sonnet for a single authoritative extraction. Never throws.
//
// Architecture (post-2025-05 rewrite):
//   1. fetch HTML with realistic UA + 10s timeout
//   2. cheerio parse
//   3. extract JSON-LD JobPosting (free, no LLM)
//   4. per-board parser collects HTML-based hints
//   5. Sonnet sees URL + JSON-LD + per-board hints + raw HTML excerpt
//   6. Sonnet returns fully-structured job, with confidence

import * as cheerio from "cheerio";
import {
  extractJobFromEvidence,
  type ExtractedJob,
} from "@/lib/anthropic/extract-job";
import {
  extractJobLd,
  flattenLocation,
  organizationName,
  stripHtml,
  type JsonLdJobPosting,
} from "./jsonld";
import { parse as parseGreenhouse } from "./parsers/greenhouse";
import { parse as parseLever } from "./parsers/lever";
import { parse as parseAshby } from "./parsers/ashby";
import { parse as parseGeneric } from "./parsers/generic";
import type { ParserResult } from "./url-types";

export type { ParserResult } from "./url-types";

export type ScrapeResult = ExtractedJob & { thin: boolean };

const FETCH_TIMEOUT_MS = 10000;
const THIN_THRESHOLD = 200;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function selectParser(hostname: string): (typeof parseGeneric) {
  if (hostname.includes("greenhouse.io")) return parseGreenhouse;
  if (hostname.includes("lever.co")) return parseLever;
  if (hostname.includes("ashbyhq.com")) return parseAshby;
  return parseGeneric;
}

function emptyResult(url: string): ScrapeResult {
  return {
    company: null,
    title: null,
    location_text: null,
    jd_body: "",
    jd_url: url,
    deadline_at: null,
    posted_at: null,
    work_model: "unspecified",
    target_year: null,
    target_season: "summer",
    class_year_tag: "unspecified",
    class_year_confidence: 0,
    compensation_text: null,
    compensation_hourly_cents: null,
    overall_confidence: 0,
    notes: "fetch or parse failed",
    thin: true,
  };
}

/**
 * Scrape a URL and return a fully-structured job posting.
 *
 * @param url    the job posting URL
 * @param userPastedJdBody  optional: user-pasted JD body (rare; form is URL-only now)
 */
export async function scrapeUrl(
  url: string,
  userPastedJdBody?: string
): Promise<ScrapeResult> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return emptyResult(url);
  }

  // 1. Fetch HTML
  let html = "";
  try {
    const res = await fetch(parsedUrl.toString(), {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
    if (res.ok) {
      html = await res.text();
    }
  } catch {
    // Network error: keep html empty, LLM will get URL-only
  }

  // 2. Parse with cheerio if we got HTML
  let jsonLd: JsonLdJobPosting | null = null;
  let perBoardHints: ParserResult | null = null;
  let canonicalUrl: string | undefined;

  if (html) {
    try {
      const $ = cheerio.load(html);
      jsonLd = extractJobLd($);
      const parser = selectParser(parsedUrl.hostname);
      perBoardHints = parser($ as unknown as cheerio.CheerioAPI);
      canonicalUrl =
        $('link[rel="canonical"]').attr("href") ||
        $('meta[property="og:url"]').attr("content") ||
        undefined;
    } catch {
      // ignore; continue with empty hints
    }
  }

  // 3. Prepare evidence for the LLM
  //    - If JSON-LD has a description, use it as the body excerpt (high quality)
  //    - Otherwise use per-board parser body, then raw HTML body text
  const jsonLdBody = jsonLd?.description ? stripHtml(jsonLd.description) : null;
  const bodyForLlm =
    userPastedJdBody ||
    jsonLdBody ||
    perBoardHints?.jd_body ||
    "";

  // Trim raw HTML to keep LLM cost predictable, prefer the <body> contents
  let htmlExcerpt: string | undefined;
  if (html && !jsonLdBody && (!perBoardHints?.jd_body || perBoardHints.jd_body.length < 300)) {
    try {
      const $ = cheerio.load(html);
      // Strip <script>, <style>, <nav>, <header>, <footer> from body for cleaner LLM input
      $("script, style, nav, header, footer, svg").remove();
      htmlExcerpt = $("body").text().replace(/\s+/g, " ").trim().slice(0, 12000);
    } catch {
      // ignore
    }
  }

  // 4. Build hints for the LLM (JSON-LD takes precedence over per-board)
  const llmHints: NonNullable<Parameters<typeof extractJobFromEvidence>[0]["perBoardHints"]> = {};
  if (jsonLd) {
    llmHints.company = organizationName(jsonLd.hiringOrganization);
    llmHints.title = jsonLd.title ?? null;
    llmHints.location = flattenLocation(jsonLd.jobLocation);
    llmHints.jd_body = jsonLdBody ?? undefined;
  }
  if (perBoardHints) {
    llmHints.company = llmHints.company || perBoardHints.company || null;
    llmHints.title = llmHints.title || perBoardHints.title || null;
    llmHints.location = llmHints.location || perBoardHints.location || null;
    llmHints.jd_body = llmHints.jd_body || perBoardHints.jd_body || undefined;
  }

  // 5. Run LLM extraction
  const extracted = await extractJobFromEvidence({
    url: canonicalUrl || url,
    htmlExcerpt,
    jsonLd: jsonLd ?? undefined,
    perBoardHints: llmHints,
    userPastedJdBody,
  });

  const thin = extracted.jd_body.length < THIN_THRESHOLD && !bodyForLlm;

  return { ...extracted, thin };
}
