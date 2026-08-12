// Layered URL scraper:
//   1. Identify board (greenhouse / lever / ashby / etc) from URL
//   2. If supported board: call its public API (free, ~95% accuracy)
//   3. Always try direct fetch → JSON-LD parse (free, helps for SSR'd sites)
//   4. If still thin: try r.jina.ai reader-mode (free, headless internally)
//   5. If still thin AND CF browser env set: Cloudflare Workers Browser
//   6. Pass merged evidence to Haiku for structured extraction
//
// Never throws; returns safe defaults on any failure.

import * as cheerio from "cheerio";
import {
  extractJobFromEvidence,
  type ExtractedJob,
} from "@/lib/llm/extract-job";
import {
  extractJobLd,
  flattenLocations,
  organizationName,
  stripHtml,
} from "./jsonld";
import { identifyBoard } from "./identify";
import { fetchGreenhouseJob } from "./boards/greenhouse-api";
import { fetchLeverPosting } from "./boards/lever-api";
import { fetchAshbyJob } from "./boards/ashby-api";
import { fetchWorkdayJob } from "./boards/workday-api";
import { fetchViaJinaReader } from "./reader";
import { fetchViaCloudflareBrowser } from "./cf-browser";
import type { EvidenceLayer } from "./types";

export type ScrapeResult = ExtractedJob & {
  thin: boolean;
  evidence_sources: EvidenceLayer["source"][];
};

const FETCH_TIMEOUT_MS = 10000;
const THIN_BODY_THRESHOLD = 300;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function emptyResult(url: string): ScrapeResult {
  return {
    company: null,
    title: null,
    locations: [],
    jd_body: "",
    jd_url: url,
    deadline_at: null,
    posted_at: null,
    work_model: null,
    target_year: null,
    target_season: null,
    min_grad_year: null,
    max_grad_year: null,
    relocation_assistance: null,
    compensation_hourly_dollars: null,
    tags: [],
    confidences: {},
    overall_confidence: 0,
    notes: "no evidence gathered",
    thin: true,
    evidence_sources: [],
  };
}

async function directFetchAndJsonLd(url: string): Promise<EvidenceLayer | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (!html) return null;

    const $ = cheerio.load(html);
    const jsonLd = extractJobLd(
      $ as unknown as Parameters<typeof extractJobLd>[0]
    );

    if (jsonLd) {
      const body = jsonLd.description ? stripHtml(jsonLd.description) : "";
      return {
        source: "jsonld",
        company: organizationName(jsonLd.hiringOrganization),
        title: jsonLd.title ?? null,
        location_texts: flattenLocations(jsonLd.jobLocation),
        jd_body: body,
        jd_url:
          $('link[rel="canonical"]').attr("href") ||
          $('meta[property="og:url"]').attr("content") ||
          url,
        posted_at: jsonLd.datePosted ?? null,
        deadline_at: jsonLd.validThrough ?? null,
        raw: jsonLd as unknown as Record<string, unknown>,
      };
    }

    // Fallback: raw HTML body text (might be useful for the LLM)
    $("script, style, nav, header, footer, svg").remove();
    const body = $("body").text().replace(/\s+/g, " ").trim();
    if (body.length < 100) return null;
    return {
      source: "direct_fetch",
      company: null,
      title: $("title").first().text().trim() || null,
      location_texts: [],
      jd_body: body.slice(0, 15000),
      jd_url:
        $('link[rel="canonical"]').attr("href") ||
        $('meta[property="og:url"]').attr("content") ||
        url,
    };
  } catch {
    return null;
  }
}

