/**
 * A catalog card, with the collect action built into it.
 *
 * The card itself is the action now (ADR-0038, V2.1): tapping it adds the
 * figure to the collection, tapping it again takes it out. The frame is the
 * feedback. That replaces a full-width button on every one of 561 cards,
 * which was the single largest source of interface noise in the grid.
 *
 * Signed out it is a link into the sign-in flow carrying the current catalog
 * context, so the visitor comes back to the same series and search (ADR-0027).
 * The action is deliberately not replayed afterwards.
 *
 * Signed in it updates immediately and reverts if the server disagrees.
 *
 * "Info" is a separate link in the footer, a sibling of the body rather than
 * a child — so navigating to the detail page cannot also toggle the state,
 * with no event handling required to keep the two apart.
 */
"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { FigureCard } from "@/components/catalog/figure-card";
import { ACTION_CARD } from "@/components/ui/action";
import { setCollected } from "@/lib/collection/actions";
import type { CatalogFigure } from "@/lib/catalog/types";
import { de } from "@/lib/i18n/de";

/** An outlined "i". Decorative; the label beside it carries the meaning. */
function InfoGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25v4" />
      <path d="M8 4.75h.01" />
    </svg>
  );
}

export function CatalogCard({
  figure,
  initialCollected,
  onCollectedChange,
  signInHref,
  highlighted,
}: {
  figure: CatalogFigure;
  initialCollected: boolean;
  /**
   * Tells the catalog what this card just did, so the ownership filter sees
   * it in the same frame rather than after a round trip (V4.3).
   */
  onCollectedChange?: (skyId: string, collected: boolean) => void;
  /** null when somebody is signed in; otherwise where the card leads instead. */
  signInHref: string | null;
  highlighted: boolean;
}) {
  const [collected, setLocal] = useState(initialCollected);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();

  function onToggle() {
    const desired = !collected;
    setLocal(desired); // optimistic
    onCollectedChange?.(figure.skyId, desired);
    setFailed(false);

    startTransition(async () => {
      // The desired end state, not a toggle: a second tap that arrives while
      // the first is still in flight expresses its own end state (ADR-0027).
      const result = await setCollected(figure.skyId, desired);
      if (!result.ok) {
        setLocal(!desired); // a wrong state on screen is worse than an error
        // Also told upward, and that is the part that still works when the
        // card has meanwhile left the list under the ownership filter: the
        // figure comes back. Its inline error message is lost with it, which
        // is the right trade — a wrong list is worse than a missing note.
        onCollectedChange?.(figure.skyId, !desired);
        setFailed(true);
      }
    });
  }

  const footer = (
    <>
      <Link
        href={`/skylanders/${figure.slug}`}
        aria-label={de.catalog.infoFor(figure.displayName)}
        className={`${ACTION_CARD} gap-1.5`}
      >
        <InfoGlyph />
        {de.catalog.info}
      </Link>
      {failed ? (
        <p role="alert" className="mt-1 text-xs text-danger">
          {de.catalog.collectFailed}
        </p>
      ) : null}
    </>
  );

  // Signed out the body is a link rather than a toggle: there is nothing to
  // toggle yet, and the same tap should lead where the visitor needs to go.
  if (signInHref) {
    return (
      <FigureCard
        figure={figure}
        ownership="catalog"
        href={signInHref}
        highlighted={highlighted}
        showSeries={false}
        footer={footer}
      />
    );
  }

  return (
    <FigureCard
      figure={figure}
      ownership="catalog"
      collected={collected}
      onToggle={onToggle}
      toggleLabel={collected ? de.catalog.collectedHint : de.catalog.collect}
      highlighted={highlighted}
      showSeries={false}
      footer={footer}
    />
  );
}
