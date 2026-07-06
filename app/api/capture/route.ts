// POST /api/capture — shared-secret endpoint driven by iOS Shortcut
// (or any share-sheet forwarder). Accepts { url?, text? } and lands a
// role + application in the Inbox (triage_state='inbox') for later triage.
//
// Auth: X-Capture-Secret header matched constant-time against CAPTURE_SECRET.
// Owner: hard-wired to CAPTURE_USER_ID env var (single-user for now).
//
// Rate-limited to ~10 req/min per IP in-process (defense in depth; the
// secret is already high-entropy). Serverless cold starts reset the map.

import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { createApplicationFromUrl } from "@/lib/capture/create-application";
import { resolveCapture } from "@/lib/capture/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateBuckets = new Map<string, number[]>();

function verifySecret(provided: string | null): boolean {
  const expected = process.env.CAPTURE_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = (rateBuckets.get(key) ?? []).filter(
    (t) => t > now - RATE_LIMIT_WINDOW_MS
  );
  if (bucket.length >= RATE_LIMIT_MAX) {
    rateBuckets.set(key, bucket);
    return true;
  }
  bucket.push(now);
  rateBuckets.set(key, bucket);
  return false;
}

function clientKey(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function baseUrl(req: NextRequest): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (envUrl) return envUrl;
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

export async function POST(req: NextRequest) {
  if (!verifySecret(req.headers.get("x-capture-secret"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (isRateLimited(clientKey(req))) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  const userId = process.env.CAPTURE_USER_ID;
  if (!userId) {
    return NextResponse.json(
      { error: "CAPTURE_USER_ID not configured" },
      { status: 500 }
    );
  }

  let body: { url?: unknown; text?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const url =
    typeof body.url === "string" && body.url.trim() ? body.url.trim() : null;
  const text =
    typeof body.text === "string" && body.text.trim() ? body.text.trim() : null;
  if (!url && !text) {
    return NextResponse.json(
      { error: "provide 'url' or 'text'" },
      { status: 400 }
    );
  }

  const resolved = await resolveCapture({ url, text });
  if (!resolved.targetUrl && !resolved.extraContext) {
    return NextResponse.json(
      { error: "could not extract anything usable", note: resolved.note },
      { status: 422 }
    );
  }

  const supabase = createServiceClient();
  try {
    const result = await createApplicationFromUrl(supabase, userId, {
      url: resolved.targetUrl,
      pastedJd: resolved.extraContext,
      notes: text && text !== resolved.targetUrl ? `[captured] ${text}` : "",
      triageState: "inbox",
      source: "capture",
    });

    revalidatePath("/inbox");
    revalidatePath("/pipeline");

    return NextResponse.json({
      ok: true,
      applicationId: result.applicationId,
      company: result.company,
      title: result.title,
      thin: result.thin,
      overallConfidence: result.overallConfidence,
      resolveNote: resolved.note,
      detailUrl: `${baseUrl(req)}/app/${result.applicationId}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
