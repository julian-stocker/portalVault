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

import { CartGlyph } from "@/components/shop/cart-glyph";
import { useCart } from "@/components/cart/use-cart";
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
  "bg-accent text-on-accent text-[13px] font-semibold tabular-nums " +
  "shadow-card transition-colors hover:bg-accent-hover";

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
  const { add } = useCart();
  const [choosing, setChoosing] = useState(false);
  const [added, setAdded] = useState(false);

  const summary = summarizeOffers(offers);
  if (summary.kind === "none") return null;

  const buyable = buyableOffers(offers);

  function put(offer: Offer) {
    add({ skyId, condition: offer.condition, name, imageSrc, price: offer.price });
    setChoosing(false);
    // Confirmation that the tap was heard, and nothing more: it says nothing
    // about the cart's contents, so it cannot go stale.
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1600);
  }

  if (choosing) {
    // Open, this grows the row. That is allowed: what has to match across
    // cards is the resting state, and every card's resting state is one
    // 40 px row (V9).
    return (
      <div className="flex w-full flex-col gap-1.5">
        <p className="px-1 text-right text-[11px] leading-tight text-on-card-muted">
          {de.shop.chooseCondition}
        </p>
        {buyable.map((offer) => (
          <button
            key={offer.condition}
            type="button"
            onClick={() => put(offer)}
            aria-label={de.shop.addToCartFor(
              `${name} (${conditionLabel(offer.condition)})`,
              formatPrice(offer.price),
            )}
            className={`${BUY} w-full justify-between`}
          >
            <span className="font-medium">{conditionLabel(offer.condition)}</span>
            <span className="flex items-center gap-1.5">
              {formatPrice(offer.price)}
              <CartGlyph />
            </span>
          </button>
        ))}
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
        aria-label={de.shop.addToCartFor(name, formatPrice(summary.price))}
        className={BUY}
      >
        <CartGlyph />
        {added ? de.shop.inCart : formatPrice(summary.price)}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setChoosing(true)}
      aria-label={de.shop.chooseConditionFor(name)}
      aria-expanded={false}
      className={BUY}
    >
      <CartGlyph />
      {de.shop.offerFrom(formatPrice(summary.price))}
    </button>
  );
}