export async function scrapeUrl(
  url: string,
  userPastedJd?: string
): Promise<ScrapeResult> {
  try {
    new URL(url);
  } catch {
    return emptyResult(url);
  }

  const board = identifyBoard(url);
  const evidence: EvidenceLayer[] = [];

  // Layer 1: board-specific API
  if (board.kind === "greenhouse" && board.company && board.jobId) {
    const ev = await fetchGreenhouseJob(board.company, board.jobId);
    if (ev) evidence.push(ev);
  } else if (board.kind === "lever" && board.company && board.jobId) {
    const ev = await fetchLeverPosting(board.company, board.jobId);
    if (ev) evidence.push(ev);
  } else if (board.kind === "ashby" && board.company && board.jobId) {
    const ev = await fetchAshbyJob(board.company, board.jobId);
    if (ev) evidence.push(ev);
  } else if (
    board.kind === "workday" &&
    board.company &&
    board.jobId &&
    board.extras?.host &&
    board.extras?.site
  ) {
    const ev = await fetchWorkdayJob(
      board.extras.host,
      board.company,
      board.extras.site,
      board.jobId
    );
    if (ev) evidence.push(ev);
  }

  // Layer 2: direct fetch + JSON-LD
  const directEv = await directFetchAndJsonLd(url);
  if (directEv) evidence.push(directEv);

  // Layer 3: r.jina.ai reader fallback (if no substantial body yet)
  const haveSubstantialBody = evidence.some(
    (e) => e.jd_body.length >= THIN_BODY_THRESHOLD
  );
  if (!haveSubstantialBody) {
    const jinaEv = await fetchViaJinaReader(url);
    if (jinaEv) evidence.push(jinaEv);
  }

  // Layer 4: Cloudflare Browser Rendering (if configured + still thin)
  const haveSubstantialBodyAfterJina = evidence.some(
    (e) => e.jd_body.length >= THIN_BODY_THRESHOLD
  );
  if (!haveSubstantialBodyAfterJina) {
    const cfEv = await fetchViaCloudflareBrowser(url);
    if (cfEv) evidence.push(cfEv);
  }

  const mergedHints = mergeEvidence(evidence);
  const bestBody = pickBestBody(evidence, userPastedJd);
  const compensationContext = extractCompensationContext(evidence, userPastedJd);

  const extracted = await extractJobFromEvidence({
    url,
    htmlExcerpt: mergedHints.htmlExcerpt,
    jsonLd: mergedHints.jsonLd,
    perBoardHints: {
      company: mergedHints.company,
      title: mergedHints.title,
      locations: mergedHints.location_texts,
      jd_body: bestBody,
    },
    userPastedJdBody: userPastedJd,
    compensationContext,
  });

  // Fallback fill: when LLM left a field blank but evidence had it
  const locations: ExtractedJob["locations"] =
    extracted.locations.length > 0
      ? extracted.locations
      : mergedHints.location_texts.map((text) => ({ text }));
  const filled: ExtractedJob = {
    ...extracted,
    company: extracted.company ?? mergedHints.company ?? null,
    title: extracted.title ?? mergedHints.title ?? null,
    locations,
    jd_body: extracted.jd_body || bestBody,
    jd_url: extracted.jd_url ?? mergedHints.jd_url ?? url,
    posted_at: extracted.posted_at ?? mergedHints.posted_at ?? null,
    deadline_at: extracted.deadline_at ?? mergedHints.deadline_at ?? null,
    work_model:
      extracted.work_model ?? mergedHints.work_model ?? null,
  };

  return {
    ...filled,
    thin: filled.jd_body.length < THIN_BODY_THRESHOLD,
    evidence_sources: evidence.map((e) => e.source),
  };
}

interface MergedHints {
  company: string | null;
  title: string | null;
  location_texts: string[];
  jd_url: string | null;
  posted_at: string | null;
  deadline_at: string | null;
  work_model: EvidenceLayer["work_model"];
  jsonLd: unknown;
  htmlExcerpt: string | undefined;
}

const SOURCE_PRIORITY: EvidenceLayer["source"][] = [
  "greenhouse_api",
  "lever_api",
  "ashby_api",
  "workday_api",
  "jsonld",
  "cf_browser",
  "jina_reader",
  "direct_fetch",
];

