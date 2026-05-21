// Cloudflare Worker — Browser Rendering API
//
// Deploy this Worker to your Cloudflare account to get free headless Chrome
// rendering (10K requests/day on the free tier).
//
// Setup (one-time, ~15 min):
//   1. Install wrangler globally:   npm install -g wrangler
//   2. Authenticate:                 wrangler login
//   3. Pick a Worker name (e.g. internship-render). Edit wrangler.toml.
//   4. Deploy:                       wrangler deploy
//   5. Note your Worker URL (e.g. https://internship-render.YOURNAME.workers.dev)
//   6. Generate a random shared secret token (any string ~32 chars).
//      Set it as a Worker secret:   wrangler secret put SHARED_TOKEN
//      Paste the token when prompted.
//   7. Add to Vercel + .env.local:
//        CF_BROWSER_RENDER_URL=https://internship-render.YOURNAME.workers.dev/render
//        CF_BROWSER_RENDER_TOKEN=<the same token>
//
// The main app calls this Worker as a 4th-layer fallback when the cheaper
// scrape paths (board APIs, JSON-LD, jina reader) all return thin results.
//
// Endpoints:
//   POST /render  { url: string }  → { title, text, html, url }
//   GET  /health                   → "ok"

interface Env {
  BROWSER: Fetcher; // bound via wrangler.toml: [browser]
  SHARED_TOKEN?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    if (url.pathname !== "/render") {
      return new Response("not found", { status: 404 });
    }

    if (request.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }

    // Auth via shared token
    if (env.SHARED_TOKEN) {
      const auth = request.headers.get("Authorization");
      if (!auth || auth !== `Bearer ${env.SHARED_TOKEN}`) {
        return new Response("unauthorized", { status: 401 });
      }
    }

    let body: { url?: string };
    try {
      body = await request.json();
    } catch {
      return new Response("invalid json", { status: 400 });
    }

    if (!body.url || typeof body.url !== "string") {
      return new Response("missing url", { status: 400 });
    }

    try {
      // Import puppeteer dynamically (only available with Browser binding)
      const puppeteer = await import("@cloudflare/puppeteer");
      const browser = await puppeteer.launch(env.BROWSER);
      const page = await browser.newPage();

      // Set realistic UA + headers
      await page.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
      );

      await page.goto(body.url, {
        waitUntil: "networkidle0",
        timeout: 25000,
      });

      // Wait a beat for any client-side JS to finish
      await new Promise((r) => setTimeout(r, 1500));

      const title = await page.title();
      const html = await page.content();
      // Extract clean text by stripping chrome
      const text = await page.evaluate(() => {
        const trash = document.querySelectorAll("script, style, nav, header, footer, svg, noscript");
        trash.forEach((el) => el.remove());
        return document.body.innerText;
      });
      const finalUrl = page.url();

      await browser.close();

      return new Response(
        JSON.stringify({
          title,
          text: text?.slice(0, 50000) ?? "",
          html: html?.slice(0, 200000) ?? "",
          url: finalUrl,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: err instanceof Error ? err.message : "render failed",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
  },
};
