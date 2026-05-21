// r.jina.ai reader-mode fallback. Free, no auth needed for personal-use volume.
// Returns markdown of the rendered page (Jina runs a headless browser internally).
//
// Docs: https://jina.ai/reader/

import type { EvidenceLayer } from "./types";

const JINA_READER_BASE = "https://r.jina.ai/";

export async function fetchViaJinaReader(
  url: string
): Promise<EvidenceLayer | null> {
  const target = `${JINA_READER_BASE}${url}`;
  try {
    const res = await fetch(target, {
      headers: {
        Accept: "text/plain",
        // Optional auth — bumps rate limits if set
        ...(process.env.JINA_API_KEY
          ? { Authorization: `Bearer ${process.env.JINA_API_KEY}` }
          : {}),
        "X-Return-Format": "markdown",
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const markdown = await res.text();
    if (!markdown || markdown.length < 100) return null;

    // Jina prefixes a "Title:" and "URL Source:" header. Parse it if present.
    let title: string | null = null;
    let jdUrl: string | null = null;
    let body = markdown;
    const titleMatch = body.match(/^Title:\s*(.+?)\n/);
    if (titleMatch) {
      title = titleMatch[1].trim();
      body = body.replace(/^Title:\s*.+?\n/, "");
    }
    const urlMatch = body.match(/^URL Source:\s*(.+?)\n/);
    if (urlMatch) {
      jdUrl = urlMatch[1].trim();
      body = body.replace(/^URL Source:\s*.+?\n/, "");
    }
    // Markdown content header
    body = body.replace(/^Markdown Content:\s*\n+/, "").trim();

    return {
      source: "jina_reader",
      company: null,
      title,
      location_texts: [],
      jd_body: body,
      jd_url: jdUrl,
      raw: { markdown_chars: markdown.length },
    };
  } catch {
    return null;
  }
}
