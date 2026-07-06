import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api (route handlers do their own auth — the session cookie
     *   redirect would otherwise 307 things like /api/capture that
     *   authenticate via a shared secret)
     * - _next/static (Next.js static files)
     * - _next/image (Next.js image optimization)
     * - favicon.ico
     * - any file ending with an image extension
     */
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
