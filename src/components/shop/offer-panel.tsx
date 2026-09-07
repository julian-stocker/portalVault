/**
 * The offer, on a figure's own page.
 *
 * The same rule as the card, with the room a detail page can afford: only
 * what can actually be bought is shown, and when nothing can, there is no
 * panel at all — no disabled button, no "Nicht auf Lager", no greyed-out
 * surface (V7). Sold-out and listing state are a question for a shop surface
 * of its own, later.
 *
 * Where the card compresses two buyable conditions into "ab 4,49 €" and asks
 * on press, this page has space to show both at once: loose and boxed are
 * different articles at different prices, and that is the same identity the
 * stock keeps (`sky_id + condition`) and the cart keeps — one rule, three
 * places (ADR-0037, ADR-0043).
 *
 * Nothing here reserves anything. Adding to the cart writes `localStorage`
 * and touches no table: stock is only committed when an order is, and there
 * are no orders in V1.
 */
"use client";

import { useAddToCart } from "@/components/cart/use-add-to-cart";
import { useCart } from "@/components/cart/use-cart";
import { CartCheckedGlyph, CartGlyph } from "@/components/shop/cart-glyph";
import { conditionLabel } from "@/components/shop/shop-action";
import { ACTION_SHOP } from "@/components/ui/action";
import { keyOf, lineKey } from "@/lib/cart/cart";
import { buyableOffers, type Offer } from "@/lib/shop/offer";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

function AddButton({
  offer,
  name,
  imageSrc,
}: {
  offer: Offer;
  name: string;
  imageSrc: string | null;
}) {
  const { cart } = useCart();
  const { addOne, pending } = useAddToCart();

  const key = lineKey(offer.skyId, offer.condition);
  const already = cart.some((line) => keyOf(line) === key && line.quantity > 0);
  const label = `${name} (${conditionLabel(offer.condition)})`;

  return (
    <button
      type="button"
      // Same rule as the catalog card (V10): the button never renames itself
      // — it always means the same thing — and the confirmation is the toast.
      // Since V11 the quantity is checked with the server first; the shared
      // hook does the reading, asking and confirming (ADR-0043 addendum).
      onClick={() =>
        void addOne({
          skyId: offer.skyId,
          condition: offer.condition,
          name,
          imageSrc,
          price: offer.price,
        })
      }
      disabled={pending}
      aria-label={
        already
          ? de.shop.addAnotherFor(label, formatPrice(offer.price))
          : de.shop.addToCartFor(label, formatPrice(offer.price))
      }
      className={`${ACTION_SHOP} gap-1.5 disabled:opacity-70`}
    >
      {already ? <CartCheckedGlyph /> : <CartGlyph />}
      {de.shop.addToCart}
    </button>
  );
}

export function OfferPanel({
  offers,
  name,
  imageSrc,
}: {
  offers: readonly Offer[];
  /** The figure's display name, stored with the cart line as its label. */
  name: string;
  /** Already resolved (ADR-0046): the cart stores what was on screen. */
  imageSrc: string | null;
}) {
  const buyable = buyableOffers(offers);
  if (buyable.length === 0) return null;

  return (
    <section
      aria-label={de.shop.offerHeading}
      className="flex flex-col gap-3 rounded-sky-md bg-accent-subtle/60 p-4 ring-1 ring-gold-line"
    >
      <h2 className="text-xs font-medium tracking-wide text-accent uppercase">
        {de.shop.offerHeading}
      </h2>

      <ul className="flex flex-col gap-3">
        {buyable.map((offer) => (
          <li
            key={offer.condition}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
          >
            <div className="flex min-w-0 flex-col">
              {/* Only worth naming when there is something to tell apart. */}
              {buyable.length > 1 ? (
                <span className="text-xs text-muted">{conditionLabel(offer.condition)}</span>
              ) : null}
              <span className="text-xl leading-tight font-semibold tabular-nums">
                {formatPrice(offer.price)}
              </span>
            </div>

            <AddButton offer={offer} name={name} imageSrc={imageSrc} />
          </li>
        ))}
      </ul>

      {/* Said once, here, where somebody is about to add something. */}
      <p className="text-[11px] leading-snug text-muted">{de.cart.localOnly}</p>
    </section>
  );
}
