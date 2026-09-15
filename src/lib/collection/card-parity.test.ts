import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * One card geometry, two jobs for the bottom slot (V3.2).
 *
 * The collection and the catalog draw the same card from the same artwork.
 * What differs is what the silver plate at its foot carries, and that is a
 * product decision rather than an accident:
 *
 *   catalog     "Angebote ab 4,49 €"  /  "Aktuell kein Angebot"
 *   collection  "Entfernen"
 *
 * Commerce belongs to the catalog. A price on every owned figure would turn
 * the showcase into a shop, so this page asks for no offers at all — not one
 * request per card, and not one per page either.
 *
 * What it must never go back to: an `ACTION_CARD` pill in that slot. It is
 * gold-brown, it is 40 px tall in a 29 px row, and gold means ownership
 * (V3.1) — removal is housekeeping, not a state of the collection.
 */
function source(path: string): string {
  return readFileSync(path, "utf8");
}

/** Comments stripped: these files explain themselves in the words searched for. */
function code(path: string): string {
  return source(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const VIEW = "src/components/collection/collection-view.tsx";
const ACTION = "src/components/collection/collection-action.tsx";
const CARD = "src/components/catalog/figure-card.tsx";
const PAGE = "src/app/(app)/collection/page.tsx";

describe("the collection shows no commerce", () => {
  it("the page asks for no offers", () => {
    const page = code(PAGE);
    expect(page).not.toContain("fetchOffers");
    expect(page).not.toContain("offerRecord");
  });

  it("the view neither receives nor renders them", () => {
    const view = code(VIEW);
    expect(view).not.toContain("OfferLink");
    expect(view).not.toContain("offers");
  });

  it("and the catalog still does", () => {
    // The rule is "not here", not "nowhere".
    expect(code("src/components/catalog/catalog-card.tsx")).toContain("OfferLink");
  });
});

describe("the plate carries the one thing this page needs", () => {
  it("the trade slot holds the remove action", () => {
    const view = code(VIEW);
    expect(view).toMatch(/trade=\{\s*<CollectionAction/);
  });

  it("which fills the plate rather than sitting on it", () => {
    // Same shape as the catalog's offer line: it IS the slot, so the card
    // gains no height and the whole plate is the target.
    const action = code(ACTION);
    expect(action).toContain("flex h-full w-full items-center justify-center");
    expect(action).toContain("text-[clamp(9px,4.8cqw,11px)]");
  });

  it("in the same near-black the catalog's buyable line uses — from one constant", () => {
    // Imported, not retyped: two hexes that must agree are one hex.
    const action = code(ACTION);
    expect(action).toContain("INK_OFFER");
    expect(action).toContain("@/components/shop/offer-link");
    expect(action).toContain("style={{ color: INK_OFFER }}");
    expect(action).not.toMatch(/text-\[#[0-9a-f]{6}\]/);
  });

  it("sits vertically inside the plate, not on its top edge", () => {
    /*
     * The bug: the button carried `h-full` inside a bare `<div>`, so it
     * resolved against a parent of `height: auto` — its own content height —
     * and collapsed to the top of the slot. `OfferLink` has no wrapper at
     * all, which is why the catalog never showed it.
     */
    const action = code(ACTION);
    expect(action).toContain('<div className="relative h-full w-full">');
    expect(action).not.toMatch(/<div>\s*\n\s*<button/);
  });

  it("brings nothing that could break out of the slot", () => {
    const action = code(ACTION);
    for (const breaker of ["min-h-", "translate-", "-mt-", "-mb-", "absolute inset-0", "h-screen"]) {
      expect(action, `${breaker} would leave the slot`).not.toContain(breaker);
    }
    // The failure notice is the one thing out of flow — deliberately, so it
    // cannot make the wrapper taller than the plate.
    expect(action).toContain("absolute inset-x-0 top-full");
  });

  it("fills the plate, so the whole plate is the target", () => {
    expect(code(ACTION)).toContain("flex h-full w-full items-center justify-center");
  });

  it("and never in the gold-brown card pill again", () => {
    const action = code(ACTION);
    expect(action).not.toContain("ACTION_CARD");
    expect(action).not.toContain("ACTION_OWNED");
    for (const gold of ["gold", "own-ink", "own-line"]) {
      expect(action, `${gold} belongs to ownership`).not.toContain(gold);
    }
  });

  it("keeps its failure message", () => {
    const action = code(ACTION);
    expect(action).toContain("de.collection.removeFailed");
    expect(action).toContain('role="alert"');
  });
});

describe("an owned figure is gold on both pages", () => {
  /**
   * The regression this exists to stop: `/collection` rendered the neutral
   * ivory template for figures that are, by definition, owned. The same
   * figure was gold in the catalog — one figure, two answers to the question
   * the colour exists to answer.
   *
   * The cause was not a lost prop. `marksOwnership(ownership, collected)`
   * returns true only for `ownership === "catalog"`, and the collection card
   * kept the default `showcase`, which suppresses the frame on purpose
   * (ADR-0038). V3.2 overrules that rule; these hold the new one.
   */
  const CARD_RULE = "src/lib/catalog/card.ts";

  it("the collection asks for the ownership answer at all", () => {
    const view = code(VIEW);
    expect(view).toContain('ownership="catalog"');
    expect(view).not.toContain('ownership="showcase"');
  });

  it("and answers it from the live quantity", () => {
    // Not a constant `true`: a figure removed on this page has to drop the
    // frame in the same frame it drops out of the collection.
    expect(code(VIEW)).toContain("collected={row.quantity > 0}");
  });

  it("through the same rule the catalog uses, not a copy of it", () => {
    const rule = code(CARD_RULE);
    expect(rule).toContain("export function marksOwnership");
    // One decision, one function, both callers.
    expect(code("src/components/catalog/figure-card.tsx")).toContain("marksOwnership(ownership, collected)");
    expect(code("src/components/catalog/catalog-card.tsx")).toContain('ownership="catalog"');
  });

  it("and therefore the same template, chosen in one place", () => {
    const card = code("src/components/catalog/figure-card.tsx");
    expect(card).toContain("const template = artworkFor(figure.cardType);");
    // The collection must not reach for the artwork itself.
    expect(code(VIEW)).not.toContain("TEMPLATE");
    expect(code(VIEW)).not.toContain("CARD_ARTWORK");
  });

  it("with no gold of the collection's own anywhere", () => {
    /*
     * The wrong fix would have been to paint the collection card gold. Then
     * the two pages would agree by coincidence until one of them changed.
     */
    const view = code(VIEW);
    for (const goldish of ["own-ink", "own-line", "own-ground", "gold-line", "ACTION_OWN", "#e0a44a"]) {
      expect(view, `${goldish} would be a second source of the frame`).not.toContain(goldish);
    }
  });
});

describe("the card gained no machinery it no longer needs", () => {
  it("has no overlay slot", () => {
    /*
     * It existed for one caller — the remove chip on the picture — and that
     * caller is gone. A slot nobody fills is a shape the next person has to
     * reason about.
     */
    expect(code(CARD)).not.toContain("overlayAction");
  });

  it("still keeps the trade row outside its own link", () => {
    // The property that made the slot work in the first place: `body` is
    // wrapped in a <Link>, and a <button> inside an <a> is invalid.
    const card = code(CARD);
    const sibling = card.slice(card.indexOf("pointer-events-none absolute inset-0 grid"));
    expect(sibling).toContain("pointer-events-auto");
    expect(sibling).toContain('area="trade"');

    const body = card.slice(card.indexOf("const body = ("), card.indexOf("const bodyClass"));
    expect(body).not.toContain('area="trade"');
  });
});
