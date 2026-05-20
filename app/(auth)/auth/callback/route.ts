import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/inbox";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=Missing+code`);
  }

  // Vercel proxies through x-forwarded-host; outside dev, prefer that to
  // build the redirect URL so we redirect to the user-facing origin and
  // the auth cookies (set on this origin) get sent on the next request.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const isLocal = process.env.NODE_ENV === "development";
  const redirectBase = isLocal
    ? origin
    : forwardedHost
      ? `https://${forwardedHost}`
      : origin;

  // Build the response first, then create a Supabase client whose setAll
  // writes directly onto it. Guarantees the auth cookies end up in the
  // browser regardless of how Next.js handles cookies() across redirects.
  const response = NextResponse.redirect(`${redirectBase}${next}`);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return (
            request.headers
              .get("cookie")
              ?.split("; ")
              .map((c) => {
                const [name, ...rest] = c.split("=");
                return { name, value: rest.join("=") };
              })
              .filter((c) => c.name) ?? []
          );
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${redirectBase}/login?error=${encodeURIComponent(error.message)}`
    );
  }

  return response;
}
