"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createApplicationFromUrl } from "@/lib/capture/create-application";

function fail(message: string): never {
  redirect(`/applications/new?error=${encodeURIComponent(message)}`);
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

  const { applicationId } = await createApplicationFromUrl(supabase, user.id, {
    url,
    pastedJd,
    notes,
    triageState: "draft",
    source: "manual",
  });

  revalidatePath("/pipeline");
  revalidatePath("/inbox");
  redirect(`/app/${applicationId}`);
}
