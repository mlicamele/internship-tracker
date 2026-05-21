// Cloudflare Workers Browser Rendering caller. Calls a deployed Worker that
// renders a URL with headless Chromium and returns the rendered HTML/text.
//
// Setup: deploy cloudflare-worker/render-worker.ts to your Cloudflare account
// (see cloudflare-worker/README.md). Then add to .env.local + Vercel:
//   CF_BROWSER_RENDER_URL=https://<your-worker>.workers.dev/render
//   CF_BROWSER_RENDER_TOKEN=<shared secret you chose>
//
// Falls back gracefully (returns null) if env vars aren't set.

import type { EvidenceLayer } from "./types";

export async function fetchViaCloudflareBrowser(
  url: string
): Promise<EvidenceLayer | null> {
  const workerUrl = process.env.CF_BROWSER_RENDER_URL;
  const token = process.env.CF_BROWSER_RENDER_TOKEN;
  if (!workerUrl) return null;

  try {
    const res = await fetch(workerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      title?: string;
      text?: string;
      html?: string;
      url?: string;
    };
    const body = (data.text ?? "").trim();
    if (!body || body.length < 100) return null;
    return {
      source: "cf_browser",
      company: null,
      title: data.title ?? null,
      location_texts: [],
      jd_body: body,
      jd_url: data.url ?? null,
      raw: { html_chars: data.html?.length ?? 0 },
    };
  } catch {
    return null;
  }
}
