/**
 * Removing a figure from a collection.
 *
 * Uses the same server action as the catalog toggle — the mutation states the
 * desired end state, so a repeated tap is harmless (ADR-0027). No new toggle
 * logic exists here.
 *
 * A removed card stays on screen in a spent state with an undo, rather than
 * vanishing. That is what makes a confirmation dialog unnecessary: the action
 * is trivially reversible for as long as the page is open.
 */
"use client";

import { useState, useTransition } from "react";

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
  const [, startTransition] = useTransition();

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
        // min-h-11 keeps the target at 44 px, so a thumb cannot miss it or
        // hit it by accident on a neighbouring card.
        className={
          "min-h-11 w-full rounded-md px-3 py-2 text-center text-sm font-medium " +
          (removed
            ? "bg-foreground text-background"
            : "border border-border text-muted hover:text-foreground")
        }
      >
        {removed ? de.collection.undo : de.collection.remove}
      </button>
      {failed ? (
        <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
          {de.collection.removeFailed}
        </p>
      ) : null}
    </div>
  );
}
