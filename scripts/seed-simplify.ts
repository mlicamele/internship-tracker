/**
 * One-off seed harness for the Phase 5 SimplifyJobs ingest.
 *
 * Phase 5's daily GH Actions cron caps new-role extractions at ~15/run to
 * fit Vercel's 60s free-tier timeout. But on day 1 the upstream list has
 * ~60 matching Summer 2027 postings — waiting 4 days for the cron to
 * catch up leaves the inbox empty in the meantime. This script runs the
 * same ingest logic locally with no cap and no timeout.
 *
 * Usage:
 *   npx tsx scripts/seed-simplify.ts --dry-run --limit=3     # smoke test
 *   npx tsx scripts/seed-simplify.ts                          # real fill
 *   npx tsx scripts/seed-simplify.ts --limit=10               # partial
 *
 * Reads CRON_USER_ID (or SEED_USER_ID) and Supabase / Groq creds from
 * .env.local. Writes plain-text output to scripts/seed-simplify-output.txt.
 */

import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";
import { createWriteStream, writeFileSync } from "fs";

const OUTPUT_FILE = resolve(process.cwd(), "scripts/seed-simplify-output.txt");
writeFileSync(OUTPUT_FILE, "");
const fileStream = createWriteStream(OUTPUT_FILE, { flags: "a" });
const ANSI = /\x1b\[[0-9;]*m/g;
function teeWrite(stream: NodeJS.WriteStream) {
  const orig = stream.write.bind(stream);
  stream.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    const text =
      typeof chunk === "string"
        ? chunk
        : chunk instanceof Uint8Array
          ? Buffer.from(chunk).toString()
          : "";
    if (text) fileStream.write(text.replace(ANSI, ""));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return orig(chunk as any, ...(rest as any));
  }) as typeof stream.write;
}
teeWrite(process.stdout);
teeWrite(process.stderr);

dotenvConfig({ path: resolve(process.cwd(), ".env.local") });
process.env.NOMINATIM_USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ||
  "InternshipTracker-seed (seed@example.com)";

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    dryRun: false,
    limit: undefined as number | undefined,
    concurrency: 3,
    allowHeavyRun: false,
  };
  for (const a of args) {
    if (a === "--dry-run") opts.dryRun = true;
    else if (a.startsWith("--limit=")) opts.limit = parseInt(a.slice(8), 10);
    else if (a.startsWith("--concurrency="))
      opts.concurrency = parseInt(a.slice(14), 10);
    else if (a === "--allow-heavy-run") opts.allowHeavyRun = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: npx tsx scripts/seed-simplify.ts [--dry-run] [--limit=N] [--concurrency=N] [--allow-heavy-run]"
      );
      process.exit(0);
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs();

  const userId =
    process.env.CRON_USER_ID ||
    process.env.SEED_USER_ID ||
    process.env.CAPTURE_USER_ID;
  if (!userId) {
    console.error(
      "Set CRON_USER_ID (or SEED_USER_ID / CAPTURE_USER_ID) in .env.local to the Supabase user_id that should own the seeded applications."
    );
    process.exit(1);
  }
  if (!process.env.GROQ_API_KEY) {
    console.error("GROQ_API_KEY missing.");
    process.exit(1);
  }
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    console.error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required."
    );
    process.exit(1);
  }

  const { createServiceClient } = await import("../lib/supabase/service");
  const { ingestSimplifyListings } = await import("../lib/simplify/ingest");
  const {
    estimateBatchCost,
    AUTOMATED_DAILY_BUDGET,
    GROQ_LIMITS,
  } = await import("../lib/llm/limits");

  const supabase = createServiceClient();

  // Pre-flight budget check. This script is the one that historically blew
  // through TPD (57-URL day-1 seed). Any run projected over the automated
  // daily budget must be explicitly authorised with --allow-heavy-run.
  if (opts.limit !== undefined && !opts.dryRun) {
    const est = estimateBatchCost(opts.limit);
    console.log(
      `Budget estimate: ${opts.limit} extraction(s) ≈ ${est.tokens.toLocaleString()} tokens (${est.pctOfDailyTPD}% of ${GROQ_LIMITS.tokensPerDay.toLocaleString()} TPD; ${est.pctOfAutomatedTPD}% of ${AUTOMATED_DAILY_BUDGET.tokens.toLocaleString()} automated budget).`
    );
    if (
      (est.exceedsAutomatedTPD || est.exceedsAutomatedRPD) &&
      !opts.allowHeavyRun
    ) {
      console.error(
        `\nAborting: batch exceeds the automated daily budget. Re-run with --allow-heavy-run to confirm you accept eating into the user-manual reserve.`
      );
      process.exit(1);
    }
  }

  console.log(
    `Running seed ingest (dryRun=${opts.dryRun}, limit=${opts.limit ?? "∞"}, concurrency=${opts.concurrency})\n`
  );

  const summary = await ingestSimplifyListings(supabase, userId, {
    dryRun: opts.dryRun,
    maxNewExtractions: opts.limit,
    concurrency: opts.concurrency,
    onProgress: (msg) => console.log(`  · ${msg}`),
  });

  console.log("\n─── Summary ──────────────────────────────────────────────");
  console.log(`  fetched              ${summary.fetched}`);
  console.log(`  filtered out         ${summary.filtered_out}`);
  console.log(`  skipped malformed    ${summary.skipped_malformed}`);
  console.log(`  matched existing     ${summary.matched_existing}`);
  console.log(`  new candidates       ${summary.new_candidates}`);
  console.log(`  extracted this run   ${summary.extracted_now}`);
  console.log(`  deferred to next run ${summary.deferred}`);
  console.log(`  new roles            ${summary.new_roles}`);
  console.log(`  updated roles        ${summary.updated_roles}`);
  console.log(`  new applications     ${summary.new_applications}`);
  console.log(`  existing apps        ${summary.existing_applications}`);
  console.log(`  extraction errors    ${summary.extraction_errors.length}`);
  console.log(`  duration             ${(summary.duration_ms / 1000).toFixed(1)}s`);
  console.log(
    `  tokens (est.)        ${summary.estimated_tokens_used.toLocaleString()} (${summary.estimated_pct_of_daily_tpd}% of daily TPD)`
  );

  if (summary.fetch_warnings.length) {
    console.log("\nFetch warnings:");
    for (const w of summary.fetch_warnings) console.log(`  ! ${w}`);
  }
  if (summary.extraction_errors.length) {
    console.log("\nExtraction errors:");
    for (const e of summary.extraction_errors) {
      console.log(`  ✗ ${e.id}  ${e.url}`);
      console.log(`      ${e.message}`);
    }
  }
}

main().catch((err) => {
  console.error("seed-simplify failed:", err);
  process.exit(1);
});
