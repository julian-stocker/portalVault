/**
 * Buying, on a catalog card.
 *
 * V7 moved the shop off the market-price line and down into the card's action
 * row; V9 made it small. A full-width gold button was the loudest thing on a
 * card that is meant to be a display piece, and it made a card you can buy
 * structurally different from one you cannot. The two facts it separates are
 * still these:
 *
 *   market price   neutral information about the object — what it is worth
 *   shop offer     an action — what SkyIsles will sell you one for
 *
 * So the price stays where information lives, and this is a button where
 * actions live. It no longer says "SkyIsles 4,49 €" either: the brand is the
 * website, and the word was doing nothing the context did not already do.
 *
 * NOTHING IS SHOWN WHEN NOTHING CAN BE BOUGHT
 *
 * No disabled button, no "Nicht auf Lager", no greyed-out surface. The
 * collector catalog is a catalog of objects, not a shelf with gaps in it, and
 * most of the 561 figures are not stocked. Sold-out and listing state are a
 * question for a shop surface of its own, later.
 *
 * ONE PRICE, OR A CHOICE
 *
 * One buyable condition — or two at the same price — adds in one tap. Two at
 * different prices show "ab 4,49 €" and open a small panel inside the card,
 * because the cart's identity is `sky_id + condition` (ADR-0043) and guessing
 * which one somebody meant would put the wrong article in their basket.
 *
 * It is a sibling of the card body, never a child: nothing here can toggle a
 * collection or open a detail page, and no event has to be stopped from
 * bubbling to make that true.
 */
"use client";

import { useState } from "react";

import { CartCheckedGlyph, CartGlyph } from "@/components/shop/cart-glyph";
import { useAddToCart } from "@/components/cart/use-add-to-cart";
import { useCart } from "@/components/cart/use-cart";
import { keyOf, lineKey } from "@/lib/cart/cart";
import { buyableOffers, summarizeOffers, type Offer, type OfferCondition } from "@/lib/shop/offer";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

/** German for the two conditions. Shared with the figure page's panel. */
export function conditionLabel(condition: OfferCondition): string {
  return condition === "boxed" ? de.shop.conditionBoxed : de.shop.conditionLoose;
}

/**
 * A compact gold pill, not a bar (V9).
 *
 * `--accent` with `--on-accent` ink: the tokens the product already uses for
 * its one warm action colour, so nothing new is invented and the button
 * belongs to the same family as the collection frame and the header badge.
 *
 * 40 px tall and only as wide as its content — a real touch target that
 * leaves the card a card. It carries a cart glyph and a price and no word:
 * "Kaufen", "Shop" or the brand name would all repeat what the context
 * already says.
 */
const BUY =
  "inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full px-3 " +
  "text-on-accent text-[13px] font-semibold tabular-nums " +
  "transition-colors disabled:opacity-70";

/** Nothing of this figure in the cart. The pill as V9 designed it. */
const BUY_IDLE = "bg-accent shadow-card hover:bg-accent-hover";

/**
 * Already in the cart (V11): the same pill, in a brighter gold.
 *
 * `--accent-hover` is the accent's own lighter tone and `--gold-line-strong`
 * its stronger line — both already in the palette, so the state is louder
 * without a new colour entering the product. `shadow-gold` is the gold glow
 * the collection frame uses, which is what makes it read across a grid.
 *
 * Height, padding and radius are untouched, so a marked card is exactly as
 * tall as an unmarked one: the ring and the shadow are painted, not laid out
 * (V9.1 geometry).
 */
const BUY_IN_CART =
  "bg-accent-hover ring-1 ring-gold-line-strong shadow-gold hover:bg-accent-hover";

