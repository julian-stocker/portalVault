import { describe, expect, it } from "vitest";

import type { CatalogFigure, CollectionEntry } from "@/lib/catalog/types";
import { collectionStats } from "./stats.ts";
import {
  COLLECTION_ALL,
  COLLECTION_DUPLICATES,
  buildCollectionRows,
  filterCollection,
  matchesCollectionFilter,
  ownedEntries,
  segmentSummary,
  showcaseRows,
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

describe("the showcase holds only what is owned", () => {
  const catalog = [
    figure("SKY-0001"),
    figure("SKY-0002"),
    figure("SKY-0003"),
    figure("SKY-0004", { seriesCode: "G", seriesLabel: "Giants" }),
  ];
  const rows = buildCollectionRows(catalog, [
    entry(catalog[0], 1),
    entry(catalog[1], 3),
    entry(catalog[3], 1),
  ]);

  it("drops every missing figure, whatever the filter says", () => {
    // The point of the catalog/collection split (ADR-0038): a collection
    // page shows a collection. What is missing is a catalog question.
    expect(showcaseRows(rows).map((row) => row.figure.skyId)).toEqual([
      "SKY-0001",
      "SKY-0002",
      "SKY-0004",
    ]);
    expect(showcaseRows(rows).every((row) => row.quantity > 0)).toBe(true);
  });

  it("'Alle' means every owned figure, not every catalog figure", () => {
    const visible = filterCollection(rows, COLLECTION_ALL);
    expect(visible).toHaveLength(3);
    expect(visible.some((row) => row.figure.skyId === "SKY-0003")).toBe(false);
  });

  it("a series filter narrows to that game", () => {
    expect(filterCollection(rows, "G").map((row) => row.figure.skyId)).toEqual(["SKY-0004"]);
    expect(filterCollection(rows, "SA").map((row) => row.figure.skyId)).toEqual([
      "SKY-0001",
      "SKY-0002",
    ]);
  });

  it("'Duplikate' is quantity above one — never one", () => {
    expect(filterCollection(rows, COLLECTION_DUPLICATES).map((row) => row.figure.skyId)).toEqual([
      "SKY-0002",
    ]);
  });

  it("a missing figure matches no filter at all", () => {
    const missing = rows.find((row) => row.figure.skyId === "SKY-0003")!;
    for (const filter of [COLLECTION_ALL, COLLECTION_DUPLICATES, "SA"]) {
      expect(filterCollection([missing], filter)).toEqual([]);
    }
  });

  it("keeps the filter predicate usable for a row the caller decided to keep", () => {
    // The view keeps a just-removed row on screen so undo stays reachable,
    // and asks the predicate separately. Series still matches at quantity 0.
    const removed = { ...rows[0], quantity: 0 };
    expect(matchesCollectionFilter(removed, "SA")).toBe(true);
    expect(matchesCollectionFilter(removed, COLLECTION_ALL)).toBe(true);
    expect(matchesCollectionFilter(removed, COLLECTION_DUPLICATES)).toBe(false);
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
    expect(filterCollection(rows, COLLECTION_ALL)).toHaveLength(3);
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
    // Out of the showcase the moment it is removed — the view keeps the card
    // itself on screen so the undo stays reachable.
    expect(showcaseRows([removed])).toEqual([]);

    const restored = { ...removed, quantity: removed.initialQuantity };
    expect(restored.quantity).toBe(4);
    expect(showcaseRows([restored])).toHaveLength(1);
    expect(matchesCollectionFilter(restored, COLLECTION_DUPLICATES)).toBe(true);
  });
});

describe("what the summary counts", () => {
  it("a game owned but not shown still has to reach the statistics", () => {
    // buildCollectionRows drops software from the showcase (ADR-0029), so
    // feeding only the rows into collectionStats hid the very entries the
    // "these are games" note exists to explain. The view adds them back.
    const game = figure("SKY-9001", { categoryName: "Spiele", marketPrice: 60 });
    const owned = [entry(figure("SKY-0001"), 1), entry(game, 1)];
    const rows = buildCollectionRows([figure("SKY-0001")], owned);

    expect(collectionStats(ownedEntries(rows), 561).nonCollectibleOwned).toBe(0);

    const counted = [...ownedEntries(rows), ...owned.filter((e) => e.figure.categoryName === "Spiele")];
    const stats = collectionStats(counted, 561);
    expect(stats.nonCollectibleOwned).toBe(1);
    expect(stats.distinctFigures).toBe(1);
    expect(stats.estimatedValue).toBe(10); // the game never joins the value
  });
});

describe("segmentSummary — the hero follows the tabs", () => {
  // Two games, priced, plus a game (software) and a retired figure.
  const sa1 = figure("SKY-0001", { marketPrice: 10 });
  const sa2 = figure("SKY-0002", { marketPrice: 5 });
  const sa3 = figure("SKY-0003", { marketPrice: null });
  const g1 = figure("SKY-0100", { seriesCode: "G", seriesLabel: "Giants", marketPrice: 20 });
  const g2 = figure("SKY-0101", { seriesCode: "G", seriesLabel: "Giants", marketPrice: 8 });
  const game = figure("SKY-9001", { categoryName: "Spiele", marketPrice: 60 });
  const retired = figure("SKY-9000", { isActive: false, marketPrice: 30 });

  const catalog = [sa1, sa2, sa3, g1, g2, game];
  const owned = [entry(sa1, 3), entry(sa2, 1), entry(g1, 2), entry(game, 1), entry(retired, 1)];
  const rows = buildCollectionRows(catalog, owned);

  it("'Alle' measures against the catalog count from the database", () => {
    const summary = segmentSummary(rows, COLLECTION_ALL, 561);
    expect(summary).toMatchObject({ kind: "completion", total: 561, missing: 561 - 3 });
    // Three active collectibles owned; the game counts towards nothing and
    // the retired figure is out of the denominator and the numerator.
    expect(summary.kind === "completion" && summary.owned).toBe(3);
  });

  it("'Alle' agrees with collectionStats on the same collection", () => {
    const counted = [...ownedEntries(rows), ...owned.filter((e) => e.figure.categoryName === "Spiele")];
    const stats = collectionStats(counted, 561);
    const summary = segmentSummary(rows, COLLECTION_ALL, 561);
    expect(summary.kind === "completion" && summary.owned).toBe(stats.countedFigures);
    expect(summary.kind === "completion" && summary.value).toBe(stats.estimatedValue);
    expect(summary.kind === "completion" && summary.ratio).toBeCloseTo(stats.progress);
  });

  it("a series segment counts only that game, on both sides of the fraction", () => {
    const summary = segmentSummary(rows, "G", 561);
    // Giants holds two active collectibles; one of them is owned, twice.
    expect(summary).toMatchObject({ kind: "completion", owned: 1, total: 2, missing: 1 });
    expect(summary.kind === "completion" && summary.ratio).toBeCloseTo(0.5);
    expect(summary.kind === "completion" && summary.value).toBe(40); // 2 × 20
  });

  it("the other series is unaffected by it", () => {
    const summary = segmentSummary(rows, "SA", 561);
    // Three active SA collectibles, two of them owned.
    expect(summary).toMatchObject({ kind: "completion", owned: 2, total: 3, missing: 1 });
  });

  it("a retired figure counts in the value but in neither half of the fraction", () => {
    // SKY-9000 is an owned SA figure the catalog no longer offers. Owning it
    // is still owning it, so 30 € belongs in the value — but counting it as
    // collected against a denominator that excludes it could push completion
    // past 100 %.
    const summary = segmentSummary(rows, "SA", 561);
    expect(summary.kind === "completion" && summary.owned).toBe(2);
    expect(summary.kind === "completion" && summary.total).toBe(3);
    expect(summary.kind === "completion" && summary.value).toBe(3 * 10 + 5 + 30);
  });

  it("a figure without a price is left out of the value, never counted as zero", () => {
    const rowsWithUnpriced = buildCollectionRows(catalog, [entry(sa3, 2), entry(sa1, 1)]);
    const summary = segmentSummary(rowsWithUnpriced, "SA", 561);
    expect(summary.kind === "completion" && summary.value).toBe(10);
    expect(summary.kind === "completion" && summary.owned).toBe(2);
  });

  it("software never reaches a segment, in the numerator or the value", () => {
    const summary = segmentSummary(rows, COLLECTION_ALL, 561);
    expect(summary.kind === "completion" && summary.value).toBe(3 * 10 + 5 + 2 * 20 + 30);
  });

  it("an empty segment is zero everywhere, never NaN", () => {
    const summary = segmentSummary([], "SC", 561);
    expect(summary).toMatchObject({ kind: "completion", owned: 0, total: 0, missing: 0, value: 0 });
    expect(summary.kind === "completion" && Number.isNaN(summary.ratio)).toBe(false);
  });

  it("duplicates get their own shape — no total, no completion", () => {
    const summary = segmentSummary(rows, COLLECTION_DUPLICATES, 561);
    expect(summary.kind).toBe("duplicates");
    // sa1 at 3 and g1 at 2 are the only figures held more than once.
    expect(summary).toMatchObject({ figures: 2, extraCopies: 3 });
  });

  it("the duplicate value counts only the copies beyond the first", () => {
    // sa1: (3-1) x 10 = 20, g1: (2-1) x 20 = 20. The first copy of each is
    // part of the collection's value, not of what the duplicates are worth.
    const summary = segmentSummary(rows, COLLECTION_DUPLICATES, 561);
    expect(summary.kind === "duplicates" && summary.value).toBe(40);
  });

  it("a duplicate without a price adds copies but no value", () => {
    const rowsUnpriced = buildCollectionRows([sa3], [entry(sa3, 4)]);
    const summary = segmentSummary(rowsUnpriced, COLLECTION_DUPLICATES, 561);
    expect(summary).toMatchObject({ kind: "duplicates", figures: 1, extraCopies: 3, value: 0 });
  });

  it("a figure owned once is not a duplicate", () => {
    const single = buildCollectionRows([sa1], [entry(sa1, 1)]);
    expect(segmentSummary(single, COLLECTION_DUPLICATES, 561)).toMatchObject({
      figures: 0,
      extraCopies: 0,
      value: 0,
    });
  });

  it("the summary ignores the search box by construction", () => {
    // It takes rows and a filter, never a query — so no keystroke can move it.
    expect(segmentSummary.length).toBe(3);
  });
});
