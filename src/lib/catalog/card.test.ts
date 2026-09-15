import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { duplicateBadge, marksOwnership } from "@/lib/catalog/card";

/**
 * Which question a card answers about ownership.
 *
 * Until V3.3 this file also held the card's whole SURFACE: the ivory ground,
 * the gold leaf, the struck frame, the sparkle. All of that is painted into
 * `designs/cards/silver.png` and `gold.png` now, so the assertions about it
 * went with the CSS — `figure-card-v3.test.ts` holds the template instead.
 *
 * What is left is the rule that never was a visual matter: the catalog marks
 * ownership and the collection does not, because a frame on every card in a
 * collection would mark nothing (ADR-0038).
 */
describe("the ownership question belongs to the catalog", () => {
  it("marks an owned figure in the catalog", () => {
    expect(marksOwnership("catalog", true)).toBe(true);
  });

  it("marks nothing in the showcase, where everything is owned", () => {
    expect(marksOwnership("showcase", true)).toBe(false);
    expect(marksOwnership("showcase", false)).toBe(false);
  });

  it("marks nothing a collector does not have", () => {
    expect(marksOwnership("catalog", false)).toBe(false);
  });

  it("decides which template is drawn, and nothing else", () => {
    const card = readFileSync("src/components/catalog/figure-card.tsx", "utf8");
    expect(card).toContain("const owned = marksOwnership(ownership, collected)");
    // V3.5: the question is unchanged and its answer picks between the
    // ownership artwork and the figure's own card type — nothing else.
    /*
     * Fix round 2: the question is unchanged, and one function answers it.
     * Which card is drawn depends on the type; whether ownership changes that
     * card is a switch in `card-template.ts`, currently off.
     */
    expect(card).toContain("const template = artworkFor(figure.cardType, owned);");
    expect(card).not.toContain("TEMPLATE.owned");
    expect(card).not.toContain("COLLECTION_ARTWORK");
  });
});

describe("the copies badge", () => {
  it("never says 1×, because that is every card in a collection", () => {
    expect(duplicateBadge(1)).toBeNull();
    expect(duplicateBadge(undefined)).toBeNull();
    expect(duplicateBadge(0)).toBeNull();
  });

  it("says the number above one", () => {
    expect(duplicateBadge(2)).toBe(2);
    expect(duplicateBadge(7)).toBe(7);
  });
});
