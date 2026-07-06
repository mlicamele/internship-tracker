// Resolve a capture payload (raw URL + optional text from a Shortcut / share
// sheet) into { targetUrl, extraContext } that can be fed to scrapeUrl().
//
// Strategy:
//   1. Gather every URL candidate from url + text.
//   2. If any candidate is a known job board (Greenhouse/Lever/Ashby/Workday) →
//      use it directly. Job-board APIs are the gold path.
//   3. Otherwise, hand the first candidate to Jina Reader (headless render),
//      scan the returned body for embedded job-board URLs, prefer those.
//   4. Nothing worked but we got Jina body → pass URL + body as extraContext so
//      the LLM can at least try to extract company/title from a caption.
//   5. No URL at all → return text as extraContext; the LLM will do its best.

import { identifyBoard } from "@/lib/scrape/identify";
import { fetchViaJinaReader } from "@/lib/scrape/reader";

export interface ResolveInput {
  url: string | null;
  text: string | null;
}

export interface ResolveResult {
  targetUrl: string | null;
  extraContext: string | null;
  note: string;
}

const URL_RE = /https?:\/\/[^\s<>"')]+/g;
const TRAILING_PUNCT_RE = /[.,;:!?)\]]+$/;

function cleanUrl(raw: string): string {
  return raw.replace(TRAILING_PUNCT_RE, "");
}

function extractUrls(text: string | null | undefined): string[] {
  if (!text) return [];
  const matches = Array.from(text.matchAll(URL_RE), (m) => cleanUrl(m[0]));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of matches) {
    if (!seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}

function isJobBoard(url: string): boolean {
  const kind = identifyBoard(url).kind;
  return (
    kind === "greenhouse" ||
    kind === "lever" ||
    kind === "ashby" ||
    kind === "workday"
  );
}

function isValidUrl(raw: string): boolean {
  try {
    new URL(raw);
    return true;
  } catch {
    return false;
  }
}

export async function resolveCapture(
  input: ResolveInput
): Promise<ResolveResult> {
  const candidates: string[] = [];
  if (input.url && isValidUrl(input.url)) candidates.push(cleanUrl(input.url));
  candidates.push(...extractUrls(input.text));

  const jobBoard = candidates.find(isJobBoard);
  if (jobBoard) {
    return {
      targetUrl: jobBoard,
      extraContext: input.text ?? null,
      note: `job-board URL detected (${identifyBoard(jobBoard).kind})`,
    };
  }

  const social = candidates[0];
  if (social) {
    const reader = await fetchViaJinaReader(social);
    if (reader && reader.jd_body) {
      const embedded = extractUrls(reader.jd_body);
      const embeddedJobBoard = embedded.find(isJobBoard);
      if (embeddedJobBoard) {
        return {
          targetUrl: embeddedJobBoard,
          extraContext: reader.jd_body,
          note: `job URL extracted from ${social} via Jina`,
        };
      }
      return {
        targetUrl: social,
        extraContext: reader.jd_body,
        note: `no job-board URL found; captured page body as context`,
      };
    }
    return {
      targetUrl: social,
      extraContext: input.text ?? null,
      note: `Jina fetch failed; forwarding original URL`,
    };
  }

  return {
    targetUrl: null,
    extraContext: input.text ?? null,
    note: input.text ? "text-only capture; no URL detected" : "empty capture",
  };
}
