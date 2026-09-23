import { describe, expect, it } from "vitest";

import { collectionStats } from "./stats.ts";
import type { CatalogFigure, CollectionEntry } from "@/lib/catalog/types";

function entry(
  price: number | null,
  quantity = 1,
  isActive = true,
  categoryName = "Figuren",
): CollectionEntry {
  const figure: CatalogFigure = {
    skyId: "SKY-0001",
    name: "Drobot",
    slug: "drobot",
    seriesCode: "SA",
    seriesLabel: "Spyro's Adventure",
    seriesPosition: 0,
    categoryPosition: 0,
    categoryName,
    categoryId: 1,
    catalogGroup: "figure",
    cardType: "standard",
    catalogVisible: true,
    canonicalName: "Drobot",
    displayNameOverride: null,
    marketPrice: price,
    imageFile: null,
    imageOverridePath: null,
    displayName: "Drobot",
    sortBaseName: "Drobot",
    sortVariantLabel: null,
    searchIndex: "drobot",
    isActive,
    element: null,
    characterId: null,
  };
  return { figure, quantity };
}

/** Mirrors what CollectionView does when a card is removed optimistically. */
function withoutFigures(entries: CollectionEntry[], removed: ReadonlySet<number>): CollectionEntry[] {
  return entries.filter((_, index) => !removed.has(index));
}

describe("statistics after removing a figure", () => {
  it("drops count, pieces, progress and value together", () => {
    const entries = [entry(10), entry(20, 2), entry(5)];
    const before = collectionStats(entries, 561);
    expect(before).toMatchObject({ distinctFigures: 3, totalPieces: 4, estimatedValue: 55 });

    const after = collectionStats(withoutFigures(entries, new Set([1])), 561);
    expect(after.distinctFigures).toBe(2);
    expect(after.totalPieces).toBe(2);
    expect(after.estimatedValue).toBe(15);
    expect(after.progress).toBeCloseTo(2 / 561);
    expect(after.progress).toBeLessThan(before.progress);
  });

  it("removing a priceless figure lowers the count but not the value", () => {
    const entries = [entry(10), entry(null)];
    const before = collectionStats(entries, 561);
    expect(before).toMatchObject({ distinctFigures: 2, estimatedValue: 10, withoutPrice: 1 });

    const after = collectionStats(withoutFigures(entries, new Set([1])), 561);
    expect(after.distinctFigures).toBe(1);
    expect(after.estimatedValue).toBe(10);
    // The note about priceless figures disappears with the last one.
    expect(after.withoutPrice).toBe(0);
  });

  it("removing a figure held more than once removes all of its pieces", () => {
    // V1.5 deletes the whole row; there is no quantity control yet.
    const entries = [entry(12.5, 4), entry(10)];
    expect(collectionStats(entries, 561)).toMatchObject({ totalPieces: 5, estimatedValue: 60 });

    const after = collectionStats(withoutFigures(entries, new Set([0])), 561);
    expect(after.totalPieces).toBe(1);
    expect(after.estimatedValue).toBe(10);
    expect(after.distinctFigures).toBe(1);
  });

  it("removing an inactive figure works and clears its note", () => {
    const entries = [entry(10, 1, false), entry(10)];
    expect(collectionStats(entries, 561).inactiveOwned).toBe(1);

    const after = collectionStats(withoutFigures(entries, new Set([0])), 561);
    expect(after.inactiveOwned).toBe(0);
    expect(after.distinctFigures).toBe(1);
  });

  it("removing the last figure returns to the empty state", () => {
    const after = collectionStats(withoutFigures([entry(10)], new Set([0])), 561);
    expect(after).toMatchObject({
      distinctFigures: 0,
      totalPieces: 0,
      progress: 0,
      estimatedValue: 0,
      withoutPrice: 0,
    });
  });

  it("undoing a removal restores the numbers exactly", () => {
    const entries = [entry(10), entry(20)];
    const full = collectionStats(entries, 561);
    const reduced = collectionStats(withoutFigures(entries, new Set([0])), 561);
    const restored = collectionStats(withoutFigures(entries, new Set()), 561);
    expect(reduced.estimatedValue).toBe(20);
    expect(restored).toEqual(full);
  });
});

