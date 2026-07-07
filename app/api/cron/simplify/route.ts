// POST /api/cron/simplify — daily cron endpoint hit by GH Actions.
//
// Auth: X-Cron-Secret header matched constant-time against SIMPLIFY_CRON_SECRET.
// Owner of new applications: CRON_USER_ID env var (single-user for now).
//
// Required env vars (set on Vercel):
//   SIMPLIFY_CRON_SECRET   — shared secret with the GH Action
//   CRON_USER_ID           — Supabase user_id that owns seeded applications
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   — service role, bypasses RLS
//   GROQ_API_KEY           — for the LLM extraction step
//   NOMINATIM_USER_AGENT   — required by the geocoder
//
// Timeout: Vercel free-tier hard cap is 60s. We cap new-role extractions
// at MAX_NEW_PER_RUN and add a wall-clock budget so a slow batch doesn't
// blow the ceiling. Any overflow rolls into tomorrow's run. The seed script
// fills the day-1 backlog outside this constraint.

import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { ingestSimplifyListings } from "@/lib/simplify/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_NEW_PER_RUN = 8;
const WALL_CLOCK_BUDGET_MS = 45_000;

function verifySecret(provided: string | null): boolean {
  const expected = process.env.SIMPLIFY_CRON_SECRET;
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

  const userId = process.env.CRON_USER_ID;
  if (!userId) {
    return NextResponse.json(
      { error: "CRON_USER_ID not configured" },
      { status: 500 }
    );
  }

  const supabase = createServiceClient();

  try {
    const summary = await ingestSimplifyListings(supabase, userId, {
      maxNewExtractions: MAX_NEW_PER_RUN,
      concurrency: 3,
      wallClockBudgetMs: WALL_CLOCK_BUDGET_MS,
    });

    if (summary.new_applications > 0 || summary.updated_roles > 0) {
      revalidatePath("/inbox");
      revalidatePath("/pipeline");
    }

    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
