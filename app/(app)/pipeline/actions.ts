"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { transitionStatus } from "@/lib/db/applications";
import type { ApplicationStatus } from "@/lib/db/types";

export async function transitionStatusAction(
  applicationId: string,
  toStatus: ApplicationStatus
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await transitionStatus(supabase, applicationId, toStatus);

  revalidatePath("/pipeline");
  revalidatePath("/inbox");
  revalidatePath("/archive");
  revalidatePath(`/app/${applicationId}`);
}
