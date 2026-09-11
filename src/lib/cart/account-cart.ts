/**
 * The basket of a signed-in account.
 *
 * `cart_items` under RLS, exactly the shape `collection_items` has had since
 * 0001. That is the whole reason this exists rather than a better-named
 * `localStorage` key: a key hides one account's basket from another, a policy
 * makes it unreachable (ADR-0061).
 *
 * WHAT THE SERVER STORES AND WHAT IT DOES NOT
 *
 * Identity (`sky_id` + `condition`), quantity, and the price at the moment of
 * adding. **Not** the name and not the picture: those are decided by the
 * catalog today, not by what it said when the line went in, and re-reading
 * them is how the rule "the server data wins" (ADR-0043) stays true across
 * devices. The stored price is still only ever used to say "the price has
 * changed".
 *
 * Nothing here reserves anything. A basket is an intention; `create_order()`
 * is the only thing that turns one into a hold.
 */
"use server";

import { imageSrc } from "@/lib/catalog/image";
import { MAX_LINE_QUANTITY, type Cart, type CartLine } from "@/lib/cart/cart";
import type { OfferCondition } from "@/lib/shop/offer";
import { createClient } from "@/lib/supabase/server";

type Row = {
  sky_id: string;
  condition: string;
  quantity: number;
  price_at_add: string | number | null;
  skylanders: {
    name: string | null;
    display_name_override: string | null;
    image_file: string | null;
    image_override_path: string | null;
  } | null;
};

const SELECT =
  "sky_id, condition, quantity, price_at_add," +
  "skylanders(name, display_name_override, image_file, image_override_path)";

function toLine(row: Row): CartLine | null {
  if (row.condition !== "loose" && row.condition !== "boxed") return null;
  const quantity = Math.min(Math.max(Math.trunc(row.quantity), 1), MAX_LINE_QUANTITY);
  const figure = row.skylanders;
  const price = row.price_at_add === null ? 0 : Number(row.price_at_add);

  return {
    skyId: row.sky_id,
    condition: row.condition as OfferCondition,
    quantity,
    // The editorial override wins, as everywhere else it is read.
    name: figure?.display_name_override ?? figure?.name ?? row.sky_id,
    imageSrc: imageSrc({
      imageFile: figure?.image_file ?? null,
      imageOverridePath: figure?.image_override_path ?? null,
    }),
    priceAtAdd: Number.isFinite(price) ? price : 0,
  };
}

/**
 * The account's basket. An empty array for a guest, a failure, or an empty
 * basket — all three mean the same thing on screen, and none of them is worth
 * an error state in a shop.
 */
export async function loadAccountCart(): Promise<Cart> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];

  const { data, error } = await supabase
    .from("cart_items")
    .select(SELECT)
    .order("added_at", { ascending: true });
  if (error || !data) return [];

  return (data as unknown as Row[]).flatMap((row) => {
    const line = toLine(row);
    return line ? [line] : [];
  });
}

/**
 * Write one line, or remove it when the quantity reaches zero.
 *
 * A whole-basket replace would be the simpler API and the wrong one: two tabs
 * would overwrite each other's additions instead of both surviving. One line
 * at a time is also what the table is keyed for.
 */
export async function saveAccountLine(
  skyId: string,
  condition: string,
  quantity: number,
  priceAtAdd: number | null,
): Promise<void> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return;
  if (condition !== "loose" && condition !== "boxed") return;

  const wanted = Math.trunc(quantity);

  if (wanted < 1) {
    await supabase
      .from("cart_items")
      .delete()
      .eq("user_id", auth.user.id)
      .eq("sky_id", skyId)
      .eq("condition", condition);
    return;
  }

  await supabase.from("cart_items").upsert(
    {
      user_id: auth.user.id,
      sky_id: skyId,
      condition,
      quantity: Math.min(wanted, MAX_LINE_QUANTITY),
      price_at_add: priceAtAdd !== null && priceAtAdd > 0 ? priceAtAdd : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,sky_id,condition" },
  );
}

/** Empties it. Called when an order is placed, exactly as the local one is. */
export async function clearAccountCart(): Promise<void> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return;
  await supabase.from("cart_items").delete().eq("user_id", auth.user.id);
}

/**
 * Fold a guest basket into the account's, once, at sign-in.
 *
 * The rule lives in `merge_guest_cart()` rather than here: quantities sum and
 * the sum is capped by the same `max_cart_quantity()` the checkout enforces,
 * and doing that in SQL means two tabs signing in at once cannot race to a
 * wrong number.
 */
export async function mergeGuestCart(lines: Cart): Promise<Cart> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];

  if (lines.length > 0) {
    await supabase.rpc("merge_guest_cart", {
      p_lines: lines.map((line) => ({
        sky_id: line.skyId,
        condition: line.condition,
        quantity: line.quantity,
        price_at_add: line.priceAtAdd > 0 ? line.priceAtAdd : null,
      })),
    });
  }

  return loadAccountCart();
}
