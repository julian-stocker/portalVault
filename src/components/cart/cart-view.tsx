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

import { useAddToCart } from "@/components/cart/use-add-to-cart";
import { useCart } from "@/components/cart/use-cart";
import { FigureImage } from "@/components/catalog/figure-image";
import { conditionLabel } from "@/lib/shop/condition";
import { ACTION_COMMERCE_BLOCK, ACTION_NEUTRAL, COMMERCE_SURFACE } from "@/components/ui/action";
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

/** Both ends of the stepper. 44 px targets, and identical to each other. */
const STEP =
  "flex h-11 w-11 items-center justify-center rounded-sky-md bg-surface-raised " +
  "text-lg leading-none ring-1 ring-border-strong transition-colors " +
  "focus-ring hover:ring-border-strong disabled:opacity-40";

/**
 * `−  2  +` (V11), where there used to be a free number field.
 *
 * The field took a typed 99 and wrote it straight to the cart. Nobody had
 * asked whether SkyIsles has 99, and a browser is not in a position to know:
 * `clampQuantity` bounds the number, not the stock. A stepper removes the
 * question of absurd input entirely — the only way up is one at a time, and
 * every one of those steps is checked with the server.
 *
 * The two directions are deliberately not symmetrical:
 *
 *   plus   asks the server what the line's **new total** would be, and only
 *          then writes. Denied leaves the cart untouched.
 *   minus  is local and immediate. It can only ever make the cart smaller,
 *          so there is nothing to verify and nothing to wait for.
 *
 * Minus stops at one rather than removing the line: "Entfernen" is right
 * there beside it and says what it does. The store still treats a quantity of
 * zero as a removal (`setLineQuantity`) — nothing here calls it with one.
 */
function QuantityStepper({ entry }: { entry: CartEntry }) {
  const { setQuantity } = useCart();
  const { addOne, pending } = useAddToCart();
  const { line } = entry;
  const key = keyOf(line);

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => setQuantity(key, line.quantity - 1)}
        disabled={line.quantity <= 1}
        aria-label={de.cart.decreaseFor(line.name)}
        className={STEP}
      >
        <span aria-hidden="true">−</span>
      </button>

      {/* The number is text, not a field: there is nothing to type into. */}
      <span
        aria-label={`${de.cart.quantityFor(line.name)}: ${line.quantity}`}
        className="min-w-8 text-center text-sm font-medium tabular-nums"
      >
        {line.quantity}
      </span>

      <button
        type="button"
        onClick={() =>
          void addOne({
            skyId: line.skyId,
            condition: line.condition,
            name: line.name,
            imageSrc: line.imageSrc,
            // The server's current price, never the one it was added at.
            price: entry.price ?? line.priceAtAdd,
          })
        }
        // Nothing to add when the line cannot be bought at all, and never
        // past the cart's own bound — the server refuses it too, but asking
        // would be a round trip to be told what is already known.
        disabled={pending || !entry.purchasable || line.quantity >= MAX_LINE_QUANTITY}
        aria-label={de.cart.increaseFor(line.name)}
        className={STEP}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
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
        <FigureImage src={line.imageSrc} name={line.name} />
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
          <QuantityStepper entry={entry} />
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

export function CartView({
  offers,
  guest,
}: {
  offers: Readonly<Record<string, readonly Offer[]>>;
  /** Whether nobody is signed in. Decided on the server (ADR-0061). */
  guest: boolean;
}) {
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

        {/* The one action worth taking here. Following it holds no stock:
            the cart stays non-binding until the checkout is submitted
            (ADR-0050).

            Amber, not silver. Silver is what an offer is made of — a price, a
            condition, the fact that something can be had. This is the step
            somebody takes towards paying, which is the one thing the commerce
            role exists to mark (V3.2). Same geometry as before; only the
            metal changed. */}
        <Link href="/checkout" className={ACTION_COMMERCE_BLOCK} style={COMMERCE_SURFACE}>
          {de.cart.toCheckout}
        </Link>

        {/*
         * § 312j Abs. 1 BGB: at the LATEST at the start of the ordering
         * process, state clearly whether delivery restrictions exist and which
         * means of payment are accepted (ADR-0086). The basket is where that
         * process begins, so it is stated here as well as at the checkout.
         */}
        <p className="text-xs leading-relaxed text-muted">
          {de.legal.orderStart.delivery} {de.legal.orderStart.payment}{" "}
          <Link href="/versand" className="underline underline-offset-4">
            {de.legal.orderStart.more}
          </Link>
        </p>

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
