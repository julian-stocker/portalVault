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

import { useState, useTransition } from "react";

import {
  ACTION_CARD,
  ACTION_OWNED,
  ACTION_PENDING,
} from "@/components/ui/action";
import { setCollected } from "@/lib/collection/actions";
import { de } from "@/lib/i18n/de";

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
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const owned = quantity > 0;
  const justRemoved = !owned && initialQuantity > 0;

  function apply(nextQuantity: number) {
    const previous = quantity;
    onQuantityChange(skyId, nextQuantity); // optimistic
    setFailed(false);

    startTransition(async () => {
      const result =
        nextQuantity > 0
          ? // State the count, not just "owned": that is what brings a
            // removed row of four back as four.
            await setCollected(skyId, true, nextQuantity)
          : await setCollected(skyId, false);

      if (!result.ok) {
        onQuantityChange(skyId, previous); // a wrong state is worse than an error
        setFailed(true);
      }
    });
  }

  const label = owned
    ? de.collection.remove
    : justRemoved
      ? de.collection.undo
      : de.catalog.collect;

  return (
    <div>
      <button
        type="button"
        onClick={() => apply(owned ? 0 : Math.max(initialQuantity, 1))}
        aria-label={owned ? de.collection.removeLabel(name) : undefined}
        aria-busy={pending || undefined}
        className={`${justRemoved ? ACTION_OWNED : ACTION_CARD} ${pending ? ACTION_PENDING : ""}`}
      >
        {label}
      </button>
      {failed ? (
        <p role="alert" className="mt-1 text-xs text-danger">
          {de.collection.removeFailed}
        </p>
      ) : null}
    </div>
  );
}
