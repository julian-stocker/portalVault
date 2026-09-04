import { describe, expect, it } from "vitest";

import { collectionStats } from "./stats.ts";
import type { CatalogFigure, CollectionEntry } from "@/lib/catalog/types";

function entry(price: number | null, quantity = 1, isActive = true): CollectionEntry {
  const figure: CatalogFigure = {
    skyId: "SKY-0001",
    name: "Drobot",
    slug: "drobot",
    seriesCode: "SA",
    seriesLabel: "Spyro's Adventure",
    seriesPosition: 0,
    categoryPosition: 0,
    marketPrice: price,
    imageFile: null,
    isActive,
  };
  return { figure, quantity };
}

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

  it("counts owned figures that are no longer active", () => {
    // They must not disappear from a collection silently.
    const stats = collectionStats([entry(10, 1, false), entry(10, 1, true)], 600);
    expect(stats.inactiveOwned).toBe(1);
    expect(stats.distinctFigures).toBe(2);
  });
});
