/**
 * One-off backfill: re-geocode any role location that has a text but no
 * lat/lng. Fixes the 14 roles whose coords were wiped by an earlier
 * refresh-path bug in `lib/simplify/ingest.ts` (upstream location text
 * mismatched the extraction-time text, so refresh overwrote coords with
 * null instead of preserving them).
 *
 * Idempotent — runs against ALL roles, only patches locations with null
 * coords + non-empty text. Safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/regeocode-null-coords.ts               # apply
 *   npx tsx scripts/regeocode-null-coords.ts --dry-run     # log only
 *
 * Reads .env.local for Supabase + Nominatim creds. Prints progress.
 */

import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";

dotenvConfig({ path: resolve(process.cwd(), ".env.local") });
process.env.NOMINATIM_USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ||
  "InternshipTracker-regeocode (regeocode@example.com)";

interface Row {
  id: string;
  locations: { text: string; lat: number | null; lng: number | null }[];
}

function parseArgs() {
  return { dryRun: process.argv.includes("--dry-run") };
}

async function main() {
  const { dryRun } = parseArgs();
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    console.error("Supabase creds missing from .env.local");
    process.exit(1);
  }

  const { createServiceClient } = await import("../lib/supabase/service");
  const { geocode } = await import("../lib/geocode");
  const s = createServiceClient();

  const { data, error } = await s.from("roles").select("id, locations");
  if (error) throw error;
  const all = (data ?? []) as Row[];

  const targets = all.filter((r) =>
    r.locations.some((l) => l.text && (l.lat === null || l.lng === null))
  );
  console.log(
    `${all.length} total roles; ${targets.length} have at least one null-coord location.\n`
  );

  let patched = 0;
  let stillNull = 0;

  for (const row of targets) {
    const patchedLocs: Row["locations"] = [];
    let anyChanged = false;
    for (const loc of row.locations) {
      if (loc.text && (loc.lat === null || loc.lng === null)) {
        try {
          const c = await geocode(loc.text);
          if (c) {
            patchedLocs.push({ text: loc.text, lat: c.lat, lng: c.lng });
            anyChanged = true;
            continue;
          }
          stillNull++;
        } catch {
          stillNull++;
        }
      }
      patchedLocs.push(loc);
    }
    if (!anyChanged) {
      console.log(`  ~ ${row.id}: no geocode hits`);
      continue;
    }
    if (dryRun) {
      console.log(
        `  [dry] ${row.id}: ${JSON.stringify(patchedLocs.map((l) => `${l.text}=${l.lat?.toFixed(2)},${l.lng?.toFixed(2)}`))}`
      );
      patched++;
      continue;
    }
    const { error: upErr } = await s
      .from("roles")
      .update({ locations: patchedLocs })
      .eq("id", row.id);
    if (upErr) {
      console.log(`  ✗ ${row.id}: ${upErr.message}`);
      continue;
    }
    console.log(`  ✓ ${row.id}: ${patchedLocs.map((l) => l.text).join(" | ")}`);
    patched++;
  }

  console.log(
    `\nPatched ${patched} row(s). ${stillNull} location(s) had no Nominatim match.`
  );
}

main().catch((e) => {
  console.error("regeocode failed:", e);
  process.exit(1);
});
