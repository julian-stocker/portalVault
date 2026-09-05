/**
 * Changing a collection.
 *
 * The mutation states the DESIRED END STATE rather than toggling (ADR-0027).
 * A toggle reads first and then flips, so two quick taps both read the same
 * starting point and write the same result. Saying "collected: true" is
 * identical however often it arrives — which is exactly what optimistic UI
 * needs.
 *
 * The optional quantity is part of that end state, not an exception to it:
 * "collected, four of them" is just as idempotent as "collected".
 */
"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

const SKY_ID = /^SKY-[0-9]{4}$/;

/** Unique violation: the row is already there, which is the desired state. */
const UNIQUE_VIOLATION = "23505";

/** Matches the CHECK constraints on collection_items. */
const MAX_QUANTITY = 10000;

export type CollectResult = { ok: true } | { ok: false; reason: "auth" | "invalid" | "failed" };

/**
 * @param quantity  How many are owned. Omit to mean "at least one, and do not
 *   touch a count that is already there" — the catalog's meaning. Pass a
 *   number to state the count exactly, which is what undo needs: removing a
 *   row of four and adding it back has to bring back four, not one.
 */
export async function setCollected(
  skyId: string,
  collected: boolean,
  quantity?: number,
): Promise<CollectResult> {
  if (!SKY_ID.test(skyId)) return { ok: false, reason: "invalid" };
  if (
    quantity !== undefined &&
    (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY)
  ) {
    return { ok: false, reason: "invalid" };
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  // The user id comes from the validated session, never from the client.
  if (!auth.user) return { ok: false, reason: "auth" };

  if (collected) {
    const { error } = await supabase
      .from("collection_items")
      .insert({ user_id: auth.user.id, sky_id: skyId, quantity: quantity ?? 1 });

    // INSERT rather than UPSERT on purpose: an upsert would reset quantity to
    // 1, so a double tap in the catalog would silently drop a count of 5 back
    // to 1. A duplicate simply means we are already done.
    if (error && error.code === UNIQUE_VIOLATION) {
      // Unless the caller stated a count. Then the desired end state includes
      // that number, and a row that already exists has to be brought to it.
      if (quantity !== undefined) {
        const { error: updateError } = await supabase
          .from("collection_items")
          .update({ quantity })
          .eq("user_id", auth.user.id)
          .eq("sky_id", skyId);
        if (updateError) return { ok: false, reason: "failed" };
      }
    } else if (error) {
      return { ok: false, reason: "failed" };
    }
  } else {
    const { error } = await supabase
      .from("collection_items")
      .delete()
      .eq("user_id", auth.user.id)
      .eq("sky_id", skyId);

    if (error) return { ok: false, reason: "failed" };
  }

  // The catalog page reads cookies and is dynamic, so it refetches on its
  // own. The collection page is what needs invalidating.
  revalidatePath("/collection");
  return { ok: true };
}
