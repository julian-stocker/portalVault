/**
 * The two presentation rules of a figure card, in one place.
 *
 * Both used to live inline in the JSX, where "does this card get the frame"
 * was a condition rather than a decision. They are here so the rule is
 * written down once, testable, and cannot drift between the catalog and the
 * collection.
 */

/**
 * What a card is being asked to say about ownership.
 *
 * `catalog` — the grid mixes owned and missing figures, so an owned one gets
 * the vitrine frame. The card answers "do I already have this one?".
 *
 * `showcase` — everything on the page is owned already: `/collection`, and
 * the related figures beside a figure someone is looking at. A frame there
 * would mark every card identically and would water down what the frame
 * means in the catalog (ADR-0038).
 */
export type CardOwnership = "catalog" | "showcase";

/** The vitrine frame: a warm ring and a slightly warmer ground. */
const OWNED_SURFACE = "bg-accent-subtle/45 ring-1 ring-accent/45";
const NEUTRAL_SURFACE = "bg-surface";

/**
 * The card's surface classes.
 *
 * The frame is a catalog answer, never a collection one — which is why the
 * context is a parameter rather than something inferred from `collected`.
 */
export function cardSurfaceClass(ownership: CardOwnership, collected: boolean): string {
  return ownership === "catalog" && collected ? OWNED_SURFACE : NEUTRAL_SURFACE;
}

/** True when the card carries the ownership frame and its assistive text. */
export function marksOwnership(ownership: CardOwnership, collected: boolean): boolean {
  return ownership === "catalog" && collected;
}

/**
 * The quantity to print over the plate, or null.
 *
 * Never "1×": that is every card in the collection, and a badge that is
 * always there says nothing. Above one it says the one thing no label
 * underneath could.
 */
export function duplicateBadge(quantity: number | undefined): number | null {
  return quantity !== undefined && quantity > 1 ? quantity : null;
}