export function ShopAction({
  offers,
  skyId,
  name,
  imageSrc,
}: {
  offers: readonly Offer[];
  skyId: string;
  name: string;
  /** Already resolved (ADR-0046); stored with the cart line. */
  imageSrc: string | null;
}) {
  const { cart } = useCart();
  const { addOne, pending } = useAddToCart();
  const [choosing, setChoosing] = useState(false);

  const summary = summarizeOffers(offers);
  if (summary.kind === "none") return null;

  const buyable = buyableOffers(offers);

  /** Is this exact article — figure and condition — in the cart? */
  function inCart(condition: OfferCondition): boolean {
    const key = lineKey(skyId, condition);
    return cart.some((line) => keyOf(line) === key && line.quantity > 0);
  }

  /**
   * Is anything of this figure in the cart?
   *
   * Any buyable condition marks the closed pill (V11). The pill stands for
   * the figure — when it says "ab 4,49 €" it is not speaking about one
   * condition — so "you already have one of these" is the honest reading, and
   * the chooser below says which. Only conditions that can still be bought
   * count: a mark driven by a line that is sold out would point at a button
   * that cannot act on it.
   */
  const anyInCart = buyable.some((offer) => inCart(offer.condition));

  /**
   * Adds one, once the server has agreed (V11).
   *
   * The whole sequence — read the line, ask, add, confirm or refuse — lives
   * in `useAddToCart`, shared with the figure page and the cart's own plus,
   * so the three cannot disagree about what is allowed.
   */
  async function put(offer: Offer) {
    setChoosing(false);
    await addOne({ skyId, condition: offer.condition, name, imageSrc, price: offer.price });
  }

  if (choosing) {
    /*
     * A panel over the footer, not a row inside it (V9.1).
     *
     * The closed state is a pill at the right end of a row it shares with
     * the Info link. Opening it in flow would either squeeze that link or
     * make the card taller than its neighbours — so it lifts out instead,
     * anchored to the footer's bottom edge, and the card's geometry does not
     * move at all. `bg-card` because it has to be readable over the picture
     * it covers.
     */
    return (
      <div
        className={
          "absolute inset-x-0 bottom-0 z-10 flex flex-col gap-1.5 rounded-sky-md " +
          "bg-card p-1.5 shadow-raised ring-1 ring-card-border"
        }
      >
        <p className="px-1 text-[11px] leading-tight text-on-card-muted">
          {de.shop.chooseCondition}
        </p>
        {buyable.map((offer) => {
          // Per condition here, because this is where the two are told apart.
          const already = inCart(offer.condition);
          const label = `${name} (${conditionLabel(offer.condition)})`;
          return (
            <button
              key={offer.condition}
              type="button"
              onClick={() => put(offer)}
              disabled={pending}
              aria-label={
                already
                  ? de.shop.addAnotherFor(label, formatPrice(offer.price))
                  : de.shop.addToCartFor(label, formatPrice(offer.price))
              }
              className={`${BUY} ${already ? BUY_IN_CART : BUY_IDLE} w-full justify-between`}
            >
              <span className="font-medium">{conditionLabel(offer.condition)}</span>
              <span className="flex items-center gap-1.5">
                {formatPrice(offer.price)}
                {already ? <CartCheckedGlyph /> : <CartGlyph />}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  // One price to pay: straight into the cart, no intermediate step.
  if (summary.kind === "single") {
    const offer = buyable.find((o) => o.price === summary.price) ?? buyable[0];
    return (
      <button
        type="button"
        onClick={() => put(offer)}
        disabled={pending}
        aria-label={
          anyInCart
            ? de.shop.addAnotherFor(name, formatPrice(summary.price))
            : de.shop.addToCartFor(name, formatPrice(summary.price))
        }
        className={`${BUY} ${anyInCart ? BUY_IN_CART : BUY_IDLE}`}
      >
        {/* The glyph changes, the price does not, and the button still adds. */}
        {anyInCart ? <CartCheckedGlyph /> : <CartGlyph />}
        {formatPrice(summary.price)}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setChoosing(true)}
      aria-label={de.shop.chooseConditionFor(name)}
      aria-expanded={false}
      className={`${BUY} ${anyInCart ? BUY_IN_CART : BUY_IDLE}`}
    >
      {anyInCart ? <CartCheckedGlyph /> : <CartGlyph />}
      {de.shop.offerFrom(formatPrice(summary.price))}
    </button>
  );
}
