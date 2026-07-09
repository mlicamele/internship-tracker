/**
 * One-off: re-run LLM extraction on the 11 roles with min_grad_year set
 * (or max_grad_year set), to let the newly-tightened prompt + safety net
 * try again. Updates ONLY min/max_grad_year + their confidences +
 * matching snapshot keys — leaves everything else untouched.
 *
 * Uses userPastedJdBody as the LLM input source since the original URL
 * fetch may re-return different HTML today. jd_body_text on the row is
 * the authoritative snapshot from the first extraction.
 *
 * Usage:
 *   npx tsx scripts/reextract-gradyear-roles.ts --dry-run
 *   npx tsx scripts/reextract-gradyear-roles.ts
 */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

function parseArgs() {
  return { dryRun: process.argv.includes("--dry-run") };
}

async function main() {
  const { dryRun } = parseArgs();
  const { createServiceClient } = await import("../lib/supabase/service");
  const { extractJobFromEvidence } = await import("../lib/llm/extract-job");
  const s = createServiceClient();

  const { data, error } = await s
    .from("roles")
    .select("id, title, jd_url, jd_body_text, min_grad_year, max_grad_year, extraction_confidences, extraction_snapshot")
    .or("min_grad_year.not.is.null,max_grad_year.not.is.null");
  if (error) throw error;
  const rows = data ?? [];
  console.log(`${rows.length} role(s) with a grad-year bound.${dryRun ? " (dry-run)" : ""}\n`);

  let changed = 0;
  for (const r of rows) {
    const rid = String(r.id).slice(0, 8);
    const title = String(r.title).slice(0, 60);
    if (!r.jd_body_text || String(r.jd_body_text).length < 200) {
      console.log(`  skip ${rid} — no JD body: ${title}`);
      continue;
    }
    process.stdout.write(`  ${rid} ${title.padEnd(60)}  `);
    const extracted = await extractJobFromEvidence({
      url: r.jd_url ?? "unknown",
      userPastedJdBody: r.jd_body_text,
    });
    // Guard against silent Groq TPD failures: extractJobFromEvidence is
    // never-throws and returns SAFE_DEFAULT on any error, indistinguishable
    // from "successfully extracted a totally empty JD". If title AND company
    // AND tags are all empty, this is almost certainly a rate-limit failure
    // masquerading as a valid empty result — skip rather than persist nulls.
    // See CLAUDE.md Lesson on silent Groq TPD failures.
    const looksLikeFailure =
      extracted.title == null &&
      extracted.company == null &&
      extracted.tags.length === 0 &&
      extracted.min_grad_year == null &&
      extracted.max_grad_year == null;
    if (looksLikeFailure) {
      process.stdout.write(`(likely LLM failure — skipping)\n`);
      continue;
    }
    const newMin = extracted.min_grad_year;
    const newMax = extracted.max_grad_year;
    const same = newMin === r.min_grad_year && newMax === r.max_grad_year;
    process.stdout.write(
      `min ${r.min_grad_year ?? "null"}→${newMin ?? "null"}, max ${r.max_grad_year ?? "null"}→${newMax ?? "null"}${same ? "  (unchanged)" : "  CHANGED"}\n`
    );
    if (same) continue;
    changed++;
    if (dryRun) continue;

    const confs = { ...(r.extraction_confidences as Record<string, string> | null ?? {}) };
    if (extracted.confidences.min_grad_year) confs.min_grad_year = extracted.confidences.min_grad_year;
    else delete confs.min_grad_year;
    if (extracted.confidences.max_grad_year) confs.max_grad_year = extracted.confidences.max_grad_year;
    else delete confs.max_grad_year;

    const snapshot = (r.extraction_snapshot as { values?: Record<string, unknown>; confidences?: Record<string, string> } | null) ?? { values: {}, confidences: {} };
    const snapValues = { ...(snapshot.values ?? {}) } as Record<string, unknown>;
    const snapConfs = { ...(snapshot.confidences ?? {}) } as Record<string, string>;
    snapValues.min_grad_year = newMin;
    snapValues.max_grad_year = newMax;
    if (confs.min_grad_year) snapConfs.min_grad_year = confs.min_grad_year;
    else delete snapConfs.min_grad_year;
    if (confs.max_grad_year) snapConfs.max_grad_year = confs.max_grad_year;
    else delete snapConfs.max_grad_year;

    const { error: upErr } = await s
      .from("roles")
      .update({
        min_grad_year: newMin,
        max_grad_year: newMax,
        extraction_confidences: confs,
        extraction_snapshot: { values: snapValues, confidences: snapConfs },
      })
      .eq("id", r.id);
    if (upErr) {
      console.error(`   ! update failed: ${upErr.message}`);
    }
  }

  console.log(`\n${changed} role(s) ${dryRun ? "would be" : "were"} updated.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
