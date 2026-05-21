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
  flattenLocation,
  organizationName,
  stripHtml,
} from "./jsonld";
import { identifyBoard } from "./identify";
import { fetchGreenhouseJob } from "./boards/greenhouse-api";
import { fetchLeverPosting } from "./boards/lever-api";
import { fetchAshbyJob } from "./boards/ashby-api";
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
        location_text: flattenLocation(jsonLd.jobLocation),
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
      location_text: null,
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

  const extracted = await extractJobFromEvidence({
    url,
    htmlExcerpt: mergedHints.htmlExcerpt,
    jsonLd: mergedHints.jsonLd,
    perBoardHints: {
      company: mergedHints.company,
      title: mergedHints.title,
      location: mergedHints.location_text,
      jd_body: bestBody,
    },
    userPastedJdBody: userPastedJd,
  });

  // Fallback fill: when LLM left a field blank but evidence had it
  const filled: ExtractedJob = {
    ...extracted,
    company: extracted.company ?? mergedHints.company ?? null,
    title: extracted.title ?? mergedHints.title ?? null,
    location_text: extracted.location_text ?? mergedHints.location_text ?? null,
    jd_body: extracted.jd_body || bestBody,
    jd_url: extracted.jd_url ?? mergedHints.jd_url ?? url,
    posted_at: extracted.posted_at ?? mergedHints.posted_at ?? null,
    deadline_at: extracted.deadline_at ?? mergedHints.deadline_at ?? null,
    work_model:
      extracted.work_model === "unspecified" && mergedHints.work_model
        ? mergedHints.work_model
        : extracted.work_model,
    compensation_text:
      extracted.compensation_text ?? mergedHints.compensation_text ?? null,
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
  location_text: string | null;
  jd_url: string | null;
  posted_at: string | null;
  deadline_at: string | null;
  work_model: EvidenceLayer["work_model"];
  compensation_text: string | null;
  jsonLd: unknown;
  htmlExcerpt: string | undefined;
}

const SOURCE_PRIORITY: EvidenceLayer["source"][] = [
  "greenhouse_api",
  "lever_api",
  "ashby_api",
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
    location_text: null,
    jd_url: null,
    posted_at: null,
    deadline_at: null,
    work_model: undefined,
    compensation_text: null,
    jsonLd: undefined,
    htmlExcerpt: undefined,
  };
  for (const layer of sorted) {
    merged.company ??= layer.company;
    merged.title ??= layer.title;
    merged.location_text ??= layer.location_text;
    merged.jd_url ??= layer.jd_url;
    merged.posted_at ??= layer.posted_at ?? null;
    merged.deadline_at ??= layer.deadline_at ?? null;
    if (
      !merged.work_model &&
      layer.work_model &&
      layer.work_model !== "unspecified"
    ) {
      merged.work_model = layer.work_model;
    }
    merged.compensation_text ??= layer.compensation_text ?? null;
    if (!merged.jsonLd && layer.source === "jsonld" && layer.raw) {
      merged.jsonLd = layer.raw;
    }
    if (!merged.htmlExcerpt && layer.source === "direct_fetch") {
      merged.htmlExcerpt = layer.jd_body.slice(0, 12000);
    }
  }
  return merged;
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
