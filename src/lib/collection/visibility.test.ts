import { describe, expect, it } from "vitest";

import type { CatalogFigure, CollectionEntry } from "@/lib/catalog/types";
import { collectionStats } from "@/lib/collection/stats";
import {
  COLLECTION_ALL,
  buildCollectionRows,
  groupBySeries,
  segmentSummary,
} from "@/lib/collection/view";

/**
 * What hiding a figure does to the numbers (ADR-0040).
 *
 * The rule, decided rather than derived: a figure an administrator has taken
 * out of the public catalog counts in **neither** half of the completion
 * fraction. It stays in the collection, it stays in the collection's value,
 * and it can never make "owned" exceed "total".
 */
function figure(skyId: string, overrides: Partial<CatalogFigure> = {}): CatalogFigure {
  return {
    skyId,
    name: skyId,
    slug: skyId.toLowerCase(),
    seriesCode: "SA",
    seriesLabel: "Spyro's Adventure",
    seriesPosition: 0,
    categoryPosition: 0,
    categoryName: "Figuren",
    categoryId: 1,
    catalogGroup: "figure",
    displayName: skyId,
    sortBaseName: skyId,
    sortVariantLabel: null,
    searchIndex: skyId.toLowerCase(),
    marketPrice: 10,
    imageFile: null,
    isActive: true,
    catalogVisible: true,
    canonicalName: skyId,
    displayNameOverride: null,
    element: null,
    characterId: null,
    ...overrides,
  };
}

const entry = (f: CatalogFigure, quantity = 1): CollectionEntry => ({ figure: f, quantity });

describe("a hidden figure and the completion fraction", () => {
  const visible = figure("SKY-0001");
  const hidden = figure("SKY-0002", { catalogVisible: false, marketPrice: 30 });

  it("counts in neither the numerator nor the denominator", () => {
    // The denominator comes from the database and already excludes hidden
    // rows; the numerator must exclude them too, or the two halves would be
    // counting different sets.
    const rows = buildCollectionRows([entry(visible), entry(hidden)]);
    const summary = segmentSummary(rows, COLLECTION_ALL, { total: 1, bySeries: { SA: 1 } });

    expect(summary.owned).toBe(1);
    expect(summary.total).toBe(1);
    expect(summary.ratio).toBe(1);
  });

  it("can never produce owned > total", () => {
    // The case the decision exists for: everything owned, half of it hidden.
    const rows = buildCollectionRows([entry(visible), entry(hidden)]);
    const summary = segmentSummary(rows, COLLECTION_ALL, { total: 1, bySeries: { SA: 1 } });
    expect(summary.owned).toBeLessThanOrEqual(summary.total);
    expect(summary.missing).toBe(0);
  });

  it("still counts towards the collection's value", () => {
    // Owning it is owning it. Only the fraction changes, not the worth.
    const rows = buildCollectionRows([entry(visible), entry(hidden, 2)]);
    const summary = segmentSummary(rows, COLLECTION_ALL, { total: 1, bySeries: { SA: 1 } });
    expect(summary.value).toBe(10 + 2 * 30);
  });

  it("keeps its row, so the collection still shows it", () => {
    const rows = buildCollectionRows([entry(hidden)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].figure.skyId).toBe("SKY-0002");
  });

  it("leaves a series section's progress consistent", () => {
    const rows = buildCollectionRows([entry(visible), entry(hidden)]);
    const sections = groupBySeries(rows, rows, [{ code: "SA", label: "Spyro's Adventure" }], {
      total: 1,
      bySeries: { SA: 1 },
    });
    expect(sections[0]).toMatchObject({ owned: 1, total: 1, ratio: 1 });
  });
});

describe("collectionStats and hidden figures", () => {
  it("keeps them out of the progress but inside the value", () => {
    const stats = collectionStats(
      [entry(figure("SKY-0001")), entry(figure("SKY-0002", { catalogVisible: false }))],
      1,
    );
    expect(stats.distinctFigures).toBe(2);
    expect(stats.countedFigures).toBe(1);
    expect(stats.progress).toBe(1);
    expect(stats.estimatedValue).toBe(20);
  });

  it("reports them, so a number nobody can explain does not appear", () => {
    const stats = collectionStats([entry(figure("SKY-0002", { catalogVisible: false }))], 10);
    expect(stats.hiddenOwned).toBe(1);
  });

  it("treats a hidden figure like an inactive one, and counts both apart", () => {
    const stats = collectionStats(
      [
        entry(figure("SKY-0001", { isActive: false })),
        entry(figure("SKY-0002", { catalogVisible: false })),
      ],
      10,
    );
    expect(stats.countedFigures).toBe(0);
    expect(stats.inactiveOwned).toBe(1);
    expect(stats.hiddenOwned).toBe(1);
  });

  it("never lets progress exceed 100 %", () => {
    const owned = [
      entry(figure("SKY-0001")),
      entry(figure("SKY-0002", { catalogVisible: false })),
      entry(figure("SKY-0003", { catalogVisible: false })),
    ];
    expect(collectionStats(owned, 1).progress).toBe(1);
  });
});
