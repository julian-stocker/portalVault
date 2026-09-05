import { describe, expect, it } from "vitest";

import type { CatalogFigure, CollectionEntry, SeriesOption } from "@/lib/catalog/types";
import { collectionStats } from "./stats.ts";
import {
  buildCollectionRows,
  filterCollection,
  matchesStatus,
  ownedEntries,
  seriesProgress,
} from "./view.ts";

function figure(
  skyId: string,
  overrides: Partial<CatalogFigure> = {},
): CatalogFigure {
  return {
    skyId,
    name: skyId,
    slug: skyId.toLowerCase(),
    seriesCode: "SA",
    seriesLabel: "Spyro's Adventure",
    seriesPosition: 0,
    categoryPosition: 0,
    categoryName: "Figuren",
    displayName: skyId,
    sortBaseName: skyId,
    sortVariantLabel: null,
    searchIndex: skyId.toLowerCase(),
    marketPrice: 10,
    imageFile: null,
    isActive: true,
    element: null,
    characterId: null,
    ...overrides,
  };
}

function entry(figureValue: CatalogFigure, quantity: number): CollectionEntry {
  return { figure: figureValue, quantity };
}

const SERIES: SeriesOption[] = [
  { code: "SA", label: "Spyro's Adventure", position: 0 },
  { code: "G", label: "Giants", position: 1 },
];

describe("buildCollectionRows", () => {
  it("gives every catalog figure a row, missing ones at zero", () => {
    const catalog = [figure("SKY-0001"), figure("SKY-0002"), figure("SKY-0003")];
    const rows = buildCollectionRows(catalog, [entry(catalog[1], 2)]);

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.quantity)).toEqual([0, 2, 0]);
    expect(rows.map((row) => row.initialQuantity)).toEqual([0, 2, 0]);
  });

  it("keeps an owned figure the catalog no longer offers", () => {
    // Something already owned must not vanish because it left the catalog.
    const retired = figure("SKY-9000", { isActive: false });
    const rows = buildCollectionRows([figure("SKY-0001")], [entry(retired, 1)]);

    expect(rows).toHaveLength(2);
    expect(rows[1].figure.skyId).toBe("SKY-9000");
    expect(rows[1].quantity).toBe(1);
  });

  it("gives an owned console game no card — it is not part of the catalog", () => {
    // ADR-0029: software is outside the collector surface entirely. It is not
    // lost, it is reported in the overview as nonCollectibleOwned.
    const game = figure("SKY-9001", { categoryName: "Spiele" });
    const rows = buildCollectionRows([figure("SKY-0001")], [entry(game, 1)]);

    expect(rows).toHaveLength(1);
    expect(rows[0].figure.skyId).toBe("SKY-0001");
    expect(collectionStats([entry(game, 1)], 561).nonCollectibleOwned).toBe(1);
  });

  it("does not duplicate a figure that is both owned and in the catalog", () => {
    const one = figure("SKY-0001");
    const rows = buildCollectionRows([one], [entry(one, 3)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(3);
  });
});

describe("the four filters", () => {
  const catalog = [figure("SKY-0001"), figure("SKY-0002"), figure("SKY-0003")];
  const rows = buildCollectionRows(catalog, [entry(catalog[0], 1), entry(catalog[1], 3)]);

  it("shows everything under 'all'", () => {
    expect(filterCollection(rows, "all")).toHaveLength(3);
  });

  it("'owned' is quantity at least one", () => {
    expect(filterCollection(rows, "owned").map((row) => row.figure.skyId)).toEqual([
      "SKY-0001",
      "SKY-0002",
    ]);
  });

  it("'missing' is quantity zero", () => {
    expect(filterCollection(rows, "missing").map((row) => row.figure.skyId)).toEqual(["SKY-0003"]);
  });

  it("'duplicates' is quantity above one — never one", () => {
    expect(filterCollection(rows, "duplicates").map((row) => row.figure.skyId)).toEqual([
      "SKY-0002",
    ]);
  });

  it("owned and missing together are the whole collection", () => {
    const owned = filterCollection(rows, "owned").length;
    const missing = filterCollection(rows, "missing").length;
    expect(owned + missing).toBe(rows.length);
  });

  it("a duplicate is also owned, never missing", () => {
    const duplicate = rows.find((row) => row.quantity === 3)!;
    expect(matchesStatus(duplicate, "owned")).toBe(true);
    expect(matchesStatus(duplicate, "missing")).toBe(false);
  });
});

