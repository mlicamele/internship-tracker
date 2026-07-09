/**
 * One-off backfill: compute + persist resume_fit_score for every scored
 * application. Skips apps where the cache-hash matches (idempotent — safe
 * to re-run). Groq-serialized, so ~400ms per LLM call after the first;
 * expect ~5s per 10 apps for a cold run.
 *
 * Prerequisite: migration 0016 applied (resume_fit_* columns exist) AND
 * at least one master resume uploaded (else all rows short-circuit to
 * `no_resume`).
 *
 * Usage:
 *   npx tsx scripts/backfill-resume-fit.ts               # apply (respects cache)
 *   npx tsx scripts/backfill-resume-fit.ts --force       # re-score even on cache hit
 *   npx tsx scripts/backfill-resume-fit.ts --dry-run     # log only, no writes
 *
 * Reads .env.local for Supabase creds + GROQ_API_KEY.
 */

import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";

dotenvConfig({ path: resolve(process.cwd(), ".env.local") });

function parseArgs() {
  return {
    dryRun: process.argv.includes("--dry-run"),
    force: process.argv.includes("--force"),
  };
}

async function main() {
  const { dryRun, force } = parseArgs();
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    console.error(
      "Missing creds — need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local"
    );
    process.exit(1);
  }
  if (!process.env.GROQ_API_KEY) {
    console.error("Missing GROQ_API_KEY — cold scoring will fail.");
    process.exit(1);
  }

  const { createServiceClient } = await import("../lib/supabase/service");
  const { scoreAndPersistResumeFit } = await import("../lib/db/resume-fit");
  const s = createServiceClient();

  const { data: rows, error } = await s
    .from("applications")
    .select("id, user_id, resume_fit_score")
    .in("triage_state", ["inbox", "active", "snoozed"])
    .order("created_at", { ascending: true });
  if (error) throw error;

  const apps = (rows ?? []) as {
    id: string;
    user_id: string;
    resume_fit_score: number | null;
  }[];
  console.log(
    `${apps.length} application(s) in scored triage states.${dryRun ? " (dry-run)" : ""}${force ? " [force]" : ""}\n`
  );

  if (dryRun) {
    const already = apps.filter((a) => a.resume_fit_score != null).length;
    console.log(`  Existing scores: ${already} / ${apps.length}`);
    console.log(`  Would rescore: ${force ? apps.length : apps.length - already} apps`);
    return;
  }

  const tally = {
    scored: 0,
    cache_hit: 0,
    insufficient_text: 0,
    no_resume: 0,
    llm_error: 0,
    not_found: 0,
  };
  let i = 0;
  for (const app of apps) {
    i++;
    const result = await scoreAndPersistResumeFit(s, app.id, { force });
    tally[result.outcome]++;
    const scoreStr = result.score != null ? String(Math.round(result.score)) : "—";
    console.log(
      `  [${String(i).padStart(3, " ")}/${apps.length}] ${result.outcome.padEnd(18)} ${scoreStr.padStart(3)} ${app.id}`
    );
  }

  console.log(
    `\nDone.  scored ${tally.scored}  cache_hit ${tally.cache_hit}  insufficient ${tally.insufficient_text}  no_resume ${tally.no_resume}  llm_error ${tally.llm_error}`
  );
}

main().catch((e) => {
  console.error("backfill-resume-fit failed:", e);
  process.exit(1);
});
