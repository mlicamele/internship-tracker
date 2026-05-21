import type * as cheerio from "cheerio";
import type { ParserResult } from "../url-types";

/** Lever: jobs.lever.co/{company}/{role-id} */
export function parse($: cheerio.CheerioAPI): ParserResult {
  const title =
    $(".posting-headline h2").first().text().trim() ||
    $("h2").first().text().trim() ||
    null;

  const location =
    $(".sort-by-time .posting-categories .location, .posting-categories .location")
      .first()
      .text()
      .trim() || null;

  const company =
    $(".main-header-text, .posting-page-header-link, .company-name")
      .first()
      .text()
      .trim() ||
    $('meta[property="og:site_name"]').attr("content") ||
    null;

  // Lever body: .content-wrapper > .section
  const blocks: string[] = [];
  $(".content-wrapper .section").each((_, el) => {
    const txt = $(el).text().trim();
    if (txt.length > 20) blocks.push(txt);
  });

  let body = blocks.join("\n\n");
  if (!body) {
    body = $(".content-wrapper").first().text().trim();
  }

  return {
    company,
    title,
    location,
    jd_body: body,
    extras: {},
  };
}
