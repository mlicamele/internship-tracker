# InternshipTracker — Project Overview

*Internal planning doc. Living spec. Not a README — that comes later if/when the app gets shared.*

---

## TL;DR

A mobile-first triage queue + laptop workspace that helps tech-focused students manage high-volume internship search without losing signal. Paste a link on your phone, the app fetches the role's details and queues it in a profile-aware Inbox sorted by deadline + fit + recency. On laptop, triage that Inbox into a kanban pipeline and do the real application work (resume linking, notes, contacts). The differentiator vs. existing tools (Simplify, Huntr, spreadsheets) is the **mobile capture loop** + **profile-driven fit scoring** for class-year and geography.

Built for Michael (Penn CS, rising sophomore, home in Potomac MD, doing HCI research at CMU summer 2026) initially, but with a generalized profile model so it can be shared with Penn CS friends in a later version.

---

## The problem

High-volume CS internship search has chronic pain points that existing tools don't address well:

1. **Inbox piles up.** Tap a link in zero2sudo's Instagram, it opens in Safari, you mean to come back, you don't. The role rots. You forget it existed by the time you have time to apply.
2. **Mass-apply with low signal.** Last year Michael applied to ~80 places. Low response rate. Spreadsheets/Simplify track what he applied to but don't help him decide *which* roles to spend time on.
3. **Class-year invisibility.** Most CS internships implicitly want juniors. Lists rarely tag eligibility explicitly. Sophomores waste effort on roles that won't take them.
4. **Geographic chaos.** Sorting "internships near Potomac MD" across LinkedIn, Handshake, GitHub lists is manual and tedious.
5. **Resume version sprawl.** Multiple resumes for different role types (AI/ML, SWE, HCI) authored in Overleaf. Which version went to which application? Currently: no system.
6. **Cycle timing blindness.** Quant offers were already out for SS27 before Michael started looking. Knowing which industries' cycles have closed (and which haven't) saves wasted effort.

---

## The solution shape

**Mobile (phone): capture + triage.**
- Paste a URL → app scrapes role metadata → enters Inbox.
- Inbox sorted by deadline (closing soonest) → fit (profile match) → recency (newest first).
- Swipe to triage: *Apply* (move to laptop work later) / *Maybe* (snooze) / *Skip* (archive).

**Laptop: workspace.**
- Kanban pipeline (Saved → Applied → OA → Interview → Offer/Reject).
- Per-application detail: JD snapshot, notes, linked resume version, linked contacts, status timeline.
- AI helper button: "suggest 2–3 bullet angles for this JD" — outputs angles to take back to Overleaf.
- Filters and sorts driven by user profile (class year, location, interests).

**Auto-discovery (background): SimplifyJobs Summer 2027 scraper.**
- Runs daily, fetches new postings, LLM-classifies class-year eligibility, drops into Inbox.

**Profile (first-class).**
- School, graduation year, home location (geocoded), local radius, relocation tolerance, interest tags, master resume.
- Powers the fit score. Makes the app generalizable across students.

---

## V1 scope (target: usable by July 2026)