describe("collectionStats", () => {
  it("counts distinct figures and total pieces separately", () => {
    const stats = collectionStats([entry(10, 3), entry(5, 2)], 600);
    expect(stats.distinctFigures).toBe(2);
    expect(stats.totalPieces).toBe(5);
  });

  it("multiplies price by quantity, even though V1.5 has no quantity UI", () => {
    expect(collectionStats([entry(12.5, 4)], 600).estimatedValue).toBe(50);
  });

  it("excludes figures without a price and reports them separately", () => {
    const stats = collectionStats([entry(10), entry(null), entry(null, 2)], 600);
    expect(stats.estimatedValue).toBe(10);
    expect(stats.withoutPrice).toBe(2);
  });

  it("rounds to cents rather than accumulating float noise", () => {
    const stats = collectionStats([entry(0.1), entry(0.2)], 600);
    expect(stats.estimatedValue).toBe(0.3);
  });

  it("reports progress as a fraction", () => {
    expect(collectionStats([entry(1), entry(1), entry(1)], 600).progress).toBeCloseTo(0.005);
  });

  it("returns zero progress rather than NaN for an empty catalog", () => {
    expect(collectionStats([entry(1)], 0).progress).toBe(0);
  });

  it("handles an empty collection", () => {
    const stats = collectionStats([], 600);
    expect(stats).toMatchObject({
      distinctFigures: 0,
      totalPieces: 0,
      progress: 0,
      estimatedValue: 0,
      withoutPrice: 0,
      inactiveOwned: 0,
    });
  });

  it("excludes games from the count, the value and the progress", () => {
    // Someone may own a game; it simply counts towards nothing, because the
    // catalog no longer offers games and 100 % must stay reachable.
    const stats = collectionStats(
      [entry(30, 1, true, "Spiele"), entry(10, 2, true, "Figuren")],
      561,
    );
    expect(stats.nonCollectibleOwned).toBe(1);
    expect(stats.distinctFigures).toBe(1);
    expect(stats.totalPieces).toBe(2);
    expect(stats.estimatedValue).toBe(20);
    expect(stats.progress).toBeCloseTo(1 / 561);
  });

  it("can reach full progress once every collectible figure is owned", () => {
    const owned = Array.from({ length: 561 }, () => entry(1));
    expect(collectionStats(owned, 561).progress).toBe(1);
  });

  it("counts owned figures that are no longer active", () => {
    // They must not disappear from a collection silently.
    const stats = collectionStats([entry(10, 1, false), entry(10, 1, true)], 600);
    expect(stats.inactiveOwned).toBe(1);
    expect(stats.distinctFigures).toBe(2);
  });
});

/* ===================================================================== */
/**
 * DIE SAMMLUNG WIRD MIT DEM BEWERTET, WAS DER KATALOG SAGT (0094, ADR-0105).
 *
 * Der gespeicherte `market_price` bleibt kanonisch — Shoppreis, Buy-in-Faktor,
 * Snapshots und die ganze Geschäftsseite rechnen weiter mit ihm. Die Sammlung
 * ist aber eine Bewertung für denselben Nutzer, der die Karten sieht, und
 * müsste sonst der Zahl auf der Karte widersprechen.
 *
 * Die Reihenfolge ist der Kern: ERST den Einzelwert auf Cent runden, DANN mit
 * der Menge multiplizieren. 4,99 € bei 5 % ist 5,24 € auf der Karte, also sind
 * drei Stück 15,72 € — nicht 4,99 × 3 × 1,05.
 */
describe("the collection follows the catalog's market value", () => {
  it("values one copy at the boosted unit price", () => {
    expect(collectionStats([entry(10)], 1, 5).estimatedValue).toBe(10.5);
    expect(collectionStats([entry(4.99)], 1, 5).estimatedValue).toBe(5.24);
    expect(collectionStats([entry(16.65)], 1, 7.5).estimatedValue).toBe(17.9);
  });

  it("rounds the unit first and multiplies afterwards", () => {
    // 4.99 → 5.24 auf der Karte, drei Stück also 15.72.
    expect(collectionStats([entry(4.99, 3)], 1, 5).estimatedValue).toBe(15.72);
    // Und nicht 4.99 * 3 * 1.05 = 15.7185 — hier zufällig gleich gerundet,
    // deshalb ein Fall, in dem sich die beiden Wege unterscheiden:
    expect(collectionStats([entry(0.89, 7)], 1, 5).estimatedValue).toBe(6.51);   // 0.93 * 7
    expect(Number((0.89 * 7 * 1.05).toFixed(2))).toBe(6.54);                     // der falsche Weg
  });

  it("boost 0 is exactly what the collection was worth before", () => {
    const entries = [entry(10, 2), entry(4.99, 3), entry(0.89, 7)];
    expect(collectionStats(entries, 1, 0).estimatedValue)
      .toBe(collectionStats(entries, 1).estimatedValue);
    expect(collectionStats(entries, 1, 0).estimatedValue).toBe(20 + 14.97 + 6.23);
  });

  it("a figure without a price stays out of the sum, boosted or not", () => {
    const stats = collectionStats([entry(null, 4), entry(10, 1)], 1, 5);
    expect(stats.withoutPrice).toBe(1);
    expect(stats.estimatedValue).toBe(10.5);
    // Never 0 EUR for the unknown one (ADR-0010).
    expect(collectionStats([entry(null, 4)], 1, 5).estimatedValue).toBe(0);
    expect(collectionStats([entry(null, 4)], 1, 5).withoutPrice).toBe(1);
  });

  it("counts pieces and figures exactly as before — only the value moves", () => {
    const entries = [entry(10, 2), entry(null, 3)];
    const plain = collectionStats(entries, 5);
    const boosted = collectionStats(entries, 5, 7.5);
    expect(boosted.distinctFigures).toBe(plain.distinctFigures);
    expect(boosted.countedFigures).toBe(plain.countedFigures);
    expect(boosted.totalPieces).toBe(plain.totalPieces);
    expect(boosted.progress).toBe(plain.progress);
    expect(boosted.withoutPrice).toBe(plain.withoutPrice);
    expect(boosted.estimatedValue).toBeGreaterThan(plain.estimatedValue);
  });
});
