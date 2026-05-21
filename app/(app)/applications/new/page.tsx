import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NewApplicationForm } from "./_components/new-application-form";

export const dynamic = "force-dynamic";

export default async function NewApplicationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const defaultTargetYear = new Date().getFullYear() + 1;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <Link
          href="/pipeline"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Pipeline
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">New application</h1>
        <p className="text-sm text-muted-foreground">
          Capture everything now — easier than coming back later.
        </p>
      </header>

      <NewApplicationForm
        defaultTargetYear={defaultTargetYear}
        error={error}
      />
    </div>
  );
}