| Area | Feature | Notes |
|---|---|---|
| Profile | Onboarding wizard | School, grad year, location (geocoded), local radius, relocation rule, interest tags (multi-select from tech taxonomy), master resume upload |
| Capture | Paste-URL quick-add (mobile) | Server-side scrape extracts title, company, location, JD body, deadline if present |
| Inbox | Smart sort | `score = w1·deadline_urgency + w2·fit_score + w3·recency`. Fit = class-year × location × interest overlap |
| Inbox | Swipe triage | Apply / Maybe / Skip |
| Pipeline | Spreadsheet (TanStack Table) | Sortable columns, per-column filters, toggleable column visibility, sticky header. Status as a column (with filter chips), not kanban swimlanes — Michael preferred power-user spreadsheet UX over Trello-style |
| Pipeline | Status timeline | Per-app: when each status was reached, via `status_events` table |
| Role fields | Target term | `target_year INT` + `target_season ENUM` — distinguishes Summer 2027 vs Summer 2028 cohort |
| Role fields | Work model | `work_model ENUM('remote','hybrid','onsite','unspecified')` — pairs with distance for meaningful geography filtering |
| Role fields | Compensation | `compensation_text` (display) + `compensation_hourly_cents` (sortable) |
| Role fields | Class year eligibility | `class_year_tag ENUM('freshman_ok','sophomore_ok','junior_plus','unspecified')` — manual entry in v1; LLM-auto-tagged in Phase 5 |
| App detail | JD snapshot + notes | JD body cached at scrape time so it doesn't rot if the posting closes |
| App detail | Linked resume version | Single FK to resume_versions (one per app); upload UI lands in Phase 6 |
| App detail | Linked contacts (M:N) | Lightweight: name, role, company, last contact date |
| App detail | Interview data capture | Per-application `interviews` rows: scheduled_at, type, meeting_url, location, interviewer_names, notes, outcome. Just data capture — prep tracking (LeetCode log, behavioral story bank) stays in v2 |
| App detail | Company notes (per-user) | `company_notes` table keyed (user_id, company_id) — survives across multiple applications to the same company |
| Discovery | SimplifyJobs scraper | Daily cron pulling from `vanshb03/Summer2027-Internships` (or successor) |
| Discovery | LLM class-year tag | Haiku classifies JD body → freshman-OK / sophomore-OK / junior+ / unspecified. Confidence score stored |
| Discovery | Industry cycle warning | Tag companies by industry; flag roles whose typical cycle has closed |
| Filters | Class year, location, work model, target term | Default-on filters from profile; per-session overrideable |
| Pipeline column | Distance from home | Computed at query time via `haversineMiles(role.lat/lng, profile.home_lat/lng)`. Sortable. Null when either side lacks coordinates |
| AI | "Suggest bullet angles" button | Input: JD body + user profile + selected resume version (PDF text-extracted via pdf-parse). Output: 2–3 bullet angle suggestions for the user to write in Overleaf |
| Theme | Dark mode default | shadcn dark tokens activated globally; no theme toggle in v1 |
| Auth | Supabase | Single-user UI, but multi-user data model |

**What's NOT in v1:** see `V2_FEATURES.md`. Top deferrals: native iOS share-sheet, .tex parsing, browser extension, Gmail integration, cold-outreach automation, interview *prep* tracker (data capture IS in v1), calendar sync, analytics, multi-user UI, additional scrape sources.

---

## Full eventual scope

Everything in v1, plus the v2 backlog tracked in `V2_FEATURES.md`. Roughly:

- **Capture upgrades**: iOS Shortcuts hack (v1.5) → Capacitor-wrapped native share-sheet (v2).
- **Resume intelligence**: .tex parsing for structural understanding + diff between versions + targeted bullet swaps.
- **Browser extension**: One-click import from LinkedIn / Greenhouse / Lever / Workday.
- **Email integration**: Gmail OAuth to auto-detect application status changes.
- **Outreach**: Cold-email templates, follow-up cadence reminders, Penn alumni search, contact graph.
- **Interview prep**: LeetCode log, behavioral story bank, per-company prep notes.
- **Calendar sync**: Google Calendar push for deadlines and interviews.
- **Analytics**: Response rate by resume version, by source, by role type. Funnel conversion.
- **Sharing / multi-user**: UI surfaces to invite friends, view shared lists, public profiles.
- **More sources**: Pitt CSC list, Vansh Bhatia's list, Handshake export, zero2sudo Instagram, company career pages.

The end state is a tech-focused student career command center — discovery, application tracking, resume intelligence, outreach, interview prep, all profile-aware and shareable. v1 is the foundation; everything else layers on once the core triage loop is real.

---

## Tech stack