describe("statistics over the rows", () => {
  it("counts a SKY-ID once for completion, however many copies", () => {
    // Three Drobots are one figure out of the catalog, not three.
    const catalog = [figure("SKY-0001"), figure("SKY-0002")];
    const rows = buildCollectionRows(catalog, [entry(catalog[0], 3)]);
    const stats = collectionStats(ownedEntries(rows), 561);

    expect(stats.distinctFigures).toBe(1);
    expect(stats.countedFigures).toBe(1);
    expect(stats.totalPieces).toBe(3);
    expect(stats.progress).toBeCloseTo(1 / 561);
  });

  it("counts every copy for the value", () => {
    const one = figure("SKY-0001", { marketPrice: 12.5 });
    const stats = collectionStats([entry(one, 4)], 561);
    expect(stats.estimatedValue).toBe(50);
  });

  it("leaves a figure without a market price out of the sum, never at zero", () => {
    const priced = figure("SKY-0001", { marketPrice: 10 });
    const unpriced = figure("SKY-0002", { marketPrice: null });
    const stats = collectionStats([entry(priced, 2), entry(unpriced, 5)], 561);

    expect(stats.estimatedValue).toBe(20);
    expect(stats.withoutPrice).toBe(1);
    expect(stats.distinctFigures).toBe(2);
  });

  it("excludes software from every number", () => {
    const game = figure("SKY-9001", { categoryName: "Spiele", marketPrice: 60 });
    const stats = collectionStats([entry(figure("SKY-0001"), 1), entry(game, 1)], 561);

    expect(stats.distinctFigures).toBe(1);
    expect(stats.estimatedValue).toBe(10);
    expect(stats.nonCollectibleOwned).toBe(1);
  });

  it("keeps an inactive figure out of completion but not out of the collection", () => {
    // The denominator counts active collectibles, so counting an inactive one
    // in the numerator could push completion past 100 %.
    const retired = figure("SKY-9000", { isActive: false, marketPrice: 30 });
    const stats = collectionStats([entry(figure("SKY-0001"), 1), entry(retired, 1)], 561);

    expect(stats.distinctFigures).toBe(2);
    expect(stats.countedFigures).toBe(1);
    expect(stats.progress).toBeCloseTo(1 / 561);
    expect(stats.inactiveOwned).toBe(1);
    expect(stats.estimatedValue).toBe(40); // owned is owned — the value still counts it
  });

  it("an empty collection is all zeroes, never NaN", () => {
    const stats = collectionStats([], 561);
    expect(stats).toMatchObject({
      distinctFigures: 0,
      countedFigures: 0,
      totalPieces: 0,
      progress: 0,
      estimatedValue: 0,
    });
    expect(Number.isNaN(stats.progress)).toBe(false);
  });

  it("an empty catalog does not divide by zero", () => {
    expect(collectionStats([], 0).progress).toBe(0);
  });

  it("a complete collection is exactly 100 %, even with duplicates", () => {
    const catalog = [figure("SKY-0001"), figure("SKY-0002"), figure("SKY-0003")];
    const rows = buildCollectionRows(
      catalog,
      catalog.map((one, index) => entry(one, index + 2)),
    );
    const stats = collectionStats(ownedEntries(rows), catalog.length);

    expect(stats.progress).toBe(1);
    expect(stats.totalPieces).toBe(9);
    expect(filterCollection(rows, "missing")).toEqual([]);
  });
});

describe("seriesProgress", () => {
  const catalog = [
    figure("SKY-0001", { seriesCode: "SA" }),
    figure("SKY-0002", { seriesCode: "SA" }),
    figure("SKY-0003", { seriesCode: "G", seriesLabel: "Giants" }),
  ];

  it("counts owned against the size of each series", () => {
    const rows = buildCollectionRows(catalog, [entry(catalog[0], 2)]);
    const progress = seriesProgress(rows, SERIES);

    expect(progress[0]).toMatchObject({ code: "SA", owned: 1, total: 2, ratio: 0.5 });
    expect(progress[1]).toMatchObject({ code: "G", owned: 0, total: 1, ratio: 0 });
  });

  it("counts a duplicate once", () => {
    const rows = buildCollectionRows(catalog, [entry(catalog[0], 9)]);
    expect(seriesProgress(rows, SERIES)[0].owned).toBe(1);
  });

  it("leaves software and inactive figures out of both sides", () => {
    const withExtras = [
      ...catalog,
      figure("SKY-0004", { seriesCode: "SA", categoryName: "Spiele" }),
      figure("SKY-0005", { seriesCode: "SA", isActive: false }),
    ];
    const rows = buildCollectionRows(withExtras, []);
    expect(seriesProgress(rows, SERIES)[0].total).toBe(2);
  });

  it("reports zero rather than NaN for a series with nothing in it", () => {
    const progress = seriesProgress([], SERIES);
    expect(progress.every((entryValue) => entryValue.ratio === 0)).toBe(true);
    expect(progress.every((entryValue) => !Number.isNaN(entryValue.ratio))).toBe(true);
  });

  it("never exceeds 100 %", () => {
    const rows = buildCollectionRows(catalog, catalog.map((one) => entry(one, 5)));
    for (const entryValue of seriesProgress(rows, SERIES)) {
      expect(entryValue.ratio).toBeLessThanOrEqual(1);
    }
  });
});

describe("the undo contract", () => {
  it("a removed row keeps the quantity it had, so undo can restore it", () => {
    // The V1.5 bug: remove deleted the whole row and undo re-inserted one.
    // `initialQuantity` is what the button sends back.
    const one = figure("SKY-0001");
    const rows = buildCollectionRows([one], [entry(one, 4)]);
    const removed = { ...rows[0], quantity: 0 };

    expect(removed.initialQuantity).toBe(4);
    expect(matchesStatus(removed, "missing")).toBe(true);

    const restored = { ...removed, quantity: removed.initialQuantity };
    expect(restored.quantity).toBe(4);
    expect(matchesStatus(restored, "duplicates")).toBe(true);
  });
});
