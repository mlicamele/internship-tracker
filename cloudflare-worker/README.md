# Cloudflare Browser Rendering Worker

A small Cloudflare Worker that exposes a headless browser rendering endpoint. The main InternshipTracker app calls it as a 4th-layer fallback when cheaper scrape paths fail.

**Why**: Cloudflare's Browser Rendering API is free at 10K requests/day on the Workers Free plan — enough for personal-use scraping, with no cold-start sleep and no monthly fees.

## One-time setup (~15 min)

1. **Cloudflare account**: sign up at https://dash.cloudflare.com if you don't have one.
2. **Enable Browser Rendering**: dashboard → Workers & Pages → Browser Rendering → enable.
3. **Install wrangler globally** (one-time):
   ```bash
   npm install -g wrangler
   ```
4. **Authenticate**:
   ```bash
   wrangler login
   ```
5. **Deploy the Worker**:
   ```bash
   cd cloudflare-worker
   npm install
   wrangler deploy
   ```
   `npm install` uses this directory's local `package.json` (not the root Next.js one — puppeteer is a Worker-only dep and doesn't belong in the app bundle). Note the Worker URL printed (e.g. `https://internship-render.YOURNAME.workers.dev`).

6. **Generate a shared secret** — any random string ~32 characters. On macOS:
   ```bash
   openssl rand -hex 32
   ```
   Then set it as a Worker secret:
   ```bash
   wrangler secret put SHARED_TOKEN
   ```
   Paste the token when prompted.

7. **Add to the main app env** — both `.env.local` AND Vercel project settings:
   ```
   CF_BROWSER_RENDER_URL=https://internship-render.YOURNAME.workers.dev/render
   CF_BROWSER_RENDER_TOKEN=<the same token>
   ```

8. **Verify**:
   ```bash
   curl https://internship-render.YOURNAME.workers.dev/health
   # → ok
   ```

   And a real render:
   ```bash
   curl -X POST https://internship-render.YOURNAME.workers.dev/render \
     -H "Authorization: Bearer <YOUR_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"url": "https://example.com"}'
   # → { "title": "Example Domain", "text": "...", ... }
   ```

## How it's used

The Worker is called automatically by `lib/scrape/cf-browser.ts` when:
- A URL's other extraction layers (Greenhouse/Lever/Ashby APIs, JSON-LD, r.jina.ai) all returned thin bodies
- Both `CF_BROWSER_RENDER_URL` and `CF_BROWSER_RENDER_TOKEN` env vars are set

If the env vars aren't set, the app skips this layer silently.

## Costs

- Workers Free plan: 100K requests/day for Worker invocations
- Browser Rendering Free: 10K requests/day, 10 concurrent browsers
- Plenty for personal use (Michael's expected 100 roles/month = ~3/day)

## Updating

```bash
cd cloudflare-worker
wrangler deploy
```

That's it. No app redeploy needed; the main app calls the Worker URL.