function mergeEvidence(layers: EvidenceLayer[]): MergedHints {
  const sorted = [...layers].sort(
    (a, b) => SOURCE_PRIORITY.indexOf(a.source) - SOURCE_PRIORITY.indexOf(b.source)
  );
  const merged: MergedHints = {
    company: null,
    title: null,
    location_texts: [],
    jd_url: null,
    posted_at: null,
    deadline_at: null,
    work_model: undefined,
    jsonLd: undefined,
    htmlExcerpt: undefined,
  };
  for (const layer of sorted) {
    merged.company ??= layer.company;
    merged.title ??= layer.title;
    if (merged.location_texts.length === 0 && layer.location_texts.length > 0) {
      merged.location_texts = layer.location_texts;
    }
    merged.jd_url ??= layer.jd_url;
    merged.posted_at ??= layer.posted_at ?? null;
    merged.deadline_at ??= layer.deadline_at ?? null;
    if (!merged.work_model && layer.work_model) {
      merged.work_model = layer.work_model;
    }
    if (!merged.jsonLd && layer.source === "jsonld" && layer.raw) {
      merged.jsonLd = layer.raw;
    }
    if (!merged.htmlExcerpt && layer.source === "direct_fetch") {
      merged.htmlExcerpt = layer.jd_body.slice(0, 12000);
    }
  }
  return merged;
}

/**
 * Scan ALL evidence bodies (untruncated) for windows containing pay-related
 * keywords. Pay disclosures (CA/NY/CO/WA pay transparency laws) often live in
 * a footer at the bottom of the JD, which gets cut by htmlExcerpt/jd_body
 * truncation. Returns concatenated ±300-char windows, or null if nothing
 * matches. Cap total at 3000 chars to stay budget-friendly.
 */
function extractCompensationContext(
  layers: EvidenceLayer[],
  userPasted?: string
): string | null {
  const sources: string[] = [];
  if (userPasted) sources.push(userPasted);
  for (const layer of layers) {
    if (layer.jd_body) sources.push(layer.jd_body);
  }
  const PAY_REGEX =
    /(compensation|pay\s*range|salary|hourly|stipend|wage|hiring\s*range|base\s*pay|annualized|\$\s?\d{1,3}(?:[,.]\d{3})*(?:\.\d+)?(?:\s?[kK])?|\/\s?(?:hr|hour|year|yr|month|mo|week|wk))/g;
  const WINDOW = 300;
  const seen = new Set<string>();
  const windows: string[] = [];
  let total = 0;
  const DOLLAR_FIGURE = /\$\s?\d/;
  for (const body of sources) {
    PAY_REGEX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PAY_REGEX.exec(body)) !== null) {
      const start = Math.max(0, m.index - WINDOW);
      const end = Math.min(body.length, m.index + m[0].length + WINDOW);
      const snippet = body.slice(start, end).replace(/\s+/g, " ").trim();
      if (snippet.length < 20) continue;
      // Require an actual dollar figure inside the window — drops keyword-only
      // false positives like "competitive salary and benefits" with no number.
      if (!DOLLAR_FIGURE.test(snippet)) continue;
      const key = snippet.slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      if (total + snippet.length > 3000) break;
      windows.push(snippet);
      total += snippet.length;
    }
    if (total >= 3000) break;
  }
  return windows.length ? windows.join("\n---\n") : null;
}

function pickBestBody(layers: EvidenceLayer[], userPasted?: string): string {
  if (userPasted && userPasted.length > 100) return userPasted;
  let best = "";
  let bestPrio = SOURCE_PRIORITY.length;
  for (const layer of layers) {
    if (layer.jd_body.length < 100) continue;
    const prio = SOURCE_PRIORITY.indexOf(layer.source);
    if (
      prio < bestPrio ||
      (prio === bestPrio && layer.jd_body.length > best.length)
    ) {
      best = layer.jd_body;
      bestPrio = prio;
    }
  }
  return best;
}
