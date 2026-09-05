/**
 * Changing what is owned, without the button around it.
 *
 * The card footer and the table's `Entfernen` do the same thing and must not
 * do it two ways: same optimistic update, same rollback on failure, same
 * desired-end-state mutation (ADR-0027). The card is a full-width action, the
 * table cell is a line of text — that is a difference in presentation, so the
 * shared part is a hook and the two components only decide how they look.
 */
"use client";

import { useState, useTransition } from "react";

import { setCollected } from "@/lib/collection/actions";

export function useCollectionMutation(
  skyId: string,
  quantity: number,
  onQuantityChange: (skyId: string, quantity: number) => void,
) {
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

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

  return { apply, pending, failed };
}
