import { describe, expect, it } from "vitest";

import { cardSurfaceClass, duplicateBadge, marksOwnership } from "./card.ts";

describe("the ownership frame is a catalog answer", () => {
  it("frames an owned figure in the catalog", () => {
    // The catalog grid mixes owned and missing, so the frame answers
    // "do I already have this one?" (ADR-0038).
    expect(marksOwnership("catalog", true)).toBe(true);
    expect(cardSurfaceClass("catalog", true)).toContain("ring-accent");
  });

  it("leaves a missing figure in the catalog neutral", () => {
    expect(marksOwnership("catalog", false)).toBe(false);
    expect(cardSurfaceClass("catalog", false)).not.toContain("ring-accent");
    expect(cardSurfaceClass("catalog", false)).toContain("bg-surface");
  });

  it("never frames a card in the showcase, owned or not", () => {
    // Everything in /collection is owned, so a frame would mark every card
    // identically and water down what it means in the catalog.
    for (const collected of [true, false]) {
      expect(marksOwnership("showcase", collected)).toBe(false);
      expect(cardSurfaceClass("showcase", collected)).not.toContain("ring-accent");
      expect(cardSurfaceClass("showcase", collected)).not.toContain("accent-subtle");
    }
  });

  it("gives the collection and the catalog the same neutral ground", () => {
    expect(cardSurfaceClass("showcase", true)).toBe(cardSurfaceClass("catalog", false));
  });
});

describe("the duplicate badge", () => {
  it("stays out of the way for a single copy", () => {
    // In the showcase every card is owned; a "1×" on all of them says nothing.
    expect(duplicateBadge(1)).toBeNull();
    expect(duplicateBadge(0)).toBeNull();
    expect(duplicateBadge(undefined)).toBeNull();
  });

  it("shows the count above one — including in the showcase", () => {
    expect(duplicateBadge(2)).toBe(2);
    expect(duplicateBadge(11)).toBe(11);
  });
});
