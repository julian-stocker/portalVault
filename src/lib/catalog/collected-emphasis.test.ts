/**
 * Owned and not owned, told apart (V4.6).
 *
 * A figure the collector has is drawn at full size on its full card design.
 * One they do not have is drawn a hair smaller, on a shell with the colour
 * taken out of it — and on NOTHING ELSE. The picture, the name, the variant
 * seal, MARKTWERT, the price, the element and the offer row stay exactly as
 * they are, at full contrast.
 *
 * WHAT THESE TESTS GUARD
 *
 * Two promises that are easy to break by accident:
 *
 *   1. The treatment reaches the shell and only the shell. It is applied to
 *      one element — the template artwork — so the guarantee is structural;
 *      these tests make it a failing build if a second element picks it up
 *      or a content layer starts reacting to ownership.
 *
 *   2. The size difference is paint, never layout. A width, a margin or a
 *      padding would re-measure the grid column and shift every other card
 *      in the row. A transform cannot.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { marksOwnership, understatesCard, UNCOLLECTED_SCALE } from "./card";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** A comment that NAMES a property is not that property. */
const code = (text: string) => text
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/^\s*\/\/.*$/gm, "");

const CARD = read("src/components/catalog/figure-card.tsx");
const CARD_CODE = code(CARD);
const CATALOG_CARD = read("src/components/catalog/catalog-card.tsx");
const CATALOG_CARD_CODE = code(CATALOG_CARD);
const CSS = read("src/app/globals.css");

const SHELL_CLASS = "card-shell-unowned";

describe("which surfaces rank a card by ownership", () => {
  it("only the catalog, and only when it knows the collection", () => {
    expect(understatesCard("catalog", false, true)).toBe(true);
    expect(understatesCard("catalog", true, true)).toBe(false);
  });

  it("says nothing when there is no collection to compare against", () => {
    /*
     * Signed out, and for an administrator, every card would otherwise be
     * understated at once — which tells the viewer nothing about ownership
     * and merely makes the whole grid look faded.
     */
    expect(understatesCard("catalog", false, false)).toBe(false);
    expect(understatesCard("catalog", true, false)).toBe(false);
  });

  it("never touches the figure page's siblings", () => {
    // `showcase` has never marked ownership; it does not start here.
    for (const collected of [true, false]) {
      for (const knows of [true, false]) {
        expect(understatesCard("showcase", collected, knows)).toBe(false);
      }
    }
  });

  it("is not the negation of marksOwnership", () => {
    /*
     * The distinction this module exists for. `marksOwnership` answers "is
     * this owned"; three of five surfaces cannot answer it, and for them the
     * answer is "no" rather than "not owned".
     */
    expect(marksOwnership("catalog", false)).toBe(false);
    expect(understatesCard("catalog", false, false)).toBe(false);
    // They disagree exactly where a surface knows and the figure is missing.
    expect(marksOwnership("catalog", false)).toBe(understatesCard("catalog", false, true) === false);
  });

  it("leaves the collection alone, because everything on it is owned", () => {
    // `/collection` passes `collected={row.quantity > 0}` for rows it holds.
    expect(understatesCard("catalog", true, true)).toBe(false);
  });
});

describe("how much smaller", () => {
  it("is subtle — about one frame width, not a second card size", () => {
    /*
     * Below 0.94 the two states read as two different card sizes, which is
     * the thing that was explicitly not wanted. Above 0.99 nothing is
     * visible at all at a 177 px card.
     */
    expect(UNCOLLECTED_SCALE).toBeGreaterThanOrEqual(0.94);
    expect(UNCOLLECTED_SCALE).toBeLessThanOrEqual(0.99);
  });

  it("moves each edge by about half a frame at every grid width", () => {
    /*
     * The grid renders cards between 177 px (five columns at xl) and 214 px
     * (two columns on a phone). The frame is 5–6 px at those widths, so the
     * edge should move in by 2–4 px: half a frame each side, one frame of
     * difference where two cards meet.
     */
    for (const cardWidth of [177, 190, 211, 214]) {
      const perEdge = (cardWidth * (1 - UNCOLLECTED_SCALE)) / 2;
      expect(perEdge, `${cardWidth}px card`).toBeGreaterThanOrEqual(2);
      expect(perEdge, `${cardWidth}px card`).toBeLessThanOrEqual(6);
    }
  });
});

