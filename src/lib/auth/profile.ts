/**
 * The signed-in user's profile, asked for once per request.
 *
 * Every protected page needs it twice over: the layout checks that there is a
 * session at all, the page checks that a username has been chosen. Both used
 * to run the same two round trips — validate the token, then read the row —
 * so a single render of /collection spoke to Supabase four times before the
 * first byte left the server.
 *
 * `cache` is React's per-request memo, not a session cache: nothing is shared
 * between requests or between users, and the token is still validated on the
 * server for every request (docs/SECURITY.md).
 *
 * It lives here rather than in `actions.ts` because that module is
 * `"use server"`, where every export has to be a plain async function.
 */
import { cache } from "react";

import { currentUser } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";

export type Profile = { id: string; username: string | null };

export const currentProfile = cache(async (): Promise<Profile | null> => {
  const user = await currentUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username")
    .eq("id", user.id)
    .maybeSingle();

  // The signup trigger normally creates this row. If it is missing, the
  // onboarding page creates it through profiles_insert_own.
  return profile ?? { id: user.id, username: null };
});
