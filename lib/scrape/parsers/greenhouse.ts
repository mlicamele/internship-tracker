import type * as cheerio from "cheerio";
import type { ParserResult } from "../url";

/**
 * Greenhouse: job-boards.greenhouse.io/foo/jobs/123 OR boards.greenhouse.io/foo/jobs/123
 *
 * Modern Greenhouse pages SSR a fair bit, but the full JD body sometimes needs
 * the client render. Try our luck with the common selectors.
 */
export function parse($: cheerio.CheerioAPI): ParserResult {
  const title =
    $("h1.app-title, h1.posting-headline, h1").first().text().trim() ||
    $('meta[property="og:title"]').attr("content") ||
    null;

  const location =
    $(".location, .job-location").first().text().trim() ||
    $('meta[property="job:location"]').attr("content") ||
    null;

  const company =
    $('meta[property="og:site_name"]').attr("content") ||
    $(".company-name, .app-title-company").first().text().trim() ||
    null;

  // Greenhouse body is usually in #content or .content
  const bodyEl = $("#content, .content, .opening, [data-job-content]").first();
  let body = bodyEl.text().trim();

  // Fallback: take all <p>+<li> in the article-like container
  if (!body || body.length < 200) {
    const blocks: string[] = [];
    $("article p, article li, main p, main li").each((_, el) => {
      const t = $(el).text().trim();
      if (t.length > 15) blocks.push(t);
    });
    body = blocks.join("\n\n");
  }

  return {
    company,
    title,
    location,
    jd_body: body,
    extras: {},
  };
}
