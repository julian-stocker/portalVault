/**
 * "May the cart hold this many?" — asked of the server, never of the browser.
 *
 * The cart is local (ADR-0043) and stays local: this adds no table, no
 * account and no reservation. What it adds is the one fact a browser cannot
 * know — whether SkyIsles actually has as many of something as somebody is
 * trying to put in a basket. Until V11 the answer was "as many as you like,
 * up to 99", which is a browser answering a question about a warehouse.
 *
 * A server action rather than a call from the browser, which is the pattern
 * this product already uses for anything that has to be decided server-side
 * (`collection/actions.ts`, `admin/actions.ts`). The function name, its
 * arguments and the shape of the row never reach the client bundle; what
 * crosses is one word.
 *
 * WHAT COMES BACK, AND WHAT DELIBERATELY DOES NOT
 *
 * Three outcomes and no number:
 *
 *   allowed    this quantity would be possible right now
 *   denied     it would not — for a reason the caller is not told
 *   unchecked  the question could not be put to the server at all
 *
 * `denied` is deliberately one word for every way of being no: sold out,
 * withdrawn, never listed, not a collectible, priced at nothing. Telling the
 * difference would be publishing the shop's internal state one boolean at a
 * time, and the visitor's next move is the same in every case.
 *
 * FAIL CLOSED
 *
 * A network failure, a missing function, an unreadable answer — all of them
 * are `unchecked`, and `unchecked` never increases a cart. Guessing "probably
 * fine" would be claiming stock nobody verified. Removing and lowering stay
 * local and are never gated on this: they can only ever make a cart smaller.
 *
 * NOTHING IS RESERVED
 *
 * `allowed` means "possible at this moment", not "held for you". Stock can
 * change between this answer and anything a checkout might later do, which is
 * why a checkout will have to ask again — atomically, and reserving for real.
 * That is not this function's job, and V11 has no checkout.
 */
"use server";

import { isOfferCondition, type OfferCondition } from "@/lib/shop/offer";
import { MAX_LINE_QUANTITY } from "@/lib/cart/cart";
import { createClient } from "@/lib/supabase/server";

const SKY_ID = /^SKY-[0-9]{4}$/;

/**
 * The whole public answer. A word, never a count.
 *
 * Typed as a union rather than a boolean plus an error flag so that "we do
 * not know" cannot be read as "no" by accident at a call site — the two lead
 * to different messages, and only one of them is the shop's fault.
 */
export type QuantityVerdict = "allowed" | "denied" | "unchecked";

/**
 * Would the cart be allowed to hold `quantity` of this article?
 *
 * @param quantity The **total** the line would reach, not the increment. The
 *   server compares an absolute figure against stock; sending "+1" would make
 *   the answer depend on a cart the server cannot see.
 */
export async function checkCartQuantity(
  skyId: string,
  condition: OfferCondition,
  quantity: number,
): Promise<QuantityVerdict> {
  // Refused here as well as in SQL. The database is the authority, but a
  // malformed request is not worth a round trip, and `denied` is the honest
  // answer for a quantity no cart line may hold.
  if (!SKY_ID.test(skyId)) return "denied";
  if (!isOfferCondition(condition)) return "denied";
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LINE_QUANTITY) {
    return "denied";
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("shop_quantity_available", {
      p_sky_id: skyId,
      p_condition: condition,
      p_quantity: quantity,
    });

    // Includes PGRST202, "no function by that name": an environment where
    // migration 0009 has not been applied cannot verify stock, so it must not
    // pretend to. Unlike `fetchOffers`, which may fall back to "no offers"
    // because that is a true and harmless state, there is no safe guess here.
    if (error) return "unchecked";

    // Anything that is not literally `true` is not a yes.
    return data === true ? "allowed" : "denied";
  } catch {
    return "unchecked";
  }
}
