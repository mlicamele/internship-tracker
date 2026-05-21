"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { findOrCreate as findOrCreateCompany } from "@/lib/db/companies";
import { create as createRole } from "@/lib/db/roles";
import { createApplication } from "@/lib/db/applications";
import { scrapeUrl } from "@/lib/scrape/url";
import { extractAll } from "@/lib/scrape/extract";
import { classifyRole } from "@/lib/anthropic/classify";
import { geocode } from "@/lib/geocode";
import type { ClassYearTag, TargetSeason, WorkModel } from "@/lib/db/types";

function fail(message: string): never {
  redirect(`/applications/new?error=${encodeURIComponent(message)}`);
}

/** Derive a company name from a URL hostname as a last-resort fallback. */
function companyFromUrl(url: string): string | null {
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
    return null;
  }
}

/** Default target year: this summer if before Sept, else next summer. */
function defaultTargetYear(): number {
  const now = new Date();
  return now.getMonth() < 8 ? now.getFullYear() + 1 : now.getFullYear() + 2;
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

  // 1. Scrape URL if present (returns thin on failure, never throws)
  const scraped = url ? await scrapeUrl(url) : null;

  // 2. Decide which JD body to use for extractors: user-pasted wins over scraped
  const bodyForExtraction =
    pastedJd && pastedJd.length > 0
      ? pastedJd
      : scraped && !scraped.thin
        ? scraped.jd_body
        : "";

  // 3. Run extractors over whichever body we have (no-ops on empty string)
  const extracted = bodyForExtraction
    ? extractAll(bodyForExtraction)
    : {
        deadline_at: null,
        posted_at: null,
        work_model: "unspecified" as WorkModel,
        target_year: null,
        target_season: null as TargetSeason | null,
        compensation_text: null,
        compensation_hourly_cents: null,
      };

  // 4. Merge: prefer (scrape output) → (regex extractors) → defaults
  const companyName =
    (scraped?.company && scraped.company.trim()) ||
    (url && companyFromUrl(url)) ||
    "Unknown company";
  const roleTitle = scraped?.title?.trim() || "Untitled role";
  const locationText = scraped?.location?.trim() || null;
  const jdBodyText = pastedJd || scraped?.jd_body || null;
  const jdUrl = url ?? null;
  const deadlineAt = scraped?.deadline_at ?? extracted.deadline_at;
  const postedAt = scraped?.posted_at ?? extracted.posted_at;
  let workModel: WorkModel =
    scraped?.work_model && scraped.work_model !== "unspecified"
      ? scraped.work_model
      : extracted.work_model;
  let targetYear = scraped?.target_year ?? extracted.target_year;
  let targetSeason: TargetSeason =
    scraped?.target_season ?? extracted.target_season ?? "summer";
  const compensationText =
    scraped?.compensation_text ?? extracted.compensation_text;
  const compensationHourlyCents =
    scraped?.compensation_hourly_cents ?? extracted.compensation_hourly_cents;

  // 4.5 LLM classification (Bundle 3): fill in fields scrape+regex missed
  let classYearTag: ClassYearTag = "unspecified";
  let classYearConfidence: number | null = null;
  const needsClassify =
    bodyForExtraction.length >= 500 &&
    (workModel === "unspecified" || targetYear === null);
  // Always try class_year_tag since regex can't catch it; gate the rest
  if (bodyForExtraction.length >= 500) {
    const classification = await classifyRole({
      jd_body: bodyForExtraction,
      title: roleTitle,
    });
    if (
      classification.class_year_tag !== "unspecified" &&
      classification.confidence >= 0.5
    ) {
      classYearTag = classification.class_year_tag;
      classYearConfidence = classification.confidence;
    }
    if (needsClassify) {
      if (targetYear === null && classification.target_year !== null) {
        targetYear = classification.target_year;
        targetSeason = classification.target_season;
      }
      if (workModel === "unspecified" && classification.confidence >= 0.6) {
        workModel = classification.work_model;
      }
    }
  }

  // Final fallback for target year
  if (targetYear === null) {
    targetYear = defaultTargetYear();
  }

  // 5. Geocode location if present (best-effort)
  let roleLat: number | null = null;
  let roleLng: number | null = null;
  if (locationText) {
    try {
      const coords = await geocode(locationText);
      if (coords) {
        roleLat = coords.lat;
        roleLng = coords.lng;
      }
    } catch {
      // ignore
    }
  }

  // 6. Find-or-create company
  const company = await findOrCreateCompany(supabase, companyName);

  // 7. Create role
  const role = await createRole(supabase, {
    companyId: company.id,
    title: roleTitle,
    locationText,
    roleLat,
    roleLng,
    jdUrl,
    jdBodyText,
    deadlineAt,
    postedAt,
    workModel,
    targetYear,
    targetSeason,
    compensationText,
    compensationHourlyCents,
    classYearTag,
    classYearConfidence,
    source: "manual",
  });

  // 8. Create application
  const application = await createApplication(supabase, {
    userId: user.id,
    roleId: role.id,
    notes,
    triageState: "active",
  });

  revalidatePath("/pipeline");
  revalidatePath("/inbox");
  redirect(`/app/${application.id}`);
}
