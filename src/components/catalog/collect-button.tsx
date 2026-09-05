/**
 * The collect action.
 *
 * Signed out it is a link into the sign-in flow that carries the current
 * catalog context, so the visitor comes back to the same series and search
 * (ADR-0027). The action is deliberately not replayed afterwards.
 *
 * Signed in it updates immediately and reverts if the server disagrees.
 *
 * Only the detail page uses it since V2.1 (ADR-0038): in the grid the card
 * itself is the toggle, so the button that used to repeat on 561 cards is
 * gone. A detail page has exactly one thing to do, and that is what the
 * accent was reserved for (ADR-0035).
 *
 * Two states, and neither of them is a checkbox. Not collected is the accent;
 * collected is a chip reading "In deiner Sammlung" with a small case glyph —
 * no check mark, no green, no "done". The chip is still the button, so the
 * state can be taken back where it was set.
 */
"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import {
  ACTION_CARD,
  ACTION_OWNED,
  ACTION_PENDING,
  ACTION_PRIMARY,
} from "@/components/ui/action";
import { setCollected } from "@/lib/collection/actions";
import { de } from "@/lib/i18n/de";

/** A display case, drawn rather than ticked. Decorative; the label speaks. */
function CaseGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1.5" />
      <path d="M2.25 9.75h11.5" />
    </svg>
  );
}

type Props = {
  skyId: string;
  initialCollected: boolean;
  /** null when nobody is signed in; then this renders as a sign-in link. */
  signInHref: string | null;
  /**
   * Where the button sits.
   *
   * "card" is tonal, because the same button repeats on up to 561 cards.
   * "page" is the accent: a detail page has exactly one thing to do, and
   * that is what the accent was reserved for (ADR-0035).
   */
  variant?: "card" | "page";
};

export function CollectButton({
  skyId,
  initialCollected,
  signInHref,
  variant = "card",
}: Props) {
  const idle = variant === "page" ? ACTION_PRIMARY : ACTION_CARD;
  const [collected, setLocal] = useState(initialCollected);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  if (signInHref) {
    // Same intent, same affordance: a visitor should not have to learn that
    // this button looks different before they have an account.
    return (
      <Link href={signInHref} className={idle}>
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
        // What a second press would do — the visible label states the state,
        // not the action, so the action is named here.
        title={collected ? de.catalog.collectedHint : undefined}
        // Not disabled while pending, on purpose — see ACTION_PENDING.
        aria-busy={pending || undefined}
        className={`${collected ? ACTION_OWNED : idle} ${pending ? ACTION_PENDING : ""}`}
      >
        {collected ? (
          <>
            <CaseGlyph />
            <span className="truncate">{de.catalog.collected}</span>
            <span className="sr-only">— {de.catalog.collectedHint}</span>
          </>
        ) : (
          de.catalog.collect
        )}
      </button>
      {failed ? (
        <p role="alert" className="mt-1 text-xs text-danger">
          {de.catalog.collectFailed}
        </p>
      ) : null}
    </div>
  );
}
