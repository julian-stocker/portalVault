/**
 * Removing a figure from a collection.
 *
 * Uses the same server action as the catalog toggle — the mutation states the
 * desired end state, so a repeated tap is harmless (ADR-0027). No new toggle
 * logic exists here.
 *
 * A removed card stays on screen in a spent state with an undo, rather than
 * vanishing. That is what makes a confirmation dialog unnecessary: the action
 * is trivially reversible for as long as the page is open (ADR-0031).
 *
 * Same geometry as the collect action, different weight: "Entfernen" is
 * available but it is not what the collection page is for, so it stays
 * neutral. "Rückgängig" is the reached state and steps forward again.
 */
"use client";

import { useState, useTransition } from "react";

import {
  ACTION_CONFIRMED,
  ACTION_NEUTRAL,
  ACTION_PENDING,
} from "@/components/ui/action";
import { setCollected } from "@/lib/collection/actions";
import { de } from "@/lib/i18n/de";

export function RemoveButton({
  skyId,
  name,
  removed,
  onRemovedChange,
}: {
  skyId: string;
  name: string;
  removed: boolean;
  onRemovedChange: (skyId: string, removed: boolean) => void;
}) {
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function apply(nextRemoved: boolean) {
    onRemovedChange(skyId, nextRemoved); // optimistic
    setFailed(false);

    startTransition(async () => {
      const result = await setCollected(skyId, !nextRemoved);
      if (!result.ok) {
        onRemovedChange(skyId, !nextRemoved); // a wrong state is worse than an error
        setFailed(true);
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => apply(!removed)}
        aria-label={removed ? de.collection.undo : de.collection.removeLabel(name)}
        aria-busy={pending || undefined}
        className={`${removed ? ACTION_CONFIRMED : ACTION_NEUTRAL} ${pending ? ACTION_PENDING : ""}`}
      >
        {removed ? de.collection.undo : de.collection.remove}
      </button>
      {failed ? (
        <p role="alert" className="mt-1 text-xs text-danger">
          {de.collection.removeFailed}
        </p>
      ) : null}
    </div>
  );
}
