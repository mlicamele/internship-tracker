import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/inbox" className="font-semibold tracking-tight">
            InternshipTracker
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              href="/inbox"
              className="rounded-md px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              Inbox
            </Link>
            <Link
              href="/pipeline"
              className="rounded-md px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              Pipeline
            </Link>
            <form action="/auth/sign-out" method="post" className="ml-1">
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </nav>
        </div>
      </header>
      <main className="flex-1 mx-auto w-full max-w-5xl px-4 py-6">
        {children}
      </main>
    </div>
  );
}
