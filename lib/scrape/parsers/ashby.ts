import type * as cheerio from "cheerio";
import type { ParserResult } from "../url-types";

/**
 * Ashby: jobs.ashbyhq.com/{company}/{role-id}
 *
 * Ashby uses CSS modules so class names look like "_descriptionText_a1b2c".
 * We match prefixes via attribute-contains selectors.
 *
 * Ashby pages are heavily client-rendered — expect frequent thin results.
 */
export function parse($: cheerio.CheerioAPI): ParserResult {
  const title =
    $('[class*="_jobPostingHeader"] h1, [class*="_jobPostingHeader"] h2')
      .first()
      .text()
      .trim() ||
    $("h1, h2").first().text().trim() ||
    null;

  const company =
    $('meta[property="og:site_name"]').attr("content") || null;

  const location =
    $('[class*="_location"]').first().text().trim() || null;

  const bodyEl = $('[class*="_descriptionText"]').first();
  let body = bodyEl.text().trim();

  if (!body) {
    body = $('[class*="_jobPosting"]').first().text().trim();
  }

  return {
    company,
    title,
    location,
    jd_body: body,
    extras: {},
  };
}
