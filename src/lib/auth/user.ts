/**
 * The signed-in user, asked for once per request.
 *
 * `supabase.auth.getUser()` validates the token against the auth server, and
 * that is the right thing — a cookie alone proves nothing (docs/SECURITY.md).
 * But a single render of /collection used to ask three separate times: the
 * layout, the page's profile check and the collection query each opened their
 * own round trip to Supabase, one after the other, before any HTML could be
 * sent.
 *
 * React's `cache` makes the first call the only call **within one request**.
 * It is not a session cache and not shared between requests or users: two
 * visitors, two requests, two validations. The user cannot change halfway
 * through rendering one page, so there is nothing to be stale about.
 *
 * The middleware is deliberately not part of this — it runs before the render
 * and refreshes the cookies the render then reads.
 */
import { cache } from "react";
import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

export const currentUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user;
});
