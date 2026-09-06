/**
 * The offer, on a figure's own page.
 *
 * Where the catalog card states one number, this is where the choice is made:
 * loose and boxed are different articles at different prices, so each gets
 * its own line and its own button. That is the same identity the stock keeps
 * (`sky_id + condition`) and the same one the cart keeps — one rule, three
 * places (ADR-0037, ADR-0043).
 *
 * Renders nothing at all when SkyIsles does not carry the figure. Most of the
 * catalog is in that state, and "nicht im Angebot" on 500 pages is a sentence
 * that never tells anyone anything.
 *
 * Nothing here reserves anything. Adding to the cart writes `localStorage`
 * and touches no table: the stock is only committed when an order is, and
 * there are no orders in V1.
 */
"use client";

import { useState } from "react";

import { useCart } from "@/components/cart/use-cart";
import { ACTION_SHOP } from "@/components/ui/action";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import { sortOffers, type Offer, type OfferCondition } from "@/lib/shop/offer";

export function conditionLabel(condition: OfferCondition): string {
  return condition === "boxed" ? de.shop.conditionBoxed : de.shop.conditionLoose;
}

function AddButton({
  offer,
  name,
  imageFile,
}: {
  offer: Offer;
  name: string;
  imageFile: string | null;
}) {
  const { add } = useCart();
  // Purely a confirmation that the tap was heard. It says nothing about the
  // cart's contents, so it cannot go stale or contradict them.
  const [added, setAdded] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        add({ skyId: offer.skyId, condition: offer.condition, name, imageFile, price: offer.price });
        setAdded(true);
        window.setTimeout(() => setAdded(false), 1800);
      }}
      aria-label={de.shop.addToCartFor(`${name} (${conditionLabel(offer.condition)})`)}
      className={ACTION_SHOP}
    >
      {added ? de.shop.inCart : de.shop.addToCart}
    </button>
  );
}

export function OfferPanel({
  offers,
  name,
  imageFile,
}: {
  offers: readonly Offer[];
  /** The figure's display name, stored with the cart line as its label. */
  name: string;
  imageFile: string | null;
}) {
  if (offers.length === 0) return null;

  return (
    <section
      aria-label={de.shop.offerHeading}
      className="flex flex-col gap-3 rounded-sky-md bg-accent-subtle/60 p-4 ring-1 ring-gold-line"
    >
      <h2 className="text-xs font-medium tracking-wide text-accent uppercase">
        {de.shop.offerHeading}
      </h2>

      <ul className="flex flex-col gap-3">
        {sortOffers(offers).map((offer) => (
          <li
            key={offer.condition}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
          >
            <div className="flex min-w-0 flex-col">
              <span className="text-xs text-muted">{conditionLabel(offer.condition)}</span>
              <span className="text-xl leading-tight font-semibold tabular-nums">
                {formatPrice(offer.price)}
              </span>
            </div>

            {offer.available ? (
              <AddButton offer={offer} name={name} imageFile={imageFile} />
            ) : (
              /* Listed but out of stock. The line stays, because "SkyIsles
                 has this" is worth knowing even today (migration 0006). */
              <span className="text-sm text-muted">{de.shop.soldOut}</span>
            )}
          </li>
        ))}
      </ul>

      {/* Said once, here, where somebody is about to add something. */}
      <p className="text-[11px] leading-snug text-muted">{de.cart.localOnly}</p>
    </section>
  );
}