- **Frontend**: Next.js 16 (App Router, server actions, `proxy.ts` not `middleware.ts`), TypeScript, Tailwind v4, shadcn/ui (base-ui flavor)
- **Backend**: Next.js server actions + route handlers; Postgres via Supabase
- **Auth + storage**: Supabase (magic-link auth, Postgres, S3-compatible file storage for resume PDFs); session cookies preserved across middleware redirects to avoid reload-loop
- **AI**: Anthropic API — Haiku 4.5 (`claude-haiku-4-5-20251001`) for cheap class-year classification, Sonnet 4.6 (`claude-sonnet-4-6`) for bullet-angle suggestions
- **Tables**: `@tanstack/react-table` v8 — headless primitive powering the spreadsheet Pipeline view
- **Scraping**: GitHub Actions cron POSTing to a Vercel route handler (avoids Vercel Cron free-tier limits)
- **Geocoding**: Nominatim (free, requires User-Agent), throttled to 1.5s. Mapbox dev tier as upgrade path
- **Deploy**: Vercel (note: April 2026 breach — only NEXT_PUBLIC_* keys on Vercel in early phases; service-role key added in Phase 5 with Sensitive flag)
- **Cost target**: <$10/mo (all on free tiers + Anthropic API credit usage)

---

## Success criteria for v1

1. **Used for real.** Michael actually uses the app for fall 2026 applications. If he reverts to a spreadsheet by September, v1 failed.
2. **Triage is fast.** Picking up a phone, pasting a URL, and getting it into the right bucket takes less time than the old "Safari tab and hope" flow.
3. **Better-fit application mix at the same (or higher) volume.** He still applies to ~80+ roles, but the mix shifts toward roles where his profile actually fits (correct class year, geography, interests). Response rate should improve as a downstream effect.
4. **Show-a-friend ready.** Polished enough that a Penn CS friend would react with "wait, this is real, can I use it?" Not toy-level. Not portfolio-distinctive either — clean shadcn-default polish is enough.

---

## Key decisions and the reasoning

- **Mobile triage queue is the centerpiece, not the kanban.** Nothing on the market solves the Instagram-tabs problem. Kanban tracking is commodity (Simplify, Huntr, Notion all do it). The capture loop is the differentiator.
- **Profile is first-class in v1.** Without it, "fit" is hardcoded to Michael's situation and the share-later goal dies. Adding it costs ~1 day; not adding it costs the whole audience expansion path.
- **One scraper, not five.** SimplifyJobs alone is ~80% of the early-career CS signal. Multiple sources require dedup logic — solve dedup once, when there's value to justify it.
- **Class-year LLM classification, not regex.** JDs say "rising junior" in 50 different ways. Cheap to call Haiku per JD (~$0.001), high accuracy. Confidence scoring so we know what to trust.
- **AI suggests, user writes.** Cover letter / resume AI = bullet *angles*, never prose. Matches Michael's authenticity preference + avoids AI-detection issues + keeps him learning.
- **.tex parsing pushed to v2.** Hard across LaTeX templates, resumes are not the top pain. Ship angle suggestions first; revisit if they're insufficient.
- **Cold outreach UI pushed to v2.** Michael has never done outreach. Building affordances for an untested workflow risks dead code. Track contacts manually first; learn what actually helps; then build.
- **Supabase auth from day one.** Even though v1 is single-user, having proper auth means the share-later path doesn't require a re-architecture.
- **Don't reduce volume.** Michael's intent is to apply to MORE roles next cycle, not fewer. The app helps him handle volume gracefully, not avoid it.

---

## What this doc isn't

- Not a tech spec — DB schema, API surface, component tree get their own docs when we start building.
- Not a setup guide — install instructions go in README when v1 ships.
- Not a feature roadmap with dates — `V2_FEATURES.md` has the deferred list with rough costs; sequencing happens after v1 ships.
- Not a marketing pitch — this is internal planning, written for Michael (and future-Michael coming back to it months later).
