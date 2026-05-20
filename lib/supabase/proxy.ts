import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/auth"];
const ONBOARD_PATH = "/onboard";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));
  const isOnboard = path.startsWith(ONBOARD_PATH);

  // Helper: build a redirect that preserves any refreshed-session cookies
  // that Supabase wrote onto supabaseResponse during getUser() above.
  // Without this, every redirect-from-middleware silently drops the
  // refreshed access token and the next request 401s → reload-loop.
  const redirectTo = (pathname: string): NextResponse => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    const response = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie);
    });
    return response;
  };

  // Unauthenticated → /login (except public paths)
  if (!user && !isPublic) {
    return redirectTo("/login");
  }

  // Onboarding gate — single profile read decides both redirect cases
  if (user && !isPublic) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("onboarding_completed_at")
      .eq("user_id", user.id)
      .maybeSingle();

    const onboardingDone = Boolean(profile?.onboarding_completed_at);

    // Mid-onboarding user trying to use the app → bounce to /onboard
    if (!onboardingDone && !isOnboard) {
      return redirectTo("/onboard");
    }

    // Already-onboarded user hitting /onboard → bounce to /inbox
    if (onboardingDone && isOnboard) {
      return redirectTo("/inbox");
    }
  }

  return supabaseResponse;
}
