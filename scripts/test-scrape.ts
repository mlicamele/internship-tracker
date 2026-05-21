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
import { readFileSync, writeFileSync, createWriteStream } from "fs";
import { resolve } from "path";

// Tee stdout + stderr to scripts/test-output.txt (overwritten each run).
// Strips ANSI color codes from the file copy. We only patch the low-level
// write functions — console.log routes through stdout.write automatically,
// so this captures everything without double-printing.
const OUTPUT_FILE = resolve(process.cwd(), "scripts/test-output.txt");
writeFileSync(OUTPUT_FILE, "");
const fileStream = createWriteStream(OUTPUT_FILE, { flags: "a" });
const ANSI = /\x1b\[[0-9;]*m/g;
function teeWrite(stream: NodeJS.WriteStream) {
  const orig = stream.write.bind(stream);
  stream.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    const text =
      typeof chunk === "string" ? chunk : chunk instanceof Uint8Array ? Buffer.from(chunk).toString() : "";
    if (text) fileStream.write(text.replace(ANSI, ""));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return orig(chunk as any, ...(rest as any));
  }) as typeof stream.write;
}
teeWrite(process.stdout);
teeWrite(process.stderr);

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

if (!process.env.GROQ_API_KEY) {
  console.error("GROQ_API_KEY missing. Get one free at https://console.groq.com/keys, add to .env.local.");
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
    "locations",
    "work_model",
    "target_year",
    "target_season",
    "max_grad_year",
    "relocation_assistance",
    "deadline_at",
    "posted_at",
    "compensation_hourly_dollars",
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
      const filled = fieldKeys.filter((k) => isFieldFilled(extracted[k])).length;
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
    const filled = results.filter((r) => isFieldFilled(r.extracted[k])).length;
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
      const display = displayValue(v);
      const conf = r.extracted.confidences?.[k];
      const confStr = conf !== undefined ? ` \x1b[90m[${Math.round(conf * 100)}%]\x1b[0m` : "";
      console.log(`  ${k.padEnd(28)} ${display}${confStr}`);
    }
    if (r.extracted.jd_body) {
      const bodyPreview = r.extracted.jd_body.replace(/\s+/g, " ").trim().slice(0, 150);
      console.log(`  jd_body                      ${r.extracted.jd_body.length} chars: "${bodyPreview}…"`);
    } else {
      console.log(`  jd_body                      \x1b[31mempty\x1b[0m`);
    }
  }

  // Overall accuracy estimate
  const allFilled = results.reduce<number>(
    (sum, r) =>
      sum +
      fieldKeys.filter((k) => isFieldFilled(r.extracted[k])).length,
    0
  );
  const total = results.length * fieldKeys.length;
  console.log(`\n\x1b[1mOverall fill rate: ${Math.round((allFilled / total) * 100)}%\x1b[0m  (${allFilled}/${total} fields populated)`);
}

function isFieldFilled(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (v === "") return false;
  if (v === "unspecified") return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function displayValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "\x1b[90m∅\x1b[0m";
  if (v === "unspecified") return "\x1b[90munspecified\x1b[0m";
  if (Array.isArray(v)) {
    if (v.length === 0) return "\x1b[90m∅\x1b[0m";
    return v
      .map((item) => {
        if (item && typeof item === "object" && "text" in item) {
          const o = item as { text: string; lat?: number | null; lng?: number | null };
          const geo = o.lat != null && o.lng != null ? ` (${o.lat.toFixed(2)}, ${o.lng.toFixed(2)})` : "";
          return `${o.text}${geo}`;
        }
        return String(item);
      })
      .join("\n                                ");
  }
  return String(v);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
