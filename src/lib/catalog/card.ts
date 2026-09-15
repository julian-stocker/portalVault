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
 * `showcase` — the card is not being asked about ownership at all, and has
 * no answer to give: the related figures beside a figure someone is looking
 * at, where the page never reads who owns what. Such a card passes no
 * `collected` either, so this mode changes nothing on its own.
 *
 * `/collection` used to be `showcase` too, on the reasoning that marking
 * every card on a page of owned figures says nothing (ADR-0038). V3.2
 * overrules that: gold means possession, everywhere, and the same figure may
 * not be gold in the catalog and ivory in the collection. The collection
 * passes `catalog` — the same mode, the same rule, the same template.
 */
export type CardOwnership = "catalog" | "showcase";

/**
 * The collector's frame.
 *
 * Four passes to get here. V2.1 drew one 1 px ring at 45 % alpha, which a
 * glance down a column could not see at all — and being seen at a glance is
 * the only job it has. V3 doubled it, V3.1 lit it, V3.4 lit it harder.
 *
 * V4.2 takes the light away and keeps the metal. A frame is an object with
 * edges: a 3 px gold ring, a pale highlight and a dark seat around it, a fine
 * inner line set in from it, and the four sparkles. No blur radius anywhere —
 * the bloom was what made a row of owned cards read as backlit rather than as
 * framed, and it spilled onto the cards either side of them.
 *
 * V4.4 added the surface; V3.2 reduced what sits on it.
 *
 *   the card's ground   gold  (`--own-ground`, a flat gradient)
 *   the figure's plate  white, with a GOLD seam when owned (V3.2)
 *   the outer frame     gold  (three struck lines plus a 3 px ring)
 *
 * The gold reads as the object the figure stands on, and the figure keeps its
 * own light. A card nobody owns keeps all three neutral.
 *
 * WHY THE SEAM. The ground is plainly visible — ΔE 14–19 against a plain
 * card — but it lies UNDER a square plate that takes two thirds of the tile,
 * so what showed was a 5 px margin and a strip of text. The gold was where
 * nobody looks, which is why the crown was doing the work alone. The seam
 * puts one line of it exactly where the eye rests.
 */
/*
 * THE CARD'S SURFACE IS A PNG SINCE V3.3.
 *
 * `OWNED_SURFACE` and `NEUTRAL_SURFACE` drew the whole card in CSS: the ivory
 * ground and the gold leaf, a bronze outline or a three-line struck frame, an
 * inset line, a sparkle layer. All of it is painted into
 * `designs/cards/silver.png` and `gold.png` now, and none of it is allowed to
 * exist twice — so the constants and `cardSurfaceClass()` are gone rather than
 * left unused.
 *
 * What survives is the QUESTION, which is not a visual matter: which template
 * a card shows still depends on `ownership` being `catalog`, so the collection
 * does not mark every card it holds (ADR-0038).
 */

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
