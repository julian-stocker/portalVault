/**
 * Is the current request an administrator?
 *
 * One adapter over one database predicate. The predicate is
 * `public.is_shop_admin()` from migration `0003` — and despite its name it is
 * **the general SkyIsles administrator check today**, not a shop-only one
 * (ADR-0039). The name stayed because three shop functions already depend on
 * it and renaming the only finished security mechanism to read better would
 * be risk without gain. This function is where a future rename or a real role
 * model arrives, so callers never need to know either way.
 *
 * Two properties matter:
 *
 * 1. **The answer comes from the database, over the caller's own session.**
 *    Never from a claim the browser sent, never from a cookie the app wrote,
 *    never from component state. `is_shop_admin()` reads `auth.uid()` inside
 *    Postgres and consults a table no client can read or write.
 *
 * 2. **It is a convenience, not the boundary.** Hiding a link or answering
 *    404 is presentation. The boundary is that every editorial write goes
 *    through a `security definer` function that asks the same predicate again
 *    (migration `0004`), so a request that bypasses the UI entirely still
 *    fails in the database.
 *
 * Memoised per request like `currentUser`: a page and its layout both ask.
 */
import { cache } from "react";

import { currentUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

export const isAdmin = cache(async (): Promise<boolean> => {
  // No session, no round trip: an anonymous request can never be an admin,
  // and the RPC would only confirm it at the cost of a query.
  if (!(await currentUser())) return false;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_shop_admin");
  // An error is not permission. A failing check denies, it never grants.
  if (error) return false;
  return data === true;
});
