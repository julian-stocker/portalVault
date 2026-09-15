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
 * Nothing here reserves anything, and that has not changed — stock is
 * committed when an order is, never before (ADR-0050).
 *
 * WHERE THE BASKET GOES HAS changed. Until ADR-0061 this comment said "writes
 * localStorage and touches no table", and that a signed-in basket now lives
 * in `cart_items` is exactly what the notice below had to stop denying. A
 * guest still writes to `localStorage`; an account writes to the server.
 */
"use client";

import { useAddToCart } from "@/components/cart/use-add-to-cart";
import { useCart } from "@/components/cart/use-cart";
import { CartCheckedGlyph, CartGlyph } from "@/components/shop/cart-glyph";
import { conditionLabel } from "@/lib/shop/condition";
import { ACTION_COMMERCE_COMPACT, ACTION_SHOP, COMMERCE_SURFACE } from "@/components/ui/action";
import { keyOf, lineKey } from "@/lib/cart/cart";
import { v1BuyableOffers, type Offer } from "@/lib/shop/offer";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

/**
 * "In den Warenkorb" for exactly one article.
 *
 * Exported since IR-001 so the quick view can place it in its own layout
 * without a second copy of the rules around it — which line it belongs to,
 * whether one is already in the cart, and what the accessible name says. The
 * behaviour behind it is `useAddToCart` either way, so the two surfaces
 * cannot drift.
 */
export function OfferAddButton({
  offer,
  name,
  imageSrc,
  className = "",
  compact = false,
}: {
  offer: Offer;
  name: string;
  imageSrc: string | null;
  /** Layout from the caller — the pill's own look is not negotiable. */
  className?: string;
  /**
   * The quick view's variant (IR-001, V3.2).
   *
   * Smaller — only from `sm:` up, so a touch target never drops below 44 px —
   * and amber rather than silver. The offer row around it stays silver and
   * stays information; this is the one thing on it that starts a purchase,
   * and it is the only place the amber is used so far. The figure page's
   * panel keeps `ACTION_SHOP` until that surface is looked at in its own
   * right.
   */
  compact?: boolean;
}) {
  const { cart } = useCart();
  const { addOne, pending } = useAddToCart();

  const key = lineKey(offer.skyId, offer.condition);
  const already = cart.some((line) => keyOf(line) === key && line.quantity > 0);
  /*
   * WHAT THE SCREEN READER IS TOLD THIS BUTTON BUYS.
   *
   * The figure page names the condition, because its panel is the surface
   * where a condition could still become a choice. The quick view does not:
   * V1 sells loose and nothing else, so "(Lose)" distinguishes the offer from
   * nothing at all — it was removed from the visible row for that reason
   * (V1_CONDITION), and reading it aloud is the same redundancy with a
   * different output device.
   */
  const label = compact ? name : `${name} (${conditionLabel(offer.condition)})`;

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
      className={`${compact ? ACTION_COMMERCE_COMPACT : ACTION_SHOP} gap-1.5 disabled:opacity-70 ${className}`}
      /* The amber surface, carried rather than looked up — see
         `COMMERCE_SURFACE`. The figure page's silver button is untouched. */
      style={compact ? COMMERCE_SURFACE : undefined}
    >
      {already ? <CartCheckedGlyph /> : <CartGlyph />}
      {/*
       * THE PRICE IS THE LABEL, IN THE QUICK VIEW (V3.4).
       *
       * Amber already says "this buys something" and the glyph already says
       * "into the basket", so "In den Warenkorb" beside them was the third
       * telling of one fact — and the widest thing in a row that has to hold
       * a seller's name beside it on a phone.
       *
       * The row no longer prints the price separately; this carries it. One
       * price per offer, on the control that charges it.
       *
       * The figure page keeps the words: its button stands alone under a
       * heading, with no price beside it and no room pressure.
       *
       * `tabular-nums` so two offers under one another do not shift.
       */}
      {compact ? (
        <span className="tabular-nums">{formatPrice(offer.price)}</span>
      ) : (
        de.shop.addToCart
      )}
    </button>
  );
}

export function OfferPanel({
  offers,
  name,
  imageSrc,
  guest,
}: {
  offers: readonly Offer[];
  /** The figure's display name, stored with the cart line as its label. */
  name: string;
  /** Already resolved (ADR-0046): the cart stores what was on screen. */
  imageSrc: string | null;
  /**
   * Whether nobody is signed in. Handed down from the server rather than read
   * from `currentPrincipal()`: that value is a module variable set in an
   * effect, so during render it is still the guest default and never changes
   * again — a signed-in visitor would see the guest notice permanently.
   */
  guest: boolean;
}) {
  /* The V1 truth (V3.3): loose and in stock. A figure whose only listing is
     boxed shows no panel here either — the page must not offer what the
     catalog will not sell, and hiding it on one surface only is how Hex came
     to have a buy button the grid refused to lead to. */
  const buyable = v1BuyableOffers(offers);
  if (buyable.length === 0) return null;

  return (
    <section
      /*
       * The destination of every catalog card's trade row (V3.2):
       * `/skylanders/<slug>#angebote`. `scroll-mt` keeps the heading clear of
       * the sticky header when the browser jumps here.
       */
      id="angebote"
      aria-label={de.shop.offerHeading}
      className="flex scroll-mt-24 flex-col gap-3 rounded-sky-md bg-surface/60 p-4 ring-1 ring-trade-line"
    >
      <h2 className="text-xs font-medium tracking-wide text-trade-solid uppercase">
        {de.shop.offerHeading}
      </h2>

      {/*
       * THE SELLER LINE BELONGS HERE AND CANNOT BE BUILT YET.
       *
       * `yulez.collectibles · Gewerblicher Verkäufer` is the one thing this
       * section still owes. The name lives in `sellers`, and every read path
       * to it is closed to a visitor: `active_seller()` is revoked from
       * `anon` and `authenticated` (0026), and `admin_seller()` is gated on
       * `is_shop_admin()`. The web app never holds a service-role key
       * (ADR-0051), so the server component cannot reach it either.
       *
       * It needs one granted projection — a `seller_public()` that names its
       * columns literally, the same shape `platform_settings_public()` has —
       * and that is a migration. Deliberately not faked with a constant in
       * i18n: two sources of truth for a trade name is exactly what ADR-0059
       * forbids, and the migration already carries the value.
       */}

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

            <OfferAddButton offer={offer} name={name} imageSrc={imageSrc} />
          </li>
        ))}
      </ul>

      {/* GUESTS ONLY (ADR-0061). A signed-in basket lives in `cart_items`
          and follows the account across devices, so the old unconditional
          sentence told exactly the people who had solved this problem that
          they still had it. Decided on the server, so the right answer is in
          the first paint — a client-side read would flash the wrong one. */}
      {guest ? (
        <p className="text-[11px] leading-snug text-muted">
          {de.cart.guestOnly} {de.cart.guestOnlyHint}
        </p>
      ) : null}
    </section>
  );
}
