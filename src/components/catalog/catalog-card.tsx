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
 *
 * For an administrator the same card carries different actions (ADR-0042).
 * Everything about how a figure looks — picture, name, price, series,
 * element, layout, responsiveness — stays in FigureCard and is shared. Only
 * the interaction changes: a collector collects, an administrator edits the
 * public name and decides whether the figure is in the catalog at all. There
 * is no second card component and no second catalog.
 */
"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { AdminCardActions, HiddenBadge } from "@/components/admin/card-actions";
import { InlineName } from "@/components/admin/inline-name";
import { FigureCard } from "@/components/catalog/figure-card";
import { OfferLine } from "@/components/shop/offer-line";
import { ACTION_CARD } from "@/components/ui/action";
import { setCollected } from "@/lib/collection/actions";
import type { CatalogFigure } from "@/lib/catalog/types";
import type { Offer } from "@/lib/shop/offer";
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
  admin = false,
  visible = true,
  onVisibilityChange,
  offers = [],
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
  /** Administrator mode: editorial actions instead of collection actions. */
  admin?: boolean;
  /** Editorial visibility, only meaningful in administrator mode. */
  visible?: boolean;
  onVisibilityChange?: (skyId: string, visible: boolean) => void;
  /**
   * What SkyIsles offers for this figure — usually nothing (ADR-0043).
   *
   * Handed down from the page rather than looked up here: one call answers
   * for the whole catalog, and a per-card lookup would be 561 requests.
   */
  offers?: readonly Offer[];
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

  // The administrator's card. Same FigureCard, same layout, same everything
  // that shows a figure — a different set of things to do with it.
  if (admin) {
    return (
      <FigureCard
        figure={figure}
        // No ownership frame and no crown: the business account manages the
        // catalog, it does not collect from it (ADR-0042).
        ownership="catalog"
        highlighted={highlighted}
        showSeries={false}
        interactive={false}
        muted={!visible}
        statusBadge={visible ? null : <HiddenBadge />}
        // No offer line: the operator has the price in /admin/inventory,
        // where it can also be changed. Repeating it here would be a second
        // place that states a price and cannot edit it (ADR-0042).
        nameSlot={
          <InlineName
            skyId={figure.skyId}
            displayName={figure.displayName}
            // What the public name falls back to when the override is
            // cleared. `displayName` already is that when none is set.
            derivedName={figure.displayNameOverride === null ? figure.displayName : figure.canonicalName}
            override={figure.displayNameOverride}
          />
        }
        footer={
          <AdminCardActions
            skyId={figure.skyId}
            visible={visible}
            onVisibilityChange={onVisibilityChange ?? (() => {})}
          />
        }
      />
    );
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
        offerSlot={<OfferLine offers={offers} />}
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
      offerSlot={<OfferLine offers={offers} />}
      footer={footer}
    />
  );
}
