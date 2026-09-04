/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * A NEW client per request. Holding one at module scope would hand one
 * visitor's session to the next request that arrives.
 *
 * Whatever this client is used for, authentication questions go through
 * `supabase.auth.getUser()`. `getSession()` reads the cookie and believes it;
 * the cookie is attacker-controlled. See docs/AUTH.md, section 9.3.
 */
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies. The middleware refreshes
            // the session, so ignoring this is correct rather than merely safe.
          }
        },
      },
    },
  );
}
