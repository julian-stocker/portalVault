/**
 * What happens when somebody asks for one more — decided, not performed.
 *
 * Three surfaces add to the cart: the catalog card's price pill, the figure
 * page's offer panel, and the plus on /cart. The *sequence* they follow is
 * the same everywhere, and it is small enough to state as a function:
 *
 *   what would the line's total be?   `wantedQuantity`
 *   given the server's answer, then?  `decideAdd`
 *
 * Kept here, pure, rather than inside the React hook that calls it, because
 * this is the part with the rules in it — fail closed, and which of the four
 * messages the visitor sees. A hook cannot be run without a renderer, and
 * this product has no renderer in its tests; a pure function can be checked
 * directly, branch by branch. `use-add-to-cart.ts` is the glue that reads the
 * store, awaits the server and writes — it makes no decisions of its own.
 *
 * No storage, no React, no database.
 */
import type { CartToastMessage } from "@/lib/cart/toast";
import type { QuantityVerdict } from "@/lib/shop/quantity";
import type { OfferCondition } from "@/lib/shop/offer";

/** What the caller knows about the thing being added. */
export type AddArticle = {
  name: string;
  condition: OfferCondition;
  price: number;
};

/**
 * What the line's total would become.
 *
 * An absolute figure, because that is what the server can compare against
 * stock — "+1" would make the answer depend on a cart the server cannot see.
 */
export function wantedQuantity(existingQuantity: number): number {
  return existingQuantity + 1;
}

/**
 * The decision, given the server's verdict.
 *
 * `add` is true for exactly one verdict. Neither a refusal nor a failed check
 * ever grows the cart: an increase that could not be verified does not
 * happen, and pretending otherwise would be claiming stock nobody confirmed.
 *
 * The two refusals are different sentences on purpose — `denied` is an
 * answer, `unchecked` is the absence of one — and neither carries a number,
 * because `CartToastMessage` gives them nowhere to put one.
 */
export function decideAdd(
  verdict: QuantityVerdict,
  article: AddArticle,
  existingQuantity: number,
): { add: boolean; toast: CartToastMessage } {
  if (verdict === "unchecked") return { add: false, toast: { kind: "unchecked" } };
  if (verdict === "denied") return { add: false, toast: { kind: "denied" } };

  // An existing line grew; a line that was not there is new. That is the
  // store's own state, read before the add, not a second count.
  return existingQuantity > 0
    ? {
        add: true,
        toast: {
          kind: "increased",
          name: article.name,
          condition: article.condition,
          quantity: wantedQuantity(existingQuantity),
        },
      }
    : {
        add: true,
        toast: {
          kind: "added",
          name: article.name,
          condition: article.condition,
          price: article.price,
        },
      };
}
