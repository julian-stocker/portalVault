/**
 * Shared class strings for card and form actions.
 *
 * Five action surfaces across three components had drifted apart — two
 * different button styles for the same meaning, and heights between 36 and
 * 42 px. This is deliberately not a Button component and not a UI library:
 * plain strings, no props, no wrapper. Just one place where the geometry
 * lives so it cannot drift again.
 *
 * The variants carry meaning, not decoration:
 *
 *   PRIMARY  the one action worth taking here — the detail page's collect
 *   OWNED    a state that has been reached, stated rather than ticked
 *   NEUTRAL  an action on the canvas — an empty state, a reset
 *   CARD     the action inside a card — "Info", "Entfernen"
 *
 * `min-h-11` is 44 px: the touch target size, applied to every one of them.
 */

/** Geometry and typography. Identical for every action. */
const BASE =
  "flex min-h-11 w-full items-center justify-center rounded-sky-md px-3 py-2 " +
  "text-center text-sm font-medium";

/**
 * The warm accent. Reserved for a single, genuinely primary action on a
 * screen — a form submit, a detail page action. Deliberately NOT used on
 * figure cards: repeated across a grid it would stop being an accent and
 * become the background noise of the catalog.
 */
export const ACTION_PRIMARY = `${BASE} bg-accent text-on-accent hover:bg-accent-hover`;

/**
 * Bordered and quiet. Used where an action stands on the canvas rather than
 * inside a card — an empty state, a reset.
 */
export const ACTION_NEUTRAL = `${BASE} border border-border-strong text-foreground hover:bg-border/40`;

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
export const ACTION_CARD =
  `${BASE} min-h-10 bg-border/40 text-foreground hover:bg-border/70`;

/**
 * Owning something is a state of the showcase, not a completed task
 * (ADR-0038). So it is not a filled success button and carries no check
 * glyph — it is a quiet chip that happens to also be the way to undo.
 *
 * Same height as ACTION_CARD so a row of cards stays level whichever state
 * each one is in.
 */
export const ACTION_OWNED =
  `${BASE} min-h-10 gap-1.5 bg-accent-subtle text-foreground hover:bg-accent-subtle/70`;

/**
 * While a mutation is in flight.
 *
 * Visual only — the button stays enabled on purpose. Every mutation states a
 * desired end state rather than toggling (ADR-0027), so a second tap during
 * the first is safe, and disabling would take away a working interaction to
 * signal something a little transparency already says.
 */
export const ACTION_PENDING = "opacity-70";
