# Distance-scoring rework: fixed tiers + preset-with-overrides

**Status:** approved, ready to implement.
**Owner:** Michael.
**Related:** `lib/scoring/fit.ts`, `lib/db/types.ts` (`Profile`), `lib/db/migrations/`, `app/(app)/settings/_components/fit-weights.tsx`.

## Problem

Current distance component in `computeFitScore` uses linear decay: `Math.max(0, 1 - d / (k * radius))`, with `k` derived from `relocation_tolerance` (`nope`=2 / `regional`=6 / `anywhere`=20). Two failure modes:

1. **Continuous — mismatch with user mental model.** Michael thinks about distance in tiers ("commutable" / "regional" / "far but ok" / "distant"), not a smooth function. The linear curve makes 10 mi vs 25 mi feel similar-scored (0.90 vs 0.75) even though there's a real quality-of-life step; likewise 149 mi vs 151 mi feel identical (0.01 vs 0.00) even though they cross no meaningful threshold.
2. **Harsh cliff at `(k × radius)` mi.** Roles beyond the decay boundary score 0. Even the `anywhere` preset zeros out at 500 mi with the default 25-mi radius. A role in San Francisco or Tokyo becomes a genuine disqualifier on the distance axis alone, when Michael's actual preference is "prefer close, but don't kill far things."

## Design

### Tier structure (fixed thresholds)

Four tiers, matched by the closest of the role's geocoded locations (already routed through `weightedNearestDistance`):

| Tier | Range | Meaning |
|---|---|---|
| Commutable | 0–30 mi | Daily commute realistic |
| Regional | 30–150 mi | Day-trip / weekend commute |
| Domestic | 150–1000 mi | Flight required, still domestic |
| Distant | 1000+ mi | International or coast-to-coast |

Thresholds are fixed (not user-configurable). Simpler UI, and the tiers correspond to widely-shared intuitions about US travel that don't need tuning per user.

### Presets — reuse `relocation_tolerance` field

Existing `relocation_tolerance` enum stays (`nope` / `regional` / `anywhere`), but each value now selects a full tier-score profile instead of an integer decay multiplier:

| Preset | Commutable | Regional | Domestic | Distant |
|---|---|---|---|---|
| `nope` (strict) | 1.00 | 0.55 | 0.30 | 0.20 |
| `regional` (default) | 1.00 | 0.85 | 0.65 | 0.50 |
| `anywhere` (open) | 1.00 | 0.95 | 0.90 | 0.85 |

**Floor property:** even the strictest preset floors at 0.20 — distance is a soft signal, not a disqualifier. `local_radius_miles` (existing profile column) becomes unused by the distance component but stays in the schema (referenced elsewhere / kept for historical rows).

### Per-tier overrides — advanced

Four new nullable numeric columns on `profiles`:

```
fit_dist_tier_score_commutable  numeric(3,2) NULL
fit_dist_tier_score_regional    numeric(3,2) NULL
fit_dist_tier_score_domestic    numeric(3,2) NULL
fit_dist_tier_score_distant     numeric(3,2) NULL
```

When null, the preset value applies. When set, that per-tier override wins for that user. Matches the existing `fit_weight_*` pattern (separate columns rather than JSONB — keeps queries straightforward and column types explicit).

Settings UI: existing `fit-weights.tsx` gets a collapsed "Advanced distance overrides" section revealing four 0–100 sliders labeled by tier. Each pre-filled from the preset's value; changing a slider sets the override; a per-slider "reset" resets that override to null.

### Work-model interaction

- **Remote role (`work_model === "remote"`)** — distance score = 1.0 regardless of geocode. Rationale: remote roles have zero commute, so proximity is meaningless; giving them the "Commutable" tier reflects that.
- **Hybrid role** — treated as onsite for distance purposes (uses tier-based score from geocoded distance). Hybrid still requires occasional commute, so distance matters.
- **Onsite role** — tier-based score from geocoded distance.

### Ungeocoded fallback

- **Remote (any geocode state)** — score 1.0 (see above).
- **Hybrid or Onsite, no geocoded location** — score 0.5 (NEUTRAL). Was 0.4 for "unknown"; the 0.4 was arbitrary. Neutral means "we don't know, don't push either way," consistent with how missing signals are handled elsewhere (`scoreClassYear` returns 0.5 on null `grad_year`).

### No home coordinates

Unchanged: if `profile.home_lat`/`lng` are null, score = 0.5 (NEUTRAL). No point computing tiers without a home reference.

## Data flow

1. `computeFitScore(role, profile)` calls new internal `scoreDistance(role, profile)`.
2. `scoreDistance` short-circuits on: no home coords (→ 0.5), remote work model (→ 1.0), ungeocoded non-remote (→ 0.5).
3. Otherwise, calls `weightedNearestDistance(role.locations, [home])` → miles.
4. Miles → tier (fixed threshold lookup).
5. Tier → score: prefer per-tier override on profile if set; else preset default from `relocation_tolerance`.
6. Returns `{ distance: score, distanceMiles: d }`.

## Migration

`lib/db/migrations/0019_distance_tier_overrides.sql`:

```sql
ALTER TABLE profiles
  ADD COLUMN fit_dist_tier_score_commutable numeric(3,2),
  ADD COLUMN fit_dist_tier_score_regional   numeric(3,2),
  ADD COLUMN fit_dist_tier_score_domestic   numeric(3,2),
  ADD COLUMN fit_dist_tier_score_distant    numeric(3,2);
```

All four nullable, no default — null = "use preset." Existing rows unaffected.

## Testing

`lib/scoring/fit.test.ts` gains coverage for:

- Each preset produces the expected per-tier scores for a representative distance in each tier.
- Per-tier override on profile beats preset default.
- Remote role scores 1.0 regardless of geocode.
- Hybrid role with no geocode → 0.5.
- Onsite ungeocoded → 0.5.
- No home coords → 0.5.
- Boundary: exactly 30 mi = Commutable; 30.01 mi = Regional; 150 mi = Regional; 150.01 mi = Domestic; 1000 mi = Domestic; 1000.01 mi = Distant. (Boundaries inclusive on the lower tier.)

## Deliberately deferred

- **Threshold configurability** — YAGNI. Users almost never rework the boundaries of "commutable" vs "regional." If they do, they can tune per-tier scores instead.
- **Distance-tier IDs surfaced in UI** — the popover already shows "distance × weight = contribution"; adding "in Regional tier" is nice-to-have, not blocking.
- **Migration to remove `local_radius_miles`** — leaving it since other code may still reference it; a follow-up cleanup migration can drop after code audit.
