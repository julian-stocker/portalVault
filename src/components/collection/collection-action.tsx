/**
 * The collection action on a collection card.
 *
 * One control, three states, because a collection page now shows what is
 * missing as well as what is owned:
 *
 *   owned            → "Entfernen"     neutral, available but not the point
 *   just removed     → "Rückgängig"    the reached state, easy to step back
 *   missing          → "+ Sammlung"    neutral, the same weight as a card
 *
 * Controlled by the parent, which owns the quantity — that is what lets the
 * counts, the progress bars and the value update the instant something
 * changes, rather than after a round trip.
 *
 * ADR-0031 unchanged: no confirmation dialog, because the removed card stays
 * on screen with an undo. ADR-0027 unchanged: the mutation states the desired
 * end state, so a repeated tap is harmless.
 *
 * The undo restores the quantity that was there. Removing a row of four and
 * putting it back has to bring back four.
 */
"use client";

import { ACTION_PENDING } from "@/components/ui/action";
import { INK_OFFER } from "@/components/shop/offer-link";
import { useCollectionMutation } from "@/components/collection/use-collection-mutation";
import { de } from "@/lib/i18n/de";

/** A thin cross. Small enough to sit beside an 11 px label without shouting. */
function RemoveGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      className="h-2.5 w-2.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M3 3l6 6M9 3l-6 6" />
    </svg>
  );
}

export function CollectionAction({
  skyId,
  name,
  quantity,
  initialQuantity,
  onQuantityChange,
}: {
  skyId: string;
  name: string;
  /** Current quantity, zero when not owned. */
  quantity: number;
  /** What the server last said — distinguishes "just removed" from "missing". */
  initialQuantity: number;
  onQuantityChange: (skyId: string, quantity: number) => void;
}) {
  const { apply, pending, failed } = useCollectionMutation(skyId, quantity, onQuantityChange);

  const owned = quantity > 0;
  const justRemoved = !owned && initialQuantity > 0;

  const label = owned
    ? de.collection.remove
    : justRemoved
      ? de.collection.undo
      : de.catalog.collect;

  return (
    /*
     * THE WRAPPER CARRIES THE SLOT'S HEIGHT (V3.2).
     *
     * It used to be a bare `<div>`. `h-full` on the button then resolved
     * against a parent of `height: auto`, which is the button's own content
     * height — so it collapsed and sat at the TOP of the silver plate
     * instead of filling it. `OfferLink` has no wrapper at all, which is why
     * the catalog never showed this.
     *
     * The failure message is taken out of flow for the same reason: in flow
     * it would make the wrapper taller than the slot and push the label back
     * off the plate.
     */
    <div className="relative h-full w-full">
      <button
        type="button"
        onClick={() => apply(owned ? 0 : Math.max(initialQuantity, 1))}
        aria-label={owned ? de.collection.removeLabel(name) : undefined}
        aria-busy={pending || undefined}
        className={
          /*
           * THE WHOLE PLATE IS THE CONTROL (V3.2).
           *
           * It used to be an `ACTION_CARD` pill — gold-brown, 40 px tall — in
           * a slot that is 29 px on a 211 px card. It overflowed its row and
           * made removal the heaviest shape on the page, wearing the colour
           * that means ownership.
           *
           * Now it fills the silver plate the artwork already paints, exactly
           * as the catalog's offer line does: same slot, same size, same
           * position, dark ink on silver. The card gains no height, and the
           * tap target is the plate rather than a chip inside it.
           */
          "focus-ring flex h-full w-full items-center justify-center gap-1 " +
          "whitespace-nowrap px-1.5 sm:px-2 " +
          "text-[clamp(9px,4.8cqw,11px)] leading-none font-semibold " +
          "transition-opacity hover:opacity-75 active:opacity-60 " +
          (pending ? ACTION_PENDING : "")
        }
        /* The same near-black the catalog's buyable line uses, from the same
           constant, and inline for the same reason — see `offer-link.tsx`. */
        style={{ color: INK_OFFER }}
      >
        {owned ? <RemoveGlyph /> : null}
        {label}
      </button>
      {failed ? (
        <p
          role="alert"
          className="absolute inset-x-0 top-full mt-1 text-center text-xs text-danger"
        >
          {de.collection.removeFailed}
        </p>
      ) : null}
    </div>
  );
}
