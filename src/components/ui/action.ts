/**
 * Shared class strings for card and form actions.
 *
 * Five action surfaces across three components had drifted apart — two
 * different button styles for the same meaning, and heights between 36 and
 * 42 px. This is deliberately not a Button component and not a UI library:
 * plain strings, no props, no wrapper. Just one place where the geometry
 * lives so it cannot drift again.
 *
 * The variants carry meaning, not decoration (V3.1):
 *
 *   OWN      taking possession — the detail page's collect.        GOLD
 *   OWNED    a state that has been reached, stated rather than ticked. GOLD
 *   TRADE    buying, and the steps towards it.                     SILVER
 *   PRIMARY  the one action worth taking here, meaning nothing
 *            further — save, sign in, search.                      NEUTRAL
 *   NEUTRAL  an action on the canvas — an empty state, a reset.    NEUTRAL
 *   CARD     the action inside a card — "Info", "Entfernen".
 *
 * Until V3.1 `PRIMARY` was all three of the first four at once: it was the
 * collect button, the pay button and the save button, in one gold. That is
 * how gold came to say both "this is yours" and "this costs money".
 *
 * `min-h-11` is 44 px: the touch target size, applied to every one of them.
 */

/** Geometry and typography. Identical for every action. */
const BASE =
  "flex min-h-11 w-full items-center justify-center rounded-sky-md px-3 py-2 " +
  "text-center text-sm font-medium";

/**
 * The neutral primary: the one action worth taking on a screen that means
 * neither possession nor trade. Save, sign in, search, send.
 *
 * Deliberately not a metal. The FILL is quiet and the BORDER carries the
 * weight — a tonal fill alone measures 1.6:1 against the sky, which reads as
 * a panel rather than a control and misses the 3:1 a boundary needs (WCAG
 * 1.4.11). The edge is 4.4:1 on the sky and 4.8:1 at night.
 *
 * Quieter than gold and silver on purpose: on a screen that has both, the
 * save button must not be the loudest thing present.
 */
export const ACTION_PRIMARY =
  `${BASE} focus-ring bg-action-neutral text-on-action-neutral ` +
  `ring-1 ring-action-neutral-edge hover:bg-action-neutral-hover`;

/**
 * Taking possession (V3.1). Gold, because gold means the collection.
 *
 * The detail page's collect button, and nothing else: this is the one place
 * in the product where a single press adds something to what you own.
 */
export const ACTION_OWN =
  `${BASE} focus-ring bg-own-ink text-on-own hover:brightness-110`;

/**
 * Buying (V3.1). Silver — a different metal, not a dimmer gold.
 *
 * Used where the decision is actually made: the checkout submit and the step
 * into it. Polished rather than dark, because these sit on the DARK panels —
 * the composition is bright objects on a dark ground. The pill inside an
 * ivory card is the other way round; see `--trade-on-card`.
 *
 * 10.5:1 ink on fill, 11.7:1 against the sky at dusk and 12.8:1 at night.
 *
 * V3.1a gave it an edge and depth. A flat light rectangle reads as a panel
 * however bright it is; a struck edge, a drop shadow and a hover that
 * actually moves (ΔE 7.6) are what make it read as a control.
 */
export const ACTION_TRADE =
  `${BASE} focus-ring bg-trade-solid text-on-trade shadow-card ` +
  `ring-1 ring-trade-line-strong ` +
  `transition-colors hover:bg-trade-solid-hover hover:shadow-raised`;

/**
 * Bordered and quiet. Used where an action stands on the canvas rather than
 * inside a card — an empty state, a reset.
 */
export const ACTION_NEUTRAL = `${BASE} focus-ring border border-border-strong text-foreground hover:bg-border/40`;

