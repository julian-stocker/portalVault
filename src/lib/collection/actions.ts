/**
 * Changing a collection.
 *
 * The mutation states the DESIRED END STATE rather than toggling (ADR-0027).
 * A toggle reads first and then flips, so two quick taps both read the same
 * starting point and write the same result. Saying "collected: true" is
 * identical however often it arrives — which is exactly what optimistic UI
 * needs.
 */
"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

const SKY_ID = /^SKY-[0-9]{4}$/;

/** Unique violation: the row is already there, which is the desired state. */
const UNIQUE_VIOLATION = "23505";

export type CollectResult = { ok: true } | { ok: false; reason: "auth" | "invalid" | "failed" };

export async function setCollected(skyId: string, collected: boolean): Promise<CollectResult> {
  if (!SKY_ID.test(skyId)) return { ok: false, reason: "invalid" };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  // The user id comes from the validated session, never from the client.
  if (!auth.user) return { ok: false, reason: "auth" };

  if (collected) {
    const { error } = await supabase
      .from("collection_items")
      .insert({ user_id: auth.user.id, sky_id: skyId, quantity: 1 });

    // INSERT rather than UPSERT on purpose: an upsert would reset quantity to
    // 1, so once V1.6 adds quantities a double tap would silently drop a
    // count of 5 back to 1. A duplicate simply means we are already done.
    if (error && error.code !== UNIQUE_VIOLATION) {
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
