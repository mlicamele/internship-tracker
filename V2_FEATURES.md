# V2 Feature Backlog

Features deliberately deferred from the v1 MVP to keep scope realistic for the July 2026 deadline. Each entry includes what it is, why it's deferred, and rough cost when we revisit.

---

## 1. Native iOS/Android share-sheet integration

**What:** When the user taps "Share" in Safari (or Instagram, X, etc.) on their phone, "InternshipTracker" appears alongside Messages, Mail, Notes, etc. Tapping it imports the link directly into the app's Inbox — no copy-paste, no browser navigation.

**Why this matters:** Michael's #1 capture friction is the Instagram → Safari tab pile-up problem. The v1 paste-URL flow solves it functionally, but a native share target is the truly frictionless version. This is the "feels magical" upgrade.

**Why deferred:** Requires native app infrastructure that pure Next.js can't provide.

**Approaches when we revisit:**
- **PWA Share Target API** (cheapest, Android-only): Standard web API, works on Android Chrome when the PWA is installed to home screen. iOS Safari does NOT support this — Apple has never implemented it. Coverage gap makes this a partial solution.
- **Capacitor wrap** (recommended path): Wrap the Next.js web app in a Capacitor shell, ship to iOS App Store. Capacitor gives us access to the iOS Share Extension API. Estimated cost: ~2 weeks build + App Store review (~1 week) + $99/yr Apple Developer account.
- **React Native rewrite** (overkill): More native feel but a full rewrite of the mobile UI. Skip.
- **iOS Shortcuts as v1.5 hack** (cheap intermediate): Build a public iOS Shortcut the user adds manually that takes a URL and POSTs it to a webhook in the app. Not in the system share sheet, but appears in the Shortcuts share-sheet section. ~2 days of work. Could ship as a stopgap before the Capacitor version.

**Best v2 plan:** Ship the iOS Shortcut as v1.5 (fast unlock), then Capacitor wrap as v2.

---

## 2. Resume .tex parsing

**What:** App reads the user's Overleaf .tex source, understands sections/bullets/dates structurally, and can show diffs between resume versions, suggest targeted bullet swaps tied to specific JD keywords.

**Why deferred:** LaTeX templates vary wildly (Jake's Resume, Deedy, custom). Robust parsing across templates is brittle. v1 ships AI bullet-angle suggestions that don't require parsing — much cheaper and probably solves 80% of the value.

**Revisit when:** v1 angle suggestions are clearly insufficient. If Michael finds himself wishing the app could see his resume structure, this is next.

**Cost:** ~1-2 weeks. Probably easier to support one canonical template (e.g., Jake's Resume) than to parse arbitrary LaTeX.

---

## 3. Browser extension

**What:** One-click "save this role" button on LinkedIn / Greenhouse / Lever / Workday job pages.

**Why deferred:** The v1 paste-URL flow does the same job. Extension is nicer UX but not different enough to justify Chrome Web Store deployment cycle.

**Revisit when:** Michael notices himself wishing the paste flow had fewer steps. Easy build after v1 — Manifest V3 extension talking to the v1 scrape API.

**Cost:** ~3-5 days.

---

## 4. Gmail integration (auto-detect application status)

**What:** OAuth into Gmail, scan for "thanks for applying" / "unfortunately" / "would like to schedule" emails, auto-update the application pipeline status.

**Why deferred:** OAuth + Google's verification process + false positives in classification + privacy implications for a shared app. Significant complexity for a "nice-to-have."

**Revisit when:** v1 user testing shows manual status updates are the biggest friction.

**Cost:** ~2 weeks build + Google verification (variable, can take weeks).

---

## 5. Cold-outreach templates + follow-up nudges

**What:** Pre-written outreach templates by role type, follow-up cadence reminders ("you haven't messaged Sarah in 14 days"), alumni search (Penn alumni directory or LinkedIn).

**Why deferred:** Michael has never done cold outreach. Building UI for an untested workflow risks dead code. v1 ships a lightweight contacts table where he can log who he's reached out to manually. We learn what affordances actually help once he has tried it.

**Revisit when:** He has reached out cold to 5+ people and can tell us what was painful. Then build affordances around real behavior.

**Cost:** ~1 week templates + ~1 week alumni integration (LinkedIn ToS issues — probably manual contact import is more realistic).

---

## 6. Interview *prep* tracking

> **Note (updated Phase 2):** Interview *data capture* (logging scheduled interviews with time, meeting link, type, notes, outcome) IS now in v1 — added during Phase 2 because Michael wanted to log meeting links and details inline with applications. The remaining v2 scope is the **prep workflow** below, which is distinct from data capture.

**What:** Log LeetCode problems done with notes, behavioral story bank ("tell me about a time..."), per-company prep notes separate from per-application notes (e.g., "Anthropic's interview style is collaborative coding, not whiteboard"), maybe AI-assisted mock interview question generation given the JD.

**Why deferred:** Separate workflow from application tracking. Worth its own scoping conversation. The v1 interview *data capture* gives the foundation; prep workflow layers on top once Michael has real interviews to prep for.

**Revisit when:** v1 is shipped and Michael starts getting interviews — then we build the prep loop with real interview pressure as the design constraint.

**Cost:** ~1-2 weeks for a basic version.

---

## 7. Google Calendar sync

**What:** Push application deadlines, OA deadlines, interview times to Google Calendar.

**Why deferred:** OAuth complexity. v1 ships an in-app deadline view that's good enough.

**Revisit when:** Michael wants reminders to show up alongside his other life.

**Cost:** ~3-5 days.

---

## 8. Analytics dashboard

**What:** Response rate by resume version, by source, by role type. Funnel conversion. Time-to-response distributions.

**Why deferred:** Needs data to be useful. Premature in v1 (he won't have applied yet).

**Revisit when:** After his fall application wave — when there's actual data to analyze.

**Cost:** ~1 week.

---

## 9. Multi-user UI / sharing

**What:** Account management UI, sharing application lists with friends, public profile pages.

**Why deferred:** v1 data model + Supabase auth already supports multiple users — what's missing is the UI surfaces. Easy add later, premature now.

**Revisit when:** Michael wants to share with Penn friends or use as a portfolio piece.

**Cost:** ~1 week UI work.

---

## 10. Additional scrape sources

**What:** Beyond SimplifyJobs Summer 2027 repo — also scrape Pitt CSC's list, Vansh Bhatia's list, Handshake export, specific company career pages, zero2sudo Instagram posts.

**Why deferred:** SimplifyJobs alone covers ~80% of the early-career CS internship signal. Multiple sources = deduplication problem. Solve dedup once.

**Revisit when:** v1 Inbox feels too sparse (unlikely — SimplifyJobs has hundreds of roles).

**Cost:** ~1 week per source + dedup logic.

---

## v1 features (for contrast — what we ARE shipping)

- User profile (school, class year, location, radius, interest tags, master resume)
- Paste-URL quick-add with metadata scrape (mobile-first capture)
- Inbox sorted by deadline + fit + recency (fit score uses profile)
- Pipeline kanban (Saved → Applied → OA → Interview → Offer/Reject)
- Per-application detail (JD snapshot, notes, contacts, resume version)
- SimplifyJobs Summer 2027 scraper (daily) with LLM class-year classification
- Industry-aware cycle warnings ("quant: most firms closed for SS27, X still open")
- Distance-from-home sort + "local" filter
- Resume PDF upload + version tagging + per-app linking
- AI button: "suggest 2-3 bullet angles for this JD" (no resume parsing)
- Lightweight contacts table linked to applications
- Supabase auth (single-user UI, multi-user data model)
