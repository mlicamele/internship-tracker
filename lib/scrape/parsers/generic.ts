import type * as cheerio from "cheerio";
import type { ParserResult } from "../url-types";

/**
 * Generic fallback parser: og:* tags + largest text block.
 * Used when no per-board parser matches the hostname.
 */
export function parse($: cheerio.CheerioAPI): ParserResult {
  const ogSiteName = $('meta[property="og:site_name"]').attr("content") || null;
  const ogTitle = $('meta[property="og:title"]').attr("content") || null;
  const ogDescription =
    $('meta[property="og:description"]').attr("content") || null;
  const docTitle = $("title").first().text().trim() || null;

  // For body: collect all <p> and <li> text into a single blob
  const blocks: string[] = [];
  $("p, li").each((_, el) => {
    const txt = $(el).text().trim();
    if (txt.length > 20) blocks.push(txt);
  });

  // Fallback to a single largest text block (e.g., <main>, <article>)
  if (blocks.length === 0) {
    const candidates = [
      $("article").text(),
      $("main").text(),
      $("body").text(),
    ];
    for (const c of candidates) {
      const cleaned = c.replace(/\s+/g, " ").trim();
      if (cleaned.length > 500) {
        blocks.push(cleaned);
        break;
      }
    }
  }

  const body = blocks.join("\n\n");

  return {
    company: ogSiteName,
    title: ogTitle ?? docTitle,
    location: null,
    jd_body: body,
    extras: {
      og_description: ogDescription,
    },
  };
}