describe("the grid cannot move", () => {
  it("resizes by transform, never by layout", () => {
    /*
     * THE ONE THING THAT WOULD RUIN THE GRID.
     *
     * A width, a margin, a padding or a scale on the grid item's box are all
     * layout: one shrunken card re-measures its column and every card in the
     * row shifts with it. A transform is paint, so the cell keeps the size
     * it had and the gaps stay identical.
     */
    const applied = CARD_CODE.slice(CARD_CODE.indexOf("understated"));
    expect(applied).toContain("transform: `scale(${UNCOLLECTED_SCALE})`");
    for (const layoutProperty of ["width:", "maxWidth", "margin", "padding", "inset:"]) {
      const guarded = new RegExp(`understated\\s*\\n?\\s*\\?\\s*\\{[^}]*${layoutProperty}`);
      expect(guarded.test(CARD_CODE), layoutProperty).toBe(false);
    }
  });

  it("stands the cards of a row on one line", () => {
    // Bottom-aligned, so the trade rows across a row agree; centred
    // horizontally, so the column reads straight.
    expect(CARD_CODE).toContain('transformOrigin: "center bottom"');
  });

  it("keeps the aspect ratio, so the cell is the same shape either way", () => {
    expect(CARD_CODE).toContain("aspectRatio: CARD_ASPECT");
  });

  it("behaves the same on a phone and a desktop", () => {
    /*
     * No breakpoint anywhere in the treatment: the rule is about ownership,
     * not about width, and a card that shrank only on one of them would be
     * two behaviours to check instead of one.
     */
    const shell = CSS.slice(CSS.indexOf(`.${SHELL_CLASS} {`));
    const rule = shell.slice(0, shell.indexOf("}") + 1);
    expect(rule).not.toContain("@media");
    expect(CARD_CODE).not.toMatch(/understated[^;]*\b(sm|md|lg|xl):/);
  });

  it("adds no animation", () => {
    // Asked for explicitly: the change is instant.
    const applied = CARD_CODE.slice(CARD_CODE.indexOf("const understated"));
    expect(applied).not.toContain("transition");
    expect(applied).not.toContain("animate-");
  });
});

