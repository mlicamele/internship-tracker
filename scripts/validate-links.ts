/**
 * Link validator for triage. Probes jd_url for every role that has at
 * least one application in triage_state IN ('inbox','active','snoozed')
 * and reports back what's live / dead / suspect / unknown.
 *
 * Loop lives in lib/link-check/run-batch.ts so the /api/cron/validate-
 * links endpoint runs identical logic.
 *
 * Prerequisite: migration 0017_link_status.sql must be applied.
 *
 * Usage:
 *   npx tsx scripts/validate-links.ts               # dry-run: log only
 *   npx tsx scripts/validate-links.ts --apply       # write link_status
 *   npx tsx scripts/validate-links.ts --recheck-all # ignore link_checked_at freshness
 *   npx tsx scripts/validate-links.ts --stale-days=7 # only recheck older than N days
 */

import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";

dotenvConfig({ path: resolve(process.cwd(), ".env.local") });

function parseArgs() {
  const staleDaysArg = process.argv.find((a) => a.startsWith("--stale-days="));
  const staleDays = staleDaysArg
    ? Number(staleDaysArg.split("=")[1]) || 7
    : 7;
  return {
    apply: process.argv.includes("--apply"),
    recheckAll: process.argv.includes("--recheck-all"),
    staleDays,
  };
}

async function main() {
  const args = parseArgs();

  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    console.error(
      "Missing creds — need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"
    );
    process.exit(1);
  }

  const { createServiceClient } = await import("../lib/supabase/service");
  const { runLinkValidation } = await import("../lib/link-check/run-batch");
  const s = createServiceClient();

  const summary = await runLinkValidation(s, {
    apply: args.apply,
    recheckAll: args.recheckAll,
    staleDays: args.staleDays,
    onProgress: (i, total, label, status, reason) => {
      const marker =
        status === "dead" ? "✗" : status === "suspect" ? "?" : ".";
      const shortLabel = label.slice(0, 60);
      console.log(
        `${marker} [${status.padEnd(7)}] ${shortLabel.padEnd(62)} ${reason}`
      );
    },
  });

  console.log("\n== Summary ==");
  console.log(`  total in triage: ${summary.total_triage_roles}`);
  console.log(`  checked:         ${summary.checked}`);
  console.log(`  live:            ${summary.live}`);
  console.log(`  dead:            ${summary.dead}`);
  console.log(`  suspect:         ${summary.suspect}`);
  console.log(`  unknown:         ${summary.unknown}`);
  console.log(`  wall clock:      ${(summary.wall_clock_ms / 1000).toFixed(1)}s`);
  console.log(
    summary.wrote_updates ? "  writes: applied" : "  writes: SKIPPED (dry-run)"
  );

  if (summary.transitions.length) {
    console.log(`\n== State transitions to non-live (${summary.transitions.length}) ==`);
    for (const t of summary.transitions) {
      console.log(`  ${t.label.slice(0, 80)}`);
      console.log(`    ${t.from} -> ${t.to} (${t.reason})`);
      console.log(`    ${t.jd_url}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
