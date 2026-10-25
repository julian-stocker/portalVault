/**
 * Session refresh and route protection for the middleware.
 *
 * Two jobs, in this order:
 *   1. Refresh the access token and write the cookies back onto the response.
 *      Without this a session silently expires mid-visit.
 *   2. Send anonymous visitors away from protected routes.
 *
 * Step 2 is convenience, not security. Row level security is what actually
 * protects the data; a request that slips past this still cannot read a
 * stranger's rows (docs/SECURITY.md).
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { ONBOARDING_PATH, signInUrlFor } from "@/lib/auth/redirect";

/**
 * Routes that require a session.
 *
 * /dashboard is deliberately absent: it only redirects to /collection, so
 * letting it through first means an anonymous visitor ends up at
 * /login?next=/collection rather than being sent back to a path that no
 * longer exists.
 *
 * `/favoriten` KAM AM 2026-10-25 DAZU, und es fehlte vorher — ein Fehler.
 * Die Navigationsleiste bietet „Favoriten" einem ausgeloggten Besucher an,
 * genau wie „Sammlung" (`site-nav.tsx`: `viewer.collector` ist fuer eine
 * Sitzung ohne Konto wahr, weil ein Besucher kein privilegiertes Konto ist).
 * Ohne Eintrag hier lief der Klick in die Seite, dort antwortete
 * `isCollector()` mit `false` — und der Besucher bekam **404** auf einen
 * Punkt, den die Leiste ihm gerade gezeigt hatte.
 *
 * Jetzt bekommt er `/login?next=/favoriten` und kommt danach dorthin
 * zurueck, also dasselbe Verhalten wie bei der Sammlung. Gefunden ohne
 * Browser, beim Durchgehen dessen, was eine ausgeloggte Sitzung erreicht.
 */
const PROTECTED_PREFIXES = [
  "/collection", "/favoriten", "/account", "/settings", "/onboarding",
];

/** Routes a signed-in user has no reason to see. */
const SIGNED_OUT_ONLY_PREFIXES = ["/login", "/register", "/forgot-password"];

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Validated against the auth server, not merely read from the cookie.
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  const { pathname, search } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isSignedOutOnly = SIGNED_OUT_ONLY_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    const target = signInUrlFor(pathname, search);
    url.pathname = target.split("?")[0];
    url.search = target.includes("?") ? `?${target.split("?")[1]}` : "";
    return NextResponse.redirect(url);
  }

  if (user && isSignedOutOnly) {
    const url = request.nextUrl.clone();
    url.pathname = ONBOARDING_PATH;
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
