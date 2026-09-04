/**
 * The collect action.
 *
 * Signed out it is a link into the sign-in flow that carries the current
 * catalog context, so the visitor comes back to the same series and search
 * (ADR-0027). The action is deliberately not replayed afterwards.
 *
 * Signed in it updates immediately and reverts if the server disagrees.
 */
"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

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
  const [, startTransition] = useTransition();

  if (signInHref) {
    return (
      <Link
        href={signInHref}
        className="block rounded-md border border-border px-3 py-2 text-center text-sm text-muted hover:text-foreground"
      >
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
        className={
          "w-full rounded-md px-3 py-2 text-center text-sm font-medium " +
          (collected
            ? "bg-foreground text-background"
            : "border border-border text-foreground hover:bg-border/40")
        }
      >
        {collected ? de.catalog.collected : de.catalog.collect}
      </button>
      {failed ? (
        <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
          {de.catalog.collectFailed}
        </p>
      ) : null}
    </div>
  );
}
