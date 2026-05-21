// Server-side URL scraper. Fetches an HTML page, routes to a per-board parser
// by hostname, applies regex extractors over the body, returns a structured
// ScrapeResult. Never throws — returns thin=true on any failure.

import * as cheerio from "cheerio";
import { extractAll } from "./extract";
import { parse as parseGreenhouse } from "./parsers/greenhouse";
import { parse as parseLever } from "./parsers/lever";
import { parse as parseAshby } from "./parsers/ashby";
import { parse as parseGeneric } from "./parsers/generic";
import type { TargetSeason, WorkModel } from "@/lib/db/types";

export interface ParserResult {
  company: string | null;
  title: string | null;
  location: string | null;
  jd_body: string;
  extras: Record<string, string | null>;
}

export interface ScrapeResult {
  company: string | null;
  title: string | null;
  location: string | null;
  jd_body: string;
  jd_url: string;
  deadline_at: string | null;
  posted_at: string | null;
  work_model: WorkModel;
  target_year: number | null;
  target_season: TargetSeason | null;
  compensation_text: string | null;
  compensation_hourly_cents: number | null;
  thin: boolean;
}

const THIN_THRESHOLD = 500;
const FETCH_TIMEOUT_MS = 8000;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function selectParser(
  hostname: string
): (typeof parseGeneric) {
  if (
    hostname.includes("greenhouse.io") ||
    hostname.includes("job-boards.greenhouse.io")
  ) {
    return parseGreenhouse;
  }
  if (hostname.includes("lever.co")) return parseLever;
  if (hostname.includes("ashbyhq.com")) return parseAshby;
  return parseGeneric;
}

function emptyResult(url: string): ScrapeResult {
  return {
    company: null,
    title: null,
    location: null,
    jd_body: "",
    jd_url: url,
    deadline_at: null,
    posted_at: null,
    work_model: "unspecified",
    target_year: null,
    target_season: null,
    compensation_text: null,
    compensation_hourly_cents: null,
    thin: true,
  };
}

export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return emptyResult(url);
  }

  let html: string;
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
    if (!res.ok) return emptyResult(url);
    html = await res.text();
  } catch {
    return emptyResult(url);
  }

  let $: ReturnType<typeof cheerio.load>;
  try {
    $ = cheerio.load(html);
  } catch {
    return emptyResult(url);
  }

  const parser = selectParser(parsedUrl.hostname);
  const parsed = parser($ as unknown as cheerio.CheerioAPI);

  // Layer og:* / link[rel=canonical] tags on top of parser output
  const canonical =
    $('link[rel="canonical"]').attr("href") ||
    $('meta[property="og:url"]').attr("content") ||
    url;

  const title =
    parsed.title ||
    $('meta[property="og:title"]').attr("content") ||
    $("title").first().text().trim() ||
    null;

  const body = parsed.jd_body.replace(/\s+/g, " ").trim();
  const thin = body.length < THIN_THRESHOLD;

  // Run regex extractors over the body
  const extracted = extractAll(body);

  return {
    company: parsed.company,
    title,
    location: parsed.location,
    jd_body: body,
    jd_url: canonical,
    deadline_at: extracted.deadline_at,
    posted_at: extracted.posted_at,
    work_model: extracted.work_model,
    target_year: extracted.target_year,
    target_season: extracted.target_season,
    compensation_text: extracted.compensation_text,
    compensation_hourly_cents: extracted.compensation_hourly_cents,
    thin,
  };
}
