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
 *   PRIMARY    the one action worth taking here — "+ Sammlung"
 *   CONFIRMED  a state that has been reached — "✓ Gesammelt", "Rückgängig"
 *   NEUTRAL    available, but not what the card is for — "Entfernen"
 *
 * `min-h-11` is 44 px: the touch target size, applied to every one of them.
 */

/** Geometry and typography. Identical for every action. */
const BASE =
  "flex min-h-11 w-full items-center justify-center rounded-sky-md px-3 py-2 " +
  "text-center text-sm font-medium";

/**
 * The warm accent. Reserved for a single, genuinely primary action on a
 * screen — a form submit today, a detail page action later. Deliberately NOT
 * used on figure cards: repeated across a grid it would stop being an accent
 * and become the background noise of the catalog.
 */
export const ACTION_PRIMARY = `${BASE} bg-accent text-on-accent hover:bg-accent-hover`;

/**
 * Tonal rather than filled: reached states stay legible and clickable but
 * stop competing with the primary action. The glyph in the label carries the
 * state as well, so it never rests on colour alone.
 */
export const ACTION_CONFIRMED = `${BASE} border border-accent/40 bg-accent-subtle text-foreground`;

/**
 * Bordered and quiet. The workhorse: this is what a card action looks like,
 * repeated hundreds of times down the catalog.
 *
 * `border-strong` and full-strength text rather than `muted` — it has to read
 * as a real, tappable action at a glance while scrolling, it just must not
 * shout. That is the whole reason the accent is not used here.
 */
export const ACTION_NEUTRAL = `${BASE} border border-border-strong text-foreground hover:bg-border/40`;

/**
 * While a mutation is in flight.
 *
 * Visual only — the button stays enabled on purpose. Every mutation states a
 * desired end state rather than toggling (ADR-0027), so a second tap during
 * the first is safe, and disabling would take away a working interaction to
 * signal something a little transparency already says.
 */
export const ACTION_PENDING = "opacity-70";
