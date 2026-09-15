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

import { useState, useTransition } from "react";

import { AdminCardActions, HiddenBadge } from "@/components/admin/card-actions";
import { InlineName } from "@/components/admin/inline-name";
import { FigureCard } from "@/components/catalog/figure-card";
import { OfferLink } from "@/components/shop/offer-link";
import { setCollected } from "@/lib/collection/actions";
import type { CatalogFigure } from "@/lib/catalog/types";
import type { Offer } from "@/lib/shop/offer";
import { quickBuyOffers } from "@/lib/ui/quick-view";
import { de } from "@/lib/i18n/de";


export function CatalogCard({
  figure,
  initialCollected,
  onCollectedChange,
  signInHref,
  highlighted = false,
  admin = false,
  visible = true,
  onVisibilityChange,
  offers = [],
  showSeries = false,
  onOpenOffers,
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
  /** A deep link landed on this card. Passed straight through. */
  highlighted?: boolean;
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
  /**
   * Whether the card names its game.
   *
   * Off by default, because the catalog always has a series selected and the
   * label would repeat the active tab on every card. `/shop` turns it on: that
   * grid mixes all six games, so the series is the one thing a card there
   * cannot be assumed to share with its neighbours.
   */
  showSeries?: boolean;
  /**
   * Opens the quick view for this figure (IR-001).
   *
   * Passed down rather than held here: the dialog must not be rendered inside
   * the card. `FigureCard` is an `@container`, which is a containing block
   * for `position: fixed` descendants, so a dialog mounted in this subtree
   * would lay itself out inside a 211 px card. The grid's owner holds the
   * state and renders one dialog for the whole page.
   */
  onOpenOffers?: () => void;
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
  // that shows a figure — a different set of things to do with it. No buy
  // action: the operator manages prices and listings in /admin/inventory and
  // does not shop in their own catalog (ADR-0042).
  if (admin) {
    return (
      <FigureCard
        figure={figure}
        // No ownership frame and no crown: the business account manages the
        // catalog, it does not collect from it (ADR-0042). The VARIANT SEAL
        // does appear — it is a property of the figure, not of a viewer, and
        // the operator needs to tell a Legendary from its base figure more
        // than anyone (V3.2).
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
        trade={
          <AdminCardActions
            skyId={figure.skyId}
            visible={visible}
            onVisibilityChange={onVisibilityChange ?? (() => {})}
          />
        }
      />
    );
  }

  /**
   * The trade row, and the whole of it (V3.2).
   *
   * The silver plate is painted into both templates, so it is always there
   * and `OfferLink` decides what stands on it: an offer, or the quiet
   * sentence that there is none.
   *
   * The "Info" link is gone. The card body already leads to the detail page,
   * and a second link to the same destination was the one element on the tile
   * that said nothing. Whatever the visitor taps — picture, name, offer —
   * they arrive at the figure, and the offer row arrives at its offers.
   */
  /*
   * The quick view is offered only when it would have something to sell.
   *
   * It trades loose copies alone (`QUICK_VIEW_CONDITION`), so a figure whose
   * only listing is boxed gets no dialog — and `OfferLink` then does what it
   * did before: it is a link, and it leads to the figure page where that
   * boxed offer is. A dialog that opened to say "nothing here" would be a
   * worse answer than the page that has the answer.
   */
  const quickBuy = quickBuyOffers(offers).length > 0;

  const trade = (
    <OfferLink
      offers={offers}
      slug={figure.slug}
      name={figure.displayName}
      onOpen={quickBuy ? onOpenOffers : undefined}
    />
  );

  /**
   * A collect that did not stick has to say so on the card it failed on.
   *
   * Over the foot of the window, where it covers artwork rather than
   * information — and where it cannot change the card's height.
   */
  const notice = failed ? (
    <span
      role="alert"
      className="absolute inset-x-1 bottom-1 rounded bg-danger/90 px-1 py-0.5 text-center text-[9px] leading-tight font-semibold text-[#2a0f0d]"
    >
      {de.catalog.collectFailed}
    </span>
  ) : null;

  // Signed out the body is a link rather than a toggle: there is nothing to
  // toggle yet, and the same tap should lead where the visitor needs to go.
  if (signInHref) {
    return (
      <FigureCard
        figure={figure}
        ownership="catalog"
        href={signInHref}
        highlighted={highlighted}
        showSeries={showSeries}
        trade={trade}
        notice={notice}
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
      showSeries={showSeries}
      trade={trade}
      notice={notice}
    />
  );
}
