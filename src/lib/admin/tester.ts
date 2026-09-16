/**
 * Reading the tester state as the administrator.
 *
 * The shapes and the guards live in `tester-model.ts`, which the admin panel
 * imports; this module is the half that talks to the database and therefore
 * cannot be imported from a client component. Same split as
 * `commerce.ts` / `commerce-model.ts`.
 */
import { cache } from "react";

import { isAdmin } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";

import { NO_TESTERS, readTesterState, type TesterState } from "./tester-model";

export * from "./tester-model";

/**
 * Memoised per request, like every other admin reader. Asks `isAdmin()` first
 * so a collector's page load does not generate an `insufficient_privilege`;
 * the database refuses either way.
 */
export const fetchTesterState = cache(async (): Promise<TesterState> => {
  if (!(await isAdmin())) return NO_TESTERS;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_tester_state");
  if (error) return NO_TESTERS;
  return readTesterState(data);
});
