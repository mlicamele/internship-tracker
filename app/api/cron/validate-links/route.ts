// POST /api/cron/validate-links — nightly link validator.
//
// Auth: X-Cron-Secret header matched constant-time against LINK_CHECK_CRON_SECRET.
//
// Required env vars (set on Vercel):
//   LINK_CHECK_CRON_SECRET   — shared secret with the caller (GH Actions / Vercel cron)
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   — service role, bypasses RLS
//
// Timeout: Vercel free-tier hard cap is 60s. Cron caller runs nightly;
// probes are rate-limited to ~2/sec so a full ~75-role sweep runs in
// ~30s. Overflow (rare) rolls into next run — roles skipped this pass
// will still show as `unknown` or stale until re-probed tomorrow.

import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { runLinkValidation } from "@/lib/link-check/run-batch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WALL_CLOCK_BUDGET_MS = 50_000;
const STALE_DAYS = 3; // recheck any triage role older than 3 days

function verifySecret(provided: string | null): boolean {
  const expected = process.env.LINK_CHECK_CRON_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!verifySecret(req.headers.get("x-cron-secret"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  try {
    const summary = await runLinkValidation(supabase, {
      apply: true,
      staleDays: STALE_DAYS,
      wallClockBudgetMs: WALL_CLOCK_BUDGET_MS,
    });

    if (summary.transitions.length > 0) {
      revalidatePath("/inbox");
      revalidatePath("/pipeline");
    }

    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
