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
 */
const OWNED_SURFACE =
  // The same ivory ground as any other card.
  //
  // V4 tinted the whole card warm and lit it from inside, and the figures
  // came out washed out — a yellow filter over the photograph rather than a
  // frame around it. The gold belongs *around* the card: the card itself,
  // the picture and the text stay exactly as bright and as saturated as on a
  // figure nobody owns (V4.1).
  "bg-card ring-[3px] ring-[#e0a84a] shadow-gold " +
  // The fine inner line, inset from the ring so the two read as a frame
  // rather than as one thick border. A line, not a fill.
  "before:pointer-events-none before:absolute before:inset-[4px] " +
  "before:rounded-[0.68rem] before:ring-1 before:ring-[rgb(240_192_115/0.75)] " +
  "before:content-[''] " +
  // Four still points of light on the frame. `bg-[image:var(--gold-sparkle)]`
  // paints only those four dots — the rest of the layer is transparent, so
  // nothing underneath is brightened.
  "after:pointer-events-none after:absolute after:inset-0 after:rounded-sky-lg " +
  "after:bg-[image:var(--gold-sparkle)] after:content-['']";

/**
 * The plain display piece.
 *
 * Every card is framed — a collectible in a case has an edge whether or not
 * it is yours. But the edge here is **bronze**, not dimmed gold: at 25 %
 * accent the two states were the same colour at two strengths, which is a
 * comparison the eye has to make rather than see. A different metal is seen.
 */
const NEUTRAL_SURFACE = "bg-card ring-1 ring-[#8a6a45]/55 shadow-card";

/**
 * The card's surface classes.
 *
 * The frame is a catalog answer, never a collection one — which is why the
 * context is a parameter rather than something inferred from `collected`.
 * Both branches share the ivory ground: the difference is the frame, not the
 * material the piece is made of.
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
