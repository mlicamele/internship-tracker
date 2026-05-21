"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { findOrCreate as findOrCreateCompany } from "@/lib/db/companies";
import { create as createRole } from "@/lib/db/roles";
import { createApplication } from "@/lib/db/applications";
import { scrapeUrl } from "@/lib/scrape/url";
import { geocode } from "@/lib/geocode";

function fail(message: string): never {
  redirect(`/applications/new?error=${encodeURIComponent(message)}`);
}

/** Default target year: this summer if before Sept, else next summer. */
function defaultTargetYear(): number {
  const now = new Date();
  return now.getMonth() < 8 ? now.getFullYear() + 1 : now.getFullYear() + 2;
}

/** Last-resort fallback if even the LLM can't pull a company name. */
function companyFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (
      host.endsWith("greenhouse.io") ||
      host.endsWith("lever.co") ||
      host.endsWith("ashbyhq.com")
    ) {
      const segments = u.pathname.split("/").filter(Boolean);
      if (segments.length > 0) {
        return segments[0]
          .replace(/[-_]/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
      }
    }
    const label = host.split(".")[0];
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    return "Unknown company";
  }
}

export async function saveNewApplication(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const url = String(formData.get("url") ?? "").trim() || null;
  const pastedJd = String(formData.get("jd_body") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim();

  if (!url && !pastedJd) {
    fail("Paste a URL or the job description body");
  }

  // 1. Scrape + LLM extract (always returns a result; never throws)
  const extracted = url
    ? await scrapeUrl(url, pastedJd ?? undefined)
    : null;

  // 2. Apply fallbacks for anything still missing
  const companyName =
    extracted?.company?.trim() ||
    (url ? companyFromUrl(url) : "Unknown company");
  const roleTitle = extracted?.title?.trim() || "Untitled role";
  const jdBodyText = extracted?.jd_body || pastedJd || null;
  const jdUrl = url ?? null;
  const targetYear = extracted?.target_year ?? defaultTargetYear();

  // 3. Geocode each location (best-effort; null coords are OK)
  const locations: import("@/lib/db/types").RoleLocation[] = [];
  for (const loc of extracted?.locations ?? []) {
    const text = loc.text.trim();
    if (!text) continue;
    let lat: number | null = loc.lat ?? null;
    let lng: number | null = loc.lng ?? null;
    if (lat == null || lng == null) {
      try {
        const coords = await geocode(text);
        if (coords) {
          lat = coords.lat;
          lng = coords.lng;
        }
      } catch {
        // ignore
      }
    }
    locations.push({ text, lat, lng });
  }

  // 4. Find-or-create company
  const company = await findOrCreateCompany(supabase, companyName);

  // 5. Create role with frozen extraction snapshot for per-field revert later
  const extractionSnapshot = extracted
    ? {
        values: {
          company: extracted.company,
          title: extracted.title,
          locations: extracted.locations.map((l) => l.text),
          deadline_at: extracted.deadline_at,
          posted_at: extracted.posted_at,
          work_model: extracted.work_model,
          target_year: extracted.target_year,
          target_season: extracted.target_season,
          min_grad_year: extracted.min_grad_year,
          max_grad_year: extracted.max_grad_year,
          relocation_assistance: extracted.relocation_assistance,
          compensation_hourly_dollars: extracted.compensation_hourly_dollars,
        },
        confidences: extracted.confidences,
      }
    : { values: {}, confidences: {} };

  const role = await createRole(supabase, {
    companyId: company.id,
    title: roleTitle,
    locations,
    jdUrl,
    jdBodyText,
    deadlineAt: extracted?.deadline_at ?? null,
    postedAt: extracted?.posted_at ?? null,
    workModel: extracted?.work_model ?? null,
    targetYear,
    targetSeason: extracted?.target_season ?? "summer",
    compensationHourlyDollars: extracted?.compensation_hourly_dollars ?? null,
    minGradYear: extracted?.min_grad_year ?? null,
    maxGradYear: extracted?.max_grad_year ?? null,
    relocationAssistance: extracted?.relocation_assistance ?? null,
    extractionConfidences: extracted?.confidences ?? {},
    extractionSnapshot,
    source: "manual",
  });

  // 6. Create application in draft state; user confirms via Save on detail page
  const application = await createApplication(supabase, {
    userId: user.id,
    roleId: role.id,
    notes,
    triageState: "draft",
  });

  revalidatePath("/pipeline");
  revalidatePath("/inbox");
  redirect(`/app/${application.id}`);
}
