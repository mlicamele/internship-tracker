"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { findOrCreate as findOrCreateCompany } from "@/lib/db/companies";
import { create as createRole } from "@/lib/db/roles";
import { createApplication } from "@/lib/db/applications";

export const runtime = "nodejs";

function fail(message: string): never {
  redirect(`/applications/new?error=${encodeURIComponent(message)}`);
}

/** Try to derive a company name from a URL hostname. Falls back to null. */
function companyFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    // job-boards.greenhouse.io/foo/jobs/xxx → 'foo'
    if (host.endsWith("greenhouse.io") || host.endsWith("lever.co") || host.endsWith("ashbyhq.com")) {
      const segments = u.pathname.split("/").filter(Boolean);
      if (segments.length > 0) {
        return segments[0]
          .replace(/[-_]/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
      }
    }
    // Otherwise: take the first label of the hostname (anthropic.com → 'anthropic')
    const label = host.split(".")[0];
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    return null;
  }
}

/**
 * Default target year: this summer if we're still before September,
 * else next year's summer (Aug onward → start aiming at next cycle).
 */
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
  const jdBody = String(formData.get("jd_body") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim();

  if (!url && !jdBody) {
    fail("Paste a URL or the job description body");
  }

  // Bundle 1: smart defaults. Bundle 2 will replace company-from-hostname with
  // real scrape output; Bundle 3 will replace 'unspecified' enums with Haiku output.
  const companyName =
    (url && companyFromUrl(url)) || "Unknown company";
  const roleTitle = "Untitled role";

  const company = await findOrCreateCompany(supabase, companyName);

  const role = await createRole(supabase, {
    companyId: company.id,
    title: roleTitle,
    jdUrl: url,
    jdBodyText: jdBody,
    targetYear: defaultTargetYear(),
    targetSeason: "summer",
    workModel: "unspecified",
    classYearTag: "unspecified",
    source: "manual",
  });

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
