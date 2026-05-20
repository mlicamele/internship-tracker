"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function sendMagicLink(formData: FormData) {
  const email = formData.get("email");
  if (typeof email !== "string" || !email) {
    redirect("/login?error=Please+enter+a+valid+email");
  }

  const supabase = await createClient();
  const headerList = await headers();
  const origin =
    headerList.get("origin") ?? headerList.get("referer")?.split("/").slice(0, 3).join("/") ?? "http://localhost:3000";

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/login?sent=1");
}
