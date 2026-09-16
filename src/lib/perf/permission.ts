/**
 * Whether this request's account may be measured (ADR-0072).
 *
 * Asked on the SERVER, in the layout, before the telemetry component exists.
 * That is what makes "off for normal users" structural rather than a flag: for
 * anybody without the permission the component is not rendered, so no listener
 * is attached, no timer runs and none of the client code is in the tree at all.
 *
 * Mirrors `isAdmin()` exactly — memoised per request, and a round trip only
 * when there is a session to ask about.
 */
import { cache } from "react";

import { currentUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

/** The permission that turns navigation telemetry on. Registered in `0036`. */
export const PERFORMANCE_TRACKING = "performance_tracking";

export const canTrackPerformance = cache(async (): Promise<boolean> => {
  // No session, no round trip: an anonymous request can hold no tester
  // permission, and the RPC would only confirm it at the cost of a query.
  if (!(await currentUser())) return false;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("has_tester_permission", {
    p_permission: PERFORMANCE_TRACKING,
  });
  // An error is not permission. A failing check denies, it never grants.
  if (error) return false;
  return data === true;
});

/**
 * Which deployment produced a measurement.
 *
 * Vercel sets `VERCEL_GIT_COMMIT_SHA` on the server, so before-and-after runs
 * are distinguishable without adding a `NEXT_PUBLIC_` variable and without any
 * secret leaving the server. Locally there is no deployment, and `dev` is the
 * honest answer — it groups every local run together, which is what they are.
 */
export function buildId(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (typeof sha === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(sha)) return sha.slice(0, 12);
  return "dev";
}
