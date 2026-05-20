import { sendMagicLink } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const params = await searchParams;
  const sent = params.sent === "1";
  const error = params.error;

  return (
    <main className="flex-1 flex items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-6">
        <header className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            InternshipTracker
          </h1>
          <p className="text-sm text-muted-foreground">
            Sign in with a magic link
          </p>
        </header>

        {sent ? (
          <div className="rounded-md border border-border bg-card p-4 text-sm text-card-foreground">
            Check your email for the magic link. It expires in an hour.
          </div>
        ) : (
          <form action={sendMagicLink} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </div>
            <Button type="submit" className="w-full">
              Send magic link
            </Button>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </form>
        )}
      </div>
    </main>
  );
}
