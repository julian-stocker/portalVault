/**
 * The cart page.
 *
 * The contents come from the browser, the money comes from the server, and
 * the two meet in `resolveCart` (ADR-0043):
 *
 *   what is in it      localStorage — survives a reload, needs no account
 *   what it costs      shop_offers() — the price and availability of today
 *
 * A stored price is never spent. If an offer has moved since a line was
 * added, the current price is what is shown and summed, and the old one is
 * mentioned so the change is not silent.
 *
 * Nothing is ever removed from the screen on the visitor's behalf. A line
 * that is sold out, or that SkyIsles no longer carries, stays visible with a
 * reason and drops out of the total. A cart that quietly deleted what
 * somebody chose would be a cart that lies about what they chose.
 *
 * There is no checkout, and this page does not pretend there is one. Nothing
 * here reserves stock, writes a table or books a movement.
 */
"use client";

import Link from "next/link";

import { useCart } from "@/components/cart/use-cart";
import { FigureImage } from "@/components/catalog/figure-image";
import { conditionLabel } from "@/components/shop/offer-panel";
import { ACTION_NEUTRAL } from "@/components/ui/action";
import {
  cartTotal,
  keyOf,
  MAX_LINE_QUANTITY,
  resolveCart,
  unavailableEntries,
  type CartEntry,
} from "@/lib/cart/cart";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import { offerIndex, type Offer } from "@/lib/shop/offer";

/**
 * A ground of its own (ADR-0038, V3.3).
 *
 * `/cart` is a short page, so all of it lands inside the upper world — and
 * the brightest part of that artwork, the portal, sits exactly in the middle
 * of a centred column. A translucent panel there is unreadable. Same
 * treatment as the figure page's info column.
 */
const PANEL = "rounded-sky-lg bg-deep/90 ring-1 backdrop-blur-sm";

function QuantityField({ entry }: { entry: CartEntry }) {
  const { setQuantity } = useCart();
  const key = keyOf(entry.line);
  const id = `cart-quantity-${key.replace("/", "-")}`;

  return (
    <>
      <label className="sr-only" htmlFor={id}>
        {de.cart.quantityFor(entry.line.name)}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        max={MAX_LINE_QUANTITY}
        value={entry.line.quantity}
        onChange={(event) => setQuantity(key, Number(event.target.value))}
        className={
          "min-h-11 w-16 rounded-sky-md bg-surface-raised px-2 text-center text-sm " +
          "ring-1 ring-border-strong tabular-nums focus:ring-accent"
        }
      />
    </>
  );
}

function CartRow({ entry }: { entry: CartEntry }) {
  const { remove } = useCart();
  const { line } = entry;

  return (
    <li
      className={
        "flex gap-3 rounded-sky-md bg-deep/80 p-3 ring-1 ring-border/60 backdrop-blur-sm " +
        // Dimmed, never hidden: the line is still the visitor's choice.
        (entry.purchasable ? "" : " opacity-70")
      }
    >
      <div className="w-16 shrink-0 sm:w-20">
        <FigureImage file={line.imageFile} name={line.name} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="line-clamp-2 text-sm leading-snug font-medium">{line.name}</span>
        <span className="text-xs text-muted">
          {conditionLabel(line.condition)} · <span className="tabular-nums">{line.skyId}</span>
        </span>

        {entry.price !== null ? (
          <span className="text-sm font-semibold tabular-nums">{formatPrice(entry.price)}</span>
        ) : null}

        {/* Exactly one reason per line, in the order that matters most. */}
        {entry.offer === null ? (
          <span className="text-xs text-danger">{de.cart.withdrawn}</span>
        ) : !entry.purchasable ? (
          <span className="text-xs text-muted">{de.cart.soldOut}</span>
        ) : entry.priceChanged ? (
          <span className="text-xs text-muted">
            {de.cart.priceChanged(formatPrice(line.priceAtAdd))}
          </span>
        ) : null}

        <div className="mt-1 flex items-center gap-3">
          <QuantityField entry={entry} />
          <button
            type="button"
            onClick={() => remove(keyOf(line))}
            aria-label={de.cart.removeFor(line.name)}
            className="min-h-11 text-sm text-muted underline-offset-2 hover:text-foreground hover:underline"
          >
            {de.cart.remove}
          </button>
          {entry.total !== null ? (
            <span className="ml-auto text-sm font-semibold tabular-nums">
              {formatPrice(entry.total)}
            </span>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function CartView({ offers }: { offers: Readonly<Record<string, readonly Offer[]>> }) {
  const { cart, ready, clear } = useCart();

  // Until the stored cart has been read, the honest answer is "nothing yet" —
  // and rendering a count here that the server did not render is a hydration
  // mismatch. A skeleton would be a spinner over a localStorage read.
  if (!ready || cart.length === 0) {
    return (
      <div className={`${PANEL} flex flex-col items-center gap-3 px-4 py-12 text-center ring-gold-line`}>
        <p className="font-medium">{de.cart.empty}</p>
        <p className="text-sm text-muted">{de.cart.emptyHint}</p>
        <Link href="/" className={`${ACTION_NEUTRAL} w-auto`}>
          {de.cart.toCatalog}
        </Link>
      </div>
    );
  }

  const entries = resolveCart(cart, offerIndex(offers));
  const total = cartTotal(entries);
  const unavailable = unavailableEntries(entries);

  return (
    <div className="flex flex-col gap-5">
      <ul className="flex flex-col gap-3">
        {entries.map((entry) => (
          <CartRow key={keyOf(entry.line)} entry={entry} />
        ))}
      </ul>

      <div className={`${PANEL} flex flex-col gap-3 p-4 ring-gold-line`}>
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-sm font-medium">{de.cart.total}</span>
          <span className="text-2xl font-semibold tabular-nums">{formatPrice(total)}</span>
        </div>

        {unavailable.length > 0 ? (
          <p className="text-xs text-muted">{de.cart.excluded(unavailable.length)}</p>
        ) : null}

        {/* Stated plainly rather than dressed up as a disabled button. There
            is no checkout to disable. */}
        <p className="text-sm text-muted">{de.cart.noCheckout}</p>
        <p className="text-[11px] text-muted">{de.cart.localOnly}</p>

        <div className="flex flex-wrap gap-3">
          <Link href="/" className={`${ACTION_NEUTRAL} w-auto`}>
            {de.cart.toCatalog}
          </Link>
          <button type="button" onClick={clear} className={`${ACTION_NEUTRAL} w-auto`}>
            {de.cart.clear}
          </button>
        </div>
      </div>
    </div>
  );
}
