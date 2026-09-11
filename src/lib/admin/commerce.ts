/**
 * Reading the commerce state as the administrator.
 *
 * The shapes, the guards and the mode list live in `commerce-model.ts`, which
 * the admin panel imports; this module is the half that talks to the database
 * and therefore cannot be imported from a client component.
 */
import { cache } from "react";

import { isAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";

import { COMMERCE_CLOSED, readCommerceState, type CommerceState } from "./commerce-model";

export * from "./commerce-model";

/**
 * Memoised per request, like every other admin reader. Asks `isAdmin()` first
 * so a collector's page load does not generate an `insufficient_privilege`;
 * the database refuses either way.
 */
export const fetchCommerceState = cache(async (): Promise<CommerceState> => {
  if (!(await isAdmin())) return COMMERCE_CLOSED;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_commerce_state");
  if (error) return COMMERCE_CLOSED;
  return readCommerceState(data);
});
