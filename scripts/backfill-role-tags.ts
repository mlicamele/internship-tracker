/**
 * One-off backfill: classify every existing role with tags from the
 * INTEREST_TAGS vocabulary. Uses the cheap `classifyRoleTags` helper
 * (title + company → 0-3 tags via Groq gpt-oss-120b).
 *
 * Idempotent — by default skips roles that already have >=1 tag.
 * Pass --force to re-classify all roles (overwrites existing tags).
 * Pass --dry-run to log the proposed tags without persisting.
 *
 * Also refreshes the `tags` entry inside `extraction_snapshot.values` so
 * the per-field revert button surfaces the LLM's classification instead
 * of an empty array. Confidence for tags is set to "medium" (LLM output,
 * not a directly-labeled structured source).
 *
 * Prerequisite: migration 0013_role_tags.sql must be applied in Supabase.
 *
 * Usage:
 *   npx tsx scripts/backfill-role-tags.ts               # apply, skip already-tagged
 *   npx tsx scripts/backfill-role-tags.ts --dry-run     # log only
 *   npx tsx scripts/backfill-role-tags.ts --force       # re-tag ALL roles
 */

import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";

dotenvConfig({ path: resolve(process.cwd(), ".env.local") });

interface Row {
  id: string;
  title: string;
  tags: string[];
  extraction_snapshot: {
    values?: Record<string, unknown>;
    confidences?: Record<string, string>;
  };
  extraction_confidences: Record<string, string>;
  company: { name: string } | null;
}

function parseArgs() {
  return {
    dryRun: process.argv.includes("--dry-run"),
    force: process.argv.includes("--force"),
    allowHeavyRun: process.argv.includes("--allow-heavy-run"),
  };
}

async function main() {
  const { dryRun, force, allowHeavyRun } = parseArgs();
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    !process.env.GROQ_API_KEY
  ) {
    console.error(
      "Missing creds — need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GROQ_API_KEY in .env.local"
    );
    process.exit(1);
  }

  const { createServiceClient } = await import("../lib/supabase/service");
  const { classifyRoleTags } = await import("../lib/llm/extract-job");
  const s = createServiceClient();

  const { data, error } = await s
    .from("roles")
    .select(
      "id, title, tags, extraction_snapshot, extraction_confidences, company:companies(name)"
    );
  if (error) throw error;
  const all = (data ?? []) as unknown as Row[];

  const targets = force ? all : all.filter((r) => !r.tags || r.tags.length === 0);
  console.log(
    `${all.length} total roles; ${targets.length} to classify${force ? " (--force)" : ""}${dryRun ? " (dry-run)" : ""}.\n`
  );

  // Pre-flight budget check. Tag classification is cheaper per call than a
  // full extraction (~2K tokens vs 8K, per AVG_TOKENS_PER_TAG_CLASSIFY)
  // but a large --force run could still eat meaningful budget.
  if (!dryRun && targets.length > 0) {
    const { estimateBatchCost, AUTOMATED_DAILY_BUDGET, GROQ_LIMITS, AVG_TOKENS_PER_TAG_CLASSIFY } =
      await import("../lib/llm/limits");
    const est = estimateBatchCost(targets.length, AVG_TOKENS_PER_TAG_CLASSIFY);
    console.log(
      `Budget estimate: ${targets.length} tag classification(s) ≈ ${est.tokens.toLocaleString()} tokens (${est.pctOfDailyTPD}% of ${GROQ_LIMITS.tokensPerDay.toLocaleString()} TPD; ${est.pctOfAutomatedTPD}% of ${AUTOMATED_DAILY_BUDGET.tokens.toLocaleString()} automated budget).\n`
    );
    if ((est.exceedsAutomatedTPD || est.exceedsAutomatedRPD) && !allowHeavyRun) {
      console.error(
        `Aborting: batch exceeds the automated daily budget. Re-run with --allow-heavy-run to confirm.`
      );
      process.exit(1);
    }
  }

  let tagged = 0;
  let empty = 0;

  for (const row of targets) {
    const companyName = row.company?.name ?? null;
    const tags = await classifyRoleTags({
      company: companyName,
      title: row.title,
    });

    const line = `${row.id}  ${companyName ?? "?"} / ${row.title}`.slice(0, 90);
    if (tags.length === 0) {
      console.log(`  · ${line}\n     → []`);
      empty++;
      if (!force) continue;
    } else {
      console.log(`  ✓ ${line}\n     → [${tags.join(", ")}]`);
      tagged++;
    }

    if (dryRun) continue;

    const snapshot = row.extraction_snapshot ?? { values: {}, confidences: {} };
    const values = { ...(snapshot.values ?? {}), tags };
    const confidences = { ...(snapshot.confidences ?? {}) };
    if (tags.length > 0) confidences.tags = "medium";
    const nextSnapshot = { values, confidences };

    const nextExtractionConfidences = { ...(row.extraction_confidences ?? {}) };
    if (tags.length > 0) nextExtractionConfidences.tags = "medium";

    const { error: upErr } = await s
      .from("roles")
      .update({
        tags,
        extraction_snapshot: nextSnapshot,
        extraction_confidences: nextExtractionConfidences,
      })
      .eq("id", row.id);
    if (upErr) console.log(`     ✗ update failed: ${upErr.message}`);
  }

  console.log(
    `\nDone. Tagged ${tagged} role(s); ${empty} had no vocabulary hit.${dryRun ? " (No writes — dry-run.)" : ""}`
  );
}

main().catch((e) => {
  console.error("backfill-role-tags failed:", e);
  process.exit(1);
});
