/**
 * One-off backfill: compute + persist `applications.fit_score` for every
 * scored triage state. Idempotent — safe to re-run.
 *
 * Zero Groq calls (unlike the tag backfill); only DB reads/writes. Fast.
 *
 * Prerequisite: migration 0013 already applied (roles.tags exists) and
 * roles have been tagged via `scripts/backfill-role-tags.ts`. If tags
 * aren't populated yet, the interest-fit component just returns neutral
 * 0.5 — no error — so the script still works; scores are just less
 * differentiated.
 *
 * Usage:
 *   npx tsx scripts/backfill-fit-scores.ts                # apply
 *   npx tsx scripts/backfill-fit-scores.ts --dry-run      # log only
 *
 * Reads .env.local for Supabase creds. Iterates every user with at least
 * one scored application; for each, calls recomputeFitScoresForUser.
 */

import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";

dotenvConfig({ path: resolve(process.cwd(), ".env.local") });

function parseArgs() {
  return { dryRun: process.argv.includes("--dry-run") };
}

async function main() {
  const { dryRun } = parseArgs();
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    console.error(
      "Missing creds — need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local"
    );
    process.exit(1);
  }

  const { createServiceClient } = await import("../lib/supabase/service");
  const { recomputeFitScoresForUser } = await import("../lib/db/applications");
  const { getProfile } = await import("../lib/db/profile");
  const { computeFitScore } = await import("../lib/scoring/fit");
  const s = createServiceClient();

  // Find every user with at least one application in a scored triage state.
  const { data: rows, error } = await s
    .from("applications")
    .select("user_id")
    .in("triage_state", ["inbox", "active", "snoozed"]);
  if (error) throw error;
  const userIds = Array.from(
    new Set((rows ?? []).map((r) => r.user_id as string))
  );

  console.log(
    `${userIds.length} user(s) with scored applications.${dryRun ? " (dry-run)" : ""}\n`
  );

  let totalUpdated = 0;
  for (const userId of userIds) {
    if (dryRun) {
      // Preview: fetch profile + apps, compute scores, log without persisting.
      const profile = await getProfile(s, userId);
      if (!profile) {
        console.log(`  ${userId}: no profile — skip`);
        continue;
      }
      const { data: apps } = await s
        .from("applications")
        .select("id, role:roles(*)")
        .eq("user_id", userId)
        .in("triage_state", ["inbox", "active", "snoozed"]);
      const rows = (apps ?? []) as unknown as {
        id: string;
        role: Parameters<typeof computeFitScore>[0];
      }[];
      const scores = rows.map((r) => computeFitScore(r.role, profile).total);
      const dist: Record<string, number> = {};
      for (const sc of scores) {
        const bucket =
          sc >= 0.8 ? "≥0.80" : sc >= 0.5 ? "0.50-0.79" : "<0.50";
        dist[bucket] = (dist[bucket] ?? 0) + 1;
      }
      console.log(
        `  ${userId}: ${rows.length} apps; distribution ${JSON.stringify(dist)}`
      );
      continue;
    }

    const { updated } = await recomputeFitScoresForUser(s, userId);
    totalUpdated += updated;
    console.log(`  ✓ ${userId}: ${updated} application(s) rescored`);
  }

  console.log(
    `\nDone. ${dryRun ? "(dry-run — no writes)" : `Persisted ${totalUpdated} fit_score value(s).`}`
  );
}

main().catch((e) => {
  console.error("backfill-fit-scores failed:", e);
  process.exit(1);
});
