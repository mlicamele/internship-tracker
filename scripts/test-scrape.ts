/**
 * Test harness for scrapeUrl. Reads URLs from scripts/test-urls.json (or
 * the path passed as the first argument), runs the scraper against each,
 * prints a colored summary of which fields came through.
 *
 * Usage:
 *   npx tsx scripts/test-scrape.ts
 *   npx tsx scripts/test-scrape.ts path/to/other-urls.json
 *   npx tsx scripts/test-scrape.ts -- "https://example.com/jobs/foo"
 */

import { config as dotenvConfig } from "dotenv";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env.local (which is what Next.js uses)
dotenvConfig({ path: resolve(process.cwd(), ".env.local") });

// Load URLs
const args = process.argv.slice(2);
let urls: string[];
if (args[0] === "--" && args[1]) {
  urls = [args[1]];
} else {
  const file = args[0] || "scripts/test-urls.json";
  const raw = readFileSync(resolve(process.cwd(), file), "utf-8");
  urls = JSON.parse(raw);
}

if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY missing. Get one free at https://aistudio.google.com/apikey, add to .env.local.");
  process.exit(1);
}

// Make sure NOMINATIM_USER_AGENT is set (avoid throwing in geocode)
process.env.NOMINATIM_USER_AGENT =
  process.env.NOMINATIM_USER_AGENT || "InternshipTracker-test (test@example.com)";

// Import after env loaded
async function main() {
  const { scrapeUrl } = await import("../lib/scrape/url");

  console.log(`Testing ${urls.length} URLs\n`);

  const fieldKeys = [
    "company",
    "title",
    "location_text",
    "work_model",
    "target_year",
    "target_season",
    "class_year_tag",
    "deadline_at",
    "posted_at",
    "compensation_text",
    "compensation_hourly_cents",
  ] as const;

  type Row = {
    url: string;
    extracted: Awaited<ReturnType<typeof scrapeUrl>>;
    duration_ms: number;
  };

  const results: Row[] = [];

  for (const url of urls) {
    const host = new URL(url).hostname;
    process.stdout.write(`→ ${host} ... `);
    const t0 = Date.now();
    try {
      const extracted = await scrapeUrl(url);
      const duration_ms = Date.now() - t0;
      results.push({ url, extracted, duration_ms });
      const filled = fieldKeys.filter((k) => {
        const v = extracted[k];
        return v !== null && v !== undefined && v !== "" && v !== "unspecified";
      }).length;
      const pct = Math.round((filled / fieldKeys.length) * 100);
      const tag =
        pct >= 80 ? "\x1b[32m✓\x1b[0m" :
        pct >= 50 ? "\x1b[33m~\x1b[0m" :
        "\x1b[31m✗\x1b[0m";
      console.log(`${tag} ${pct}% (${filled}/${fieldKeys.length} fields) in ${duration_ms}ms`);
    } catch (err) {
      const duration_ms = Date.now() - t0;
      console.log(`\x1b[31m✗\x1b[0m ERROR ${(err as Error).message} in ${duration_ms}ms`);
    }
  }

  // Per-field summary
  console.log("\nField coverage across all URLs:");
  for (const k of fieldKeys) {
    const filled = results.filter((r) => {
      const v = r.extracted[k];
      return v !== null && v !== undefined && v !== "" && v !== "unspecified";
    }).length;
    const pct = Math.round((filled / results.length) * 100);
    const bar = "█".repeat(Math.round(pct / 5)) + "░".repeat(20 - Math.round(pct / 5));
    console.log(`  ${k.padEnd(28)} ${bar} ${pct}%`);
  }

  // Detailed dump
  console.log("\n\nDetailed results:");
  for (const r of results) {
    console.log("\n" + "─".repeat(70));
    console.log(`URL: ${r.url}`);
    console.log(`Took: ${r.duration_ms}ms · confidence ${r.extracted.overall_confidence.toFixed(2)} · ${r.extracted.thin ? "THIN" : "rich"}`);
    if (r.extracted.notes) console.log(`Notes: ${r.extracted.notes}`);
    for (const k of fieldKeys) {
      const v = r.extracted[k];
      const display =
        v === null || v === undefined || v === "" ? "\x1b[90m∅\x1b[0m" :
        v === "unspecified" ? "\x1b[90munspecified\x1b[0m" :
        String(v).slice(0, 80);
      console.log(`  ${k.padEnd(28)} ${display}`);
    }
    if (r.extracted.jd_body) {
      const bodyPreview = r.extracted.jd_body.replace(/\s+/g, " ").trim().slice(0, 150);
      console.log(`  jd_body                      ${r.extracted.jd_body.length} chars: "${bodyPreview}…"`);
    } else {
      console.log(`  jd_body                      \x1b[31mempty\x1b[0m`);
    }
  }

  // Overall accuracy estimate
  const allFilled = results.reduce(
    (sum, r) =>
      sum +
      fieldKeys.filter((k) => {
        const v = r.extracted[k];
        return v !== null && v !== undefined && v !== "" && v !== "unspecified";
      }).length,
    0
  );
  const total = results.length * fieldKeys.length;
  console.log(`\n\x1b[1mOverall fill rate: ${Math.round((allFilled / total) * 100)}%\x1b[0m  (${allFilled}/${total} fields populated)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