/**
 * The card action (ADR-0038).
 *
 * Filled with a tone rather than outlined: on a borderless card an outline
 * would put back the frame the card just lost, and a full-width bordered
 * button on 561 cards was a large part of why the grid read as a checklist.
 * Tonal reads as tappable while staying behind the figure.
 *
 * Always visible, on every viewport. Revealing it on hover would have been
 * quieter still and is exactly the trap: a phone has no hover, and the one
 * action the catalog exists for must not depend on a pointer.
 */
/**
 * The card action, on the ivory collectible card (ADR-0038, V3).
 *
 * Dark on light, which is the only way round that works there: the card is
 * the bright object, so its footer button has to be the quiet dark shape
 * inside it rather than a lighter patch on an already light ground.
 */
export const ACTION_CARD =
  `${BASE} focus-ring min-h-10 rounded-full bg-[#3b2a17] text-[#f4e3c4] ring-1 ring-inset ` +
  `ring-white/10 shadow-card hover:bg-[#4a3520]`;

/**
 * The shop action — „In den Warenkorb" (ADR-0043), in silver since V3.1.
 *
 * A pill beside the price rather than a bar across the panel. The figure page
 * carries the collector's action too, and the two no longer have to compete
 * for the same colour: one is gold, one is silver, and the hierarchy between
 * them is carried by size as it always was.
 *
 * It sits on the dark offer panel, so the polished silver is the right face
 * of the metal here. Edge, depth and a real hover added in V3.1a: without
 * them a light fill on a dark panel reads as a surface, not as something to
 * press. `font-semibold` because the label is short and has to hold its own
 * against the price beside it.
 *
 * `min-h-11` is still 44 px: it is smaller in width, never in touch target.
 */
export const ACTION_SHOP =
  "inline-flex min-h-11 shrink-0 items-center justify-center rounded-full px-4 py-2 " +
  "text-center text-sm font-semibold focus-ring bg-trade-solid text-on-trade " +
  "shadow-card ring-1 ring-trade-line-strong " +
  "transition-colors hover:bg-trade-solid-hover hover:shadow-raised";

/**
 * The quiet link at the foot of a card (V9.1).
 *
 * "Info" was a full-width ACTION_CARD button, which made the one secondary
 * thing on the card the heaviest shape on it; V9 made it a centred text link,
 * which made it nearly invisible. It sits at the left end of the card's
 * footer now, a little larger and a little firmer — a link, still, but one
 * that reads as an action.
 *
 * `min-h-10` is the touch target: 40 px tall, because the visible ink is not
 * the tappable area. It never stretches, so it cannot push the buy action out
 * of the row — the two are flex siblings with a gap between them.
 *
 * It may, however, shrink. A wide pill ("ab € 58,90") next to this label
 * exceeds a 161 px card at 390 px, and two `shrink-0` siblings would simply
 * overflow. So the label truncates instead: the icon and the touch target
 * stay, the price keeps its full width, and the row keeps its height.
 */
export const ACTION_LINK =
  "inline-flex min-h-10 min-w-0 items-center gap-1 -mx-1 px-1 text-xs font-medium focus-ring " +
  "text-on-card-muted underline underline-offset-2 hover:text-on-card";

/**
 * Owning something is a state of the showcase, not a completed task
 * (ADR-0038). So it is not a filled success button and carries no check
 * glyph — it is a quiet chip that happens to also be the way to undo.
 *
 * Same height as ACTION_CARD so a row of cards stays level whichever state
 * each one is in.
 */
export const ACTION_OWNED =
  `${BASE} focus-ring min-h-10 gap-1.5 bg-own-subtle text-own-ink ring-1 ring-own-line ` +
  `hover:bg-own-subtle/70`;

/**
 * While a mutation is in flight.
 *
 * Visual only — the button stays enabled on purpose. Every mutation states a
 * desired end state rather than toggling (ADR-0027), so a second tap during
 * the first is safe, and disabling would take away a working interaction to
 * signal something a little transparency already says.
 */
export const ACTION_PENDING = "opacity-70";
