/**
 * Changing a wishlist.
 *
 * THE MUTATION STATES THE DESIRED END STATE, it does not toggle (ADR-0027,
 * and the same reasoning as `setCollected`). A toggle reads first and then
 * flips, so two quick taps both read the same starting point and write the
 * same result. Saying "favorite: true" is identical however often it
 * arrives — which is exactly what optimistic UI needs, and what a double tap
 * on a small heart will produce.
 *
 * SIMPLER THAN THE COLLECTION, AND THE DIFFERENCE IS THE POINT. There is no
 * quantity, no note, no `update` — a favourite exists or it does not. The
 * table has no `update` policy and `authenticated` has no `update` right
 * (`0145`), so there is nothing here that could need one.
 */
"use server";

import { revalidatePath } from "next/cache";

import { isCollector } from "@/lib/auth/capabilities";
import { createClient } from "@/lib/supabase/server";

const SKY_ID = /^SKY-[0-9]{4}$/;

/** Unique violation: the row is already there, which is the desired state. */
const UNIQUE_VIOLATION = "23505";

export type FavoriteResult = { ok: true } | { ok: false; reason: "auth" | "invalid" | "failed" };

/**
 * Mark a figure as wanted, or take the mark back.
 *
 * @param skyId     The figure. A variant is its own SKY-ID and therefore its
 *   own favourite (ADR-0002) — nothing here has to know that.
 * @param favorite  The desired END STATE, not a flip.
 */
export async function setFavorite(skyId: string, favorite: boolean): Promise<FavoriteResult> {
  if (!SKY_ID.test(skyId)) return { ok: false, reason: "invalid" };

  /*
   * A wishlist belongs to a private collector (ADR-0078, ADR-0136). A
   * Business or an Admin account has none — the row policies refuse them
   * through `is_collector_account()`, and asking here turns a silent
   * zero-row write into an answer the interface can show.
   */
  if (!(await isCollector())) return { ok: false, reason: "auth" };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  // The user id comes from the validated session, never from the client.
  if (!auth.user) return { ok: false, reason: "auth" };

  if (favorite) {
    const { error } = await supabase
      .from("favorites")
      .insert({ user_id: auth.user.id, sky_id: skyId });

    /*
     * INSERT, and a duplicate is SUCCESS.
     *
     * `(user_id, sky_id)` is the primary key, so a second insert raises
     * 23505 — and 23505 here means "already favourited", which is precisely
     * the end state that was asked for. Reporting it as a failure would make
     * the heart flip back for a state that is correct.
     *
     * No `upsert`: there is no column to update, so an upsert would be a
     * write that writes nothing and hides the distinction above.
     */
    if (error && error.code !== UNIQUE_VIOLATION) return { ok: false, reason: "failed" };
  } else {
    const { error } = await supabase
      .from("favorites")
      .delete()
      .eq("user_id", auth.user.id)
      .eq("sky_id", skyId);

    // A delete that matched nothing is not an error either — the row is gone,
    // which is the end state.
    if (error) return { ok: false, reason: "failed" };
  }

  /*
   * The catalog reads cookies and is dynamic, so it refetches on its own.
   * `/favoriten` is what needs invalidating — the same division
   * `setCollected` makes for `/collection`.
   */
  revalidatePath("/favoriten");
  return { ok: true };
}
