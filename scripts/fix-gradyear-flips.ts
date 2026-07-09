/**
 * One-off: fix roles where the LLM extractor stored a year in
 * min_grad_year when the JD's directional language ("by X", "or earlier",
 * "no later than", "before") unambiguously indicates an upper bound.
 * Mirrors the sanityCheckGradYears logic in lib/llm/extract-job.ts for
 * rows already persisted before that safety net landed.
 *
 * Usage:
 *   npx tsx scripts/fix-gradyear-flips.ts --dry-run    # preview
 *   npx tsx scripts/fix-gradyear-flips.ts              # apply
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
  const s = createServiceClient();

  const { data, error } = await s
    .from("roles")
    .select("id, title, min_grad_year, max_grad_year, jd_body_text, extraction_confidences, extraction_snapshot")
    .not("min_grad_year", "is", null)
    .is("max_grad_year", null);
  if (error) throw error;

  const upperBoundSignals = [
    /\bor earlier\b/,
    /\bor before\b/,
    /\bno later than\b/,
    /\bby\s+(january|february|march|april|may|june|july|august|september|october|november|december|spring|summer|fall|winter|q[1-4])?\s*\d{4}\b/,
  ];
  const lowerBoundSignals = [/\bor later\b/, /\band beyond\b/, /\bor after\b/];

  let flipped = 0;
  for (const r of data ?? []) {
    const body = String(r.jd_body_text ?? "").toLowerCase();
    const hasUpper = upperBoundSignals.some((re) => re.test(body));
    const hasLower = lowerBoundSignals.some((re) => re.test(body));
    if (!hasUpper || hasLower) {
      console.log(
        `  keep ${String(r.id).slice(0, 8)} min=${r.min_grad_year}  — no unambiguous upper-bound signal`
      );
      continue;
    }

    console.log(
      `  FLIP ${String(r.id).slice(0, 8)} min=${r.min_grad_year}→null, max=null→${r.min_grad_year}: ${String(r.title).slice(0, 60)}`
    );
    flipped++;

    if (dryRun) continue;

    // Mirror the confidence key too.
    const confs = { ...(r.extraction_confidences as Record<string, string> | null ?? {}) };
    if (confs.min_grad_year) {
      confs.max_grad_year = confs.min_grad_year;
      delete confs.min_grad_year;
    }

    // Mirror the extraction_snapshot too so revert-button semantics stay honest.
    const snapshot = (r.extraction_snapshot as { values?: Record<string, unknown>; confidences?: Record<string, string> } | null) ?? { values: {}, confidences: {} };
    const snapValues = { ...(snapshot.values ?? {}) } as Record<string, unknown>;
    const snapConfs = { ...(snapshot.confidences ?? {}) } as Record<string, string>;
    if ("min_grad_year" in snapValues) {
      snapValues.max_grad_year = snapValues.min_grad_year;
      snapValues.min_grad_year = null;
    }
    if (snapConfs.min_grad_year) {
      snapConfs.max_grad_year = snapConfs.min_grad_year;
      delete snapConfs.min_grad_year;
    }

    const { error: upErr } = await s
      .from("roles")
      .update({
        min_grad_year: null,
        max_grad_year: r.min_grad_year,
        extraction_confidences: confs,
        extraction_snapshot: { values: snapValues, confidences: snapConfs },
      })
      .eq("id", r.id);
    if (upErr) {
      console.error(`  ! update failed for ${r.id}:`, upErr.message);
    }
  }

  console.log(
    `\n${flipped} role(s) ${dryRun ? "would be" : "were"} flipped.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
