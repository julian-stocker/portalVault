/**
 * Coming back to the checkout after leaving it (B2.4).
 *
 * THE BUG THIS EXISTS FOR
 *
 * Starting a payment navigates the tab to Stripe with
 * `window.location.assign()`. The browser keeps the SkyIsles document in its
 * back/forward cache, and pressing Back restores it **exactly as it was** —
 * including React state. `redirecting` was true when the tab left, so it is
 * true again when it returns: the button stays disabled and reads
 * "Weiterleitung zur Zahlung", and the customer can no longer pay for an order
 * that exists and is holding stock.
 *
 * A bfcache restore is not a mount. No effect re-runs, no state initialises,
 * nothing resets. `pageshow` is the only event that fires, and it is the only
 * place this can be noticed.
 *
 * WHY `event.persisted` IS READ BUT NOT BRANCHED ON
 *
 * `persisted` is true exactly for a bfcache restore and false for an ordinary
 * load. Branching on it would mean trusting every browser to report it the
 * same way — Safari, Firefox and Chrome have differed here historically, and a
 * browser that restores state while reporting `persisted: false` would
 * reproduce the bug in precisely the place the branch was meant to prevent it.
 *
 * Resetting on every `pageshow` costs nothing instead: on a fresh load there
 * is no stuck redirect to clear, so the reset is a no-op. The value is passed
 * to the handler for logging and for tests, and no decision is made from it.
 *
 * WHAT IS DELIBERATELY *NOT* RESET
 *
 * Only the transient "a redirect is under way" lock. The placed order, its id
 * and the capability in `sessionStorage` are untouched — losing them would
 * strand an order that is holding stock, which is the failure this is meant to
 * end, not repeat.
 */

/** The slice of `window` this needs. Narrow, so a test can supply its own. */
export type PageShowTarget = {
  addEventListener(type: "pageshow", listener: (event: PageShowLike) => void): void;
  removeEventListener(type: "pageshow", listener: (event: PageShowLike) => void): void;
};

/** What a `PageTransitionEvent` gives us. */
export type PageShowLike = { persisted?: boolean };

/**
 * Run `onShown` whenever this document is displayed, and return the
 * unsubscribe function an effect can hand back for cleanup.
 *
 * An in-flight redirect is untouched: `pageshow` fires when a document is
 * *shown*, and a tab on its way to Stripe is being hidden. So the lock only
 * lifts once the customer is actually looking at the checkout again.
 */
export function watchPageShow(
  target: PageShowTarget,
  onShown: (persisted: boolean) => void,
): () => void {
  const listener = (event: PageShowLike) => onShown(event?.persisted === true);
  target.addEventListener("pageshow", listener);
  return () => target.removeEventListener("pageshow", listener);
}
