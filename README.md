# InternshipTracker

Mobile-first internship triage queue for tech-focused students. Paste a URL on your phone, the app stores the role and queues it in a profile-aware Inbox sorted by deadline + fit + recency. Triage into a kanban pipeline on laptop and do the real application work.

See `PROJECT.md` for the full overview and `V2_FEATURES.md` for the deferred backlog.

## Quickstart

```bash
# 1. Install dependencies
npm install

# 2. Copy env template and fill in your keys
cp .env.example .env.local

# 3. Run the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Required services

- **Supabase**: auth + Postgres + storage. Project URL + publishable (anon) key + service role key.
- **Anthropic API**: Haiku 4.5 for classification, Sonnet 4.6 for bullet-angle suggestions. Set a monthly spending limit.
- **Nominatim** (OpenStreetMap): geocoding. No key, but requires a real User-Agent in env per ToS.
- **Vercel**: deploy. Connect the GitHub repo, paste env vars in project settings.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 · shadcn/ui · Supabase (`@supabase/ssr`) · Anthropic SDK.
