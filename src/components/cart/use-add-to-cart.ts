/**
 * Putting one more of something in the cart — checked first (V11).
 *
 * Three places add to the cart: the catalog card's price pill, the figure
 * page's offer panel, and the plus on /cart. All three ask the same question
 * in the same order, so all three live here rather than in three copies that
 * could answer it differently:
 *
 *   1. what would this line's total become?      the cart store, read
 *   2. may it?                                    the server, asked
 *   3. add, or say why not                        the store and the toast
 *
 * THE SERVER IS ASKED ABOUT A TOTAL, NOT AN INCREMENT
 *
 * "+1" would make the answer depend on a cart the server cannot see. The
 * absolute figure the line would reach is the only thing that can be compared
 * against stock, so that is what is sent.
 *
 * DOUBLE TAPS
 *
 * One request per trigger at a time. `pending` is a ref, checked and set
 * synchronously before the first `await`, so two taps in the same frame
 * cannot both get past it — a `useState` guard would still be `false` for the
 * second when it read it. Each component instance holds its own, which is
 * what "this button is busy" means; two different figures stay independent.
 *
 * Between the answer and the local write, somebody else may buy the last one.
 * That is accepted in V11 (ADR-0043 addendum): a cart is not a reservation,
 * and a checkout will have to ask again, atomically. What is not accepted is
 * the same button firing twice on one tap.
 *
 * FAIL CLOSED
 *
 * Only `allowed` adds. `denied` and `unchecked` leave the cart exactly as it
 * was and say so — an increase that could not be verified never happens.
 */
"use client";

import { useCallback, useRef, useState } from "react";

import { useCart, type CartArticle } from "@/components/cart/use-cart";
import { getSnapshot } from "@/lib/cart/store";
import { decideAdd, wantedQuantity } from "@/lib/cart/add";
import { keyOf, lineKey } from "@/lib/cart/cart";
import { showCartToast } from "@/lib/cart/toast";
import { checkCartQuantity } from "@/lib/shop/quantity";

export function useAddToCart(): {
  /** Adds one, if the server allows it. Always reports what happened. */
  addOne: (article: CartArticle) => Promise<void>;
  /** True while a check is in flight. Disables the trigger that owns it. */
  pending: boolean;
} {
  const { add } = useCart();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);

  const addOne = useCallback(
    async (article: CartArticle) => {
      if (busy.current) return;
      busy.current = true;
      setPending(true);

      try {
        /*
         * Read the line before adding, so the confirmation can say which of
         * the two things happened — a new line, or an existing one that grew.
         * That is the store's own state, not a second count kept somewhere
         * else.
         */
        const key = lineKey(article.skyId, article.condition);
        // Read from the store at the moment of the tap, not from the render
        // this callback was created in: a cart that changed in another tab
        // since then is the cart the visitor actually has.
        const existing = getSnapshot().cart.find((line) => keyOf(line) === key);
        const held = existing?.quantity ?? 0;

        const verdict = await checkCartQuantity(
          article.skyId,
          article.condition,
          wantedQuantity(held),
        );

        // Every rule lives in `decideAdd`, which is pure and tested directly.
        const decision = decideAdd(verdict, article, held);
        if (decision.add) add(article);
        showCartToast(decision.toast);
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [add],
  );

  return { addOne, pending };
}