describe("only the shell greys out", () => {
  it("puts the class on exactly one element", () => {
    expect((CARD_CODE.match(new RegExp(SHELL_CLASS, "g")) ?? [])).toHaveLength(1);
  });

  it("and that element is the template artwork, layer 2", () => {
    /*
     * The whole card design is that one PNG — frame, paper, gilding, crown,
     * struck rule and trade plate. Which is what makes "only the design
     * greys out" structural rather than a list of exceptions.
     */
    const img = CARD_CODE.slice(CARD_CODE.indexOf("src={template.src}"));
    const element = img.slice(0, img.indexOf("/>"));
    expect(element).toContain(SHELL_CLASS);
    expect(element).toContain("aria-hidden");
  });

  it("leaves every content layer at full colour and full contrast", () => {
    /*
     * Named one by one, because this is the list the requirement was
     * written as. Each must still be rendered, and none of them may become
     * conditional on ownership.
     */
    const content = [
      "src={picture}",                 // the figure's own picture
      "figure.displayName",            // the name
      "sortVariantLabel",              // the variant seal, e.g. BLUE
      "de.catalog.marketValue",        // MARKTWERT
      "figure.marketPrice",            // the price
      "elementLabel",                  // the element
      "{trade}",                       // the offer row, or "kein Angebot"
    ];
    for (const anchor of content) {
      expect(CARD_CODE.indexOf(anchor), anchor).toBeGreaterThan(-1);
    }

    /*
     * And the proof that none of them can be reached: `understated` occurs
     * exactly three times in the whole component — where it is computed,
     * and the two places it is used. A window around each content anchor
     * would be guesswork; counting the uses is not.
     */
    const uses = CARD_CODE.match(/understated/g) ?? [];
    expect(uses).toHaveLength(3);
    expect(CARD_CODE).toContain("const understated = understatesCard(");
    expect(CARD_CODE).toMatch(/\.\.\.\(understated\s*\n?\s*\?\s*\{ transform:/);
    expect(CARD_CODE).toContain(`(understated ? " ${SHELL_CLASS}" : "")`);
  });

  it("never reaches for opacity, which would dim the content with it", () => {
    /*
     * `muted` — the administrator's hidden figure — does use opacity, and it
     * dims the whole card deliberately. The unowned treatment must not: the
     * text has to stay exactly as readable as an owned card's.
     */
    const applied = CARD_CODE.slice(CARD_CODE.indexOf("const understated"));
    expect(applied).not.toMatch(/understated[^;]*opacity/);
    expect(CSS.slice(CSS.indexOf(`.${SHELL_CLASS} {`)).slice(0, 200)).not.toContain("opacity");
  });
});

describe("the filter itself", () => {
  const rule = (() => {
    const at = CSS.indexOf(`.${SHELL_CLASS} {`);
    return CSS.slice(at, CSS.indexOf("}", at));
  })();

  it("takes colour out rather than light", () => {
    const saturate = Number(/saturate\(([\d.]+)\)/.exec(rule)![1]);
    expect(saturate).toBeGreaterThan(0);      // not black and white
    expect(saturate).toBeLessThan(0.8);       // and visibly desaturated
  });

  it("barely darkens, so the card still looks expensive", () => {
    /*
     * "Nicht zu stark abdunkeln." Past about 8 % the filter starts pulling
     * the artwork's own contrast down with it, and a desaturated card reads
     * as cheap rather than quiet.
     */
    const brightness = Number(/brightness\(([\d.]+)\)/.exec(rule)?.[1] ?? "1");
    expect(brightness).toBeGreaterThanOrEqual(0.92);
    expect(brightness).toBeLessThanOrEqual(1);
  });

  it("steps aside under forced colours", () => {
    // Filters are discarded there, so the shell would return at full
    // strength while the size difference stayed — half the treatment.
    const forced = CSS.slice(CSS.indexOf("@media (forced-colors: active)",
                                         CSS.indexOf(`.${SHELL_CLASS} {`)));
    expect(forced.slice(0, 120)).toContain(`.${SHELL_CLASS} { filter: none; }`);
  });
});

describe("what the catalog passes", () => {
  it("turns the ranking on for the signed-in card only", () => {
    expect((CATALOG_CARD_CODE.match(/knowsCollection/g) ?? [])).toHaveLength(1);
  });

  /** One `<FigureCard …/>` element, from its tag to its self-closing end. */
  const cardElementAfter = (marker: string): string => {
    const from = CATALOG_CARD_CODE.indexOf(marker);
    expect(from, marker).toBeGreaterThan(-1);
    const open = CATALOG_CARD_CODE.indexOf("<FigureCard", from);
    expect(open, `${marker}: renders a FigureCard`).toBeGreaterThan(-1);
    const end = CATALOG_CARD_CODE.indexOf("/>", open);
    expect(end, `${marker}: self-closing`).toBeGreaterThan(open);
    return CATALOG_CARD_CODE.slice(open, end);
  };

  it("not for an administrator, who does not collect from their own catalog", () => {
    const admin = cardElementAfter("if (admin) {");
    expect(admin).toContain('ownership="catalog"');
    expect(admin).not.toContain("knowsCollection");
  });

  it("not when signed out, where there is no collection yet", () => {
    const signedOut = cardElementAfter("if (signInHref) {");
    expect(signedOut).toContain("href={signInHref}");
    expect(signedOut).not.toContain("knowsCollection");
  });

  it("defaults to off, so a new surface cannot rank by accident", () => {
    expect(CARD).toContain("knowsCollection = false");
  });
});

describe("an owned card is untouched", () => {
  it("gets no transform and no shell class", () => {
    /*
     * Stated as a property of the code rather than a rendering: both are
     * spread from `understated ? … : {}` and gated on the same boolean, so
     * a false there is an empty object and an absent class.
     */
    expect(understatesCard("catalog", true, true)).toBe(false);
    expect(CARD_CODE).toMatch(/\.\.\.\(understated\s*\n?\s*\?/);
    expect(CARD_CODE).toContain(`(understated ? " ${SHELL_CLASS}" : "")`);
  });

  it("keeps the dark-stock ink swap it already had", () => {
    // `legendary` and `dark` still redefine their four ink variables, and
    // that is independent of ownership.
    expect(CARD_CODE).toContain('tone === "dark"');
    expect(CARD_CODE).toContain('"--template-ink": "var(--template-ink-on-dark)"');
    expect(CARD_CODE).toContain('"--trade-ink": "var(--trade-ink-on-dark)"');
  });

  it("keeps the collected seal on the cards that earn it", () => {
    expect(CARD_CODE).toContain("owned");
    expect(CARD).toContain("CollectedSeal");
  });
});
