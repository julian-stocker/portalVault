/**
 * The basket outline, shared by the header badge and the card's buy action.
 *
 * Extracted so the two cannot drift into two different baskets. Decorative
 * everywhere it is used: the label beside it, or the button's accessible
 * name, carries the meaning.
 *
 * V11 adds a second state rather than a second icon. `CartCheckedGlyph` is
 * the same basket with a tick inside it — same viewBox, same stroke, same
 * geometry — because "this is in your basket" is a state of the basket and
 * should not look like a different object. Composed from one shared path
 * below, so the outline cannot diverge between the two.
 *
 * The tick is drawn, not typed. A Unicode "✓" in the markup would inherit
 * the text stack's font, sit on the text baseline rather than in the basket,
 * and be read aloud by a screen reader as a word.
 */

/** The basket itself. One definition, both states. */
function BasketPaths() {
  return (
    <>
      <path d="M3 6h18l-1.8 9.6a2 2 0 0 1-2 1.6H6.8a2 2 0 0 1-2-1.6L3 6Z" />
      <path d="M8.5 6 10 2.75M15.5 6 14 2.75" />
      <circle cx="9" cy="20.25" r="1.25" />
      <circle cx="16" cy="20.25" r="1.25" />
    </>
  );
}

/** Shared drawing attributes, so stroke weight cannot drift between states. */
const STROKE = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "1.8",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function CartGlyph({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={`shrink-0 ${className}`} {...STROKE}>
      <BasketPaths />
    </svg>
  );
}

/**
 * The basket with something already in it.
 *
 * The tick sits **inside** the basket, which is the whole message: the
 * article is in there. It deliberately does not look like a completion badge
 * on a receipt — nothing has been ordered, and V11 has no checkout. What it
 * says is "already in your cart", and the button beside it still adds.
 */
export function CartCheckedGlyph({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={`shrink-0 ${className}`} {...STROKE}>
      <BasketPaths />
      {/* Small, centred in the basket's body, and clear of both handles. */}
      <path d="m8.6 10.9 2.2 2.2 4.4-4.4" strokeWidth="2.1" />
    </svg>
  );
}
