/**
 * The collect action.
 *
 * Signed out it is a link into the sign-in flow that carries the current
 * catalog context, so the visitor comes back to the same series and search
 * (ADR-0027). The action is deliberately not replayed afterwards.
 *
 * Signed in it updates immediately and reverts if the server disagrees.
 *
 * A collector's action, not a purchase. Neutral rather than filled: this
 * button repeats on up to 561 cards, and a wall of amber would put the
 * interface in front of the figures. The accent stays an accent — reserved
 * for a single real primary action, never for the grid (ADR-0035).
 */
"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import {
  ACTION_CONFIRMED,
  ACTION_NEUTRAL,
  ACTION_PENDING,
} from "@/components/ui/action";
import { setCollected } from "@/lib/collection/actions";
import { de } from "@/lib/i18n/de";

type Props = {
  skyId: string;
  initialCollected: boolean;
  /** null when nobody is signed in; then this renders as a sign-in link. */
  signInHref: string | null;
};

export function CollectButton({ skyId, initialCollected, signInHref }: Props) {
  const [collected, setLocal] = useState(initialCollected);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  if (signInHref) {
    // Same intent, same affordance: a visitor should not have to learn that
    // this button looks different before they have an account.
    return (
      <Link href={signInHref} className={ACTION_NEUTRAL}>
        {de.catalog.collectSignedOut}
      </Link>
    );
  }

  function onClick() {
    const desired = !collected;
    setLocal(desired); // optimistic
    setFailed(false);

    startTransition(async () => {
      // The desired end state, not a toggle: a second tap that arrives while
      // the first is still in flight expresses its own end state (ADR-0027).
      const result = await setCollected(skyId, desired);
      if (!result.ok) {
        setLocal(!desired); // a wrong state on screen is worse than an error
        setFailed(true);
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={collected}
        // Not disabled while pending, on purpose — see ACTION_PENDING.
        aria-busy={pending || undefined}
        className={`${collected ? ACTION_CONFIRMED : ACTION_NEUTRAL} ${pending ? ACTION_PENDING : ""}`}
      >
        {collected ? de.catalog.collected : de.catalog.collect}
      </button>
      {failed ? (
        <p role="alert" className="mt-1 text-xs text-danger">
          {de.catalog.collectFailed}
        </p>
      ) : null}
    </div>
  );
}
