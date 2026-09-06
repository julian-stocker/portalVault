import { describe, expect, it } from "vitest";

import type { CatalogFigure, CollectionEntry } from "@/lib/catalog/types";
import { collectionStats } from "./stats.ts";
import {
  COLLECTION_ALL,
  buildCollectionRows,
  filterCollection,
  duplicateSummary,
  matchesFilters,
  matchesScope,
  groupBySeries,
  hasActiveFilter,
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
    categoryId: 1,
    catalogGroup: "figure",
    catalogVisible: true,
    canonicalName: "",
    displayNameOverride: null,
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
  it("gives a row to what is owned, and to nothing else (V4.3)", () => {
    // The catalog no longer travels to the browser: a missing figure has no
    // row, because nothing on this page draws one. The denominators come
    // from CatalogTotals instead.
    const owned = [entry(figure("SKY-0002"), 2)];
    const rows = buildCollectionRows(owned);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ quantity: 2, initialQuantity: 2 });
  });

  it("keeps an owned figure the catalog no longer offers", () => {
    // Something already owned must not vanish because it left the catalog.
    const retired = figure("SKY-9000", { isActive: false });
    const rows = buildCollectionRows([entry(figure("SKY-0001"), 1), entry(retired, 1)]);

    expect(rows).toHaveLength(2);
    expect(rows[1].figure.skyId).toBe("SKY-9000");
    expect(rows[1].quantity).toBe(1);
  });

  it("gives an owned console game no card", () => {
    // ADR-0029: software is outside the collector surface entirely. It is not
    // lost, it is reported in the overview as nonCollectibleOwned.
    const game = figure("SKY-9001", { categoryName: "Spiele" });
    const rows = buildCollectionRows([entry(figure("SKY-0001"), 1), entry(game, 1)]);

    expect(rows).toHaveLength(1);
    expect(rows[0].figure.skyId).toBe("SKY-0001");
    expect(collectionStats([entry(game, 1)], 561).nonCollectibleOwned).toBe(1);
  });

  it("starts every row at what the server said, so undo has something to restore", () => {
    const one = figure("SKY-0001");
    const rows = buildCollectionRows([entry(one, 3)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].initialQuantity).toBe(3);
  });
});

describe("the showcase holds only what is owned", () => {
  const catalog = [
    figure("SKY-0001"),
    figure("SKY-0002"),
    figure("SKY-0003"),
    figure("SKY-0004", { seriesCode: "G", seriesLabel: "Giants" }),
  ];
  // SKY-0003 exists in the catalog and is not owned — it never becomes a row.
  const rows = buildCollectionRows([
    entry(catalog[0], 1),
    entry(catalog[1], 3),
    entry(catalog[3], 1),
  ]);

  it("holds only owned rows, whatever the filter says", () => {
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

  it("the duplicates filter is quantity above one — never one", () => {
    expect(
      filterCollection(rows, COLLECTION_ALL, { duplicatesOnly: true }).map((r) => r.figure.skyId),
    ).toEqual(["SKY-0002"]);
  });

  it("scope and filter combine, which the old duplicates tab could not", () => {
    // "Giants and duplicates" was unreachable while duplicates sat in the
    // same bar as the games (ADR-0038, V4.2).
    expect(filterCollection(rows, "G", { duplicatesOnly: true })).toEqual([]);
    expect(
      filterCollection(rows, "SA", { duplicatesOnly: true }).map((r) => r.figure.skyId),
    ).toEqual(["SKY-0002"]);
  });

  it("a row that dropped to zero is never shown, whatever is set", () => {
    const missing = { ...rows[0], quantity: 0 };
    for (const scope of [COLLECTION_ALL, "SA"]) {
      expect(filterCollection([missing], scope)).toEqual([]);
      expect(filterCollection([missing], scope, { duplicatesOnly: true })).toEqual([]);
    }
  });

  it("keeps the predicates usable for a row the caller decided to keep", () => {
    // The view keeps a just-removed row on screen so undo stays reachable,
    // and asks the predicates separately. Series still matches at quantity 0.
    const removed = { ...rows[0], quantity: 0 };
    expect(matchesScope(removed, "SA")).toBe(true);
    expect(matchesScope(removed, COLLECTION_ALL)).toBe(true);
    expect(matchesFilters(removed, { duplicatesOnly: true })).toBe(false);
    expect(matchesFilters(removed, { duplicatesOnly: false })).toBe(true);
  });
});

describe("statistics over the rows", () => {
  it("counts a SKY-ID once for completion, however many copies", () => {
    // Three Drobots are one figure out of the catalog, not three.
    const catalog = [figure("SKY-0001"), figure("SKY-0002")];
    const rows = buildCollectionRows([entry(catalog[0], 3)]);
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
    const rows = buildCollectionRows(catalog.map((one, index) => entry(one, index + 2)));
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
    const rows = buildCollectionRows([entry(one, 4)]);
    const removed = { ...rows[0], quantity: 0 };

    expect(removed.initialQuantity).toBe(4);
    // Out of the showcase the moment it is removed — the view keeps the card
    // itself on screen so the undo stays reachable.
    expect(showcaseRows([removed])).toEqual([]);

    const restored = { ...removed, quantity: removed.initialQuantity };
    expect(restored.quantity).toBe(4);
    expect(showcaseRows([restored])).toHaveLength(1);
    expect(matchesFilters(restored, { duplicatesOnly: true })).toBe(true);
  });
});

describe("what the summary counts", () => {
  it("a game owned but not shown still has to reach the statistics", () => {
    // buildCollectionRows drops software from the showcase (ADR-0029), so
    // feeding only the rows into collectionStats hid the very entries the
    // "these are games" note exists to explain. The view adds them back.
    const game = figure("SKY-9001", { categoryName: "Spiele", marketPrice: 60 });
    const owned = [entry(figure("SKY-0001"), 1), entry(game, 1)];
    const rows = buildCollectionRows(owned);

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
  const game = figure("SKY-9001", { categoryName: "Spiele", marketPrice: 60 });
  const retired = figure("SKY-9000", { isActive: false, marketPrice: 30 });

  // What the database says the catalog holds: three active SA collectibles
  // (sa1, sa2, sa3) and two Giants (g1, g2). The game counts in neither.
  const TOTALS = { total: 561, bySeries: { SA: 3, G: 2 } };
  const owned = [entry(sa1, 3), entry(sa2, 1), entry(g1, 2), entry(game, 1), entry(retired, 1)];
  const rows = buildCollectionRows(owned);

  it("'Alle' measures against the catalog count from the database", () => {
    const summary = segmentSummary(rows, COLLECTION_ALL, TOTALS);
    expect(summary).toMatchObject({ total: 561, missing: 561 - 3 });
    // Three active collectibles owned; the game counts towards nothing and
    // the retired figure is out of the denominator and the numerator.
    expect(summary.owned).toBe(3);
  });

  it("'Alle' agrees with collectionStats on the same collection", () => {
    const counted = [...ownedEntries(rows), ...owned.filter((e) => e.figure.categoryName === "Spiele")];
    const stats = collectionStats(counted, 561);
    const summary = segmentSummary(rows, COLLECTION_ALL, TOTALS);
    expect(summary.owned).toBe(stats.countedFigures);
    expect(summary.value).toBe(stats.estimatedValue);
    expect(summary.ratio).toBeCloseTo(stats.progress);
  });

  it("a series segment counts only that game, on both sides of the fraction", () => {
    const summary = segmentSummary(rows, "G", TOTALS);
    // Giants holds two active collectibles; one of them is owned, twice.
    expect(summary).toMatchObject({ owned: 1, total: 2, missing: 1 });
    expect(summary.ratio).toBeCloseTo(0.5);
    expect(summary.value).toBe(40); // 2 × 20
  });

  it("the other series is unaffected by it", () => {
    const summary = segmentSummary(rows, "SA", TOTALS);
    // Three active SA collectibles, two of them owned.
    expect(summary).toMatchObject({ owned: 2, total: 3, missing: 1 });
  });

  it("a retired figure counts in the value but in neither half of the fraction", () => {
    // SKY-9000 is an owned SA figure the catalog no longer offers. Owning it
    // is still owning it, so 30 € belongs in the value — but counting it as
    // collected against a denominator that excludes it could push completion
    // past 100 %.
    const summary = segmentSummary(rows, "SA", TOTALS);
    expect(summary.owned).toBe(2);
    expect(summary.total).toBe(3);
    expect(summary.value).toBe(3 * 10 + 5 + 30);
  });

  it("a figure without a price is left out of the value, never counted as zero", () => {
    const rowsWithUnpriced = buildCollectionRows([entry(sa3, 2), entry(sa1, 1)]);
    const summary = segmentSummary(rowsWithUnpriced, "SA", TOTALS);
    expect(summary.value).toBe(10);
    expect(summary.owned).toBe(2);
  });

  it("software never reaches a segment, in the numerator or the value", () => {
    const summary = segmentSummary(rows, COLLECTION_ALL, TOTALS);
    expect(summary.value).toBe(3 * 10 + 5 + 2 * 20 + 30);
  });

  it("an empty segment is zero everywhere, never NaN", () => {
    const summary = segmentSummary([], "SC", TOTALS);
    expect(summary).toMatchObject({ owned: 0, total: 0, missing: 0, value: 0 });
    expect(Number.isNaN(summary.ratio)).toBe(false);
  });

  it("the duplicate line counts figures and the copies beyond the first", () => {
    // sa1 at 3 and g1 at 2 are the only figures held more than once.
    expect(duplicateSummary(rows, COLLECTION_ALL)).toMatchObject({ figures: 2, extraCopies: 3 });
  });

  it("the duplicate value counts only the copies beyond the first", () => {
    // sa1: (3-1) x 10 = 20, g1: (2-1) x 20 = 20. The first copy of each is
    // part of the collection's value, not of what the duplicates are worth.
    expect(duplicateSummary(rows, COLLECTION_ALL).value).toBe(40);
  });

  it("the duplicate line follows the chosen game", () => {
    expect(duplicateSummary(rows, "G")).toMatchObject({ figures: 1, extraCopies: 1, value: 20 });
    expect(duplicateSummary(rows, "SF")).toMatchObject({ figures: 0, extraCopies: 0, value: 0 });
  });

  it("a duplicate without a price adds copies but no value", () => {
    const rowsUnpriced = buildCollectionRows([entry(sa3, 4)]);
    expect(duplicateSummary(rowsUnpriced, COLLECTION_ALL)).toMatchObject({
      figures: 1,
      extraCopies: 3,
      value: 0,
    });
  });

  it("a figure owned once is not a duplicate", () => {
    const single = buildCollectionRows([entry(sa1, 1)]);
    expect(duplicateSummary(single, COLLECTION_ALL)).toMatchObject({ figures: 0, extraCopies: 0 });
  });

  it("the summary ignores the search box by construction", () => {
    // It takes rows and a filter, never a query — so no keystroke can move it.
    expect(segmentSummary.length).toBe(3);
  });
});

describe("groupBySeries — the 'Alle' view, by game", () => {
  const SERIES = [
    { code: "SA", label: "Spyro's Adventure" },
    { code: "G", label: "Giants" },
    { code: "SF", label: "Swap Force" },
  ];
  const sa1 = figure("SKY-0001");
  const sa2 = figure("SKY-0002");
  const g1 = figure("SKY-0100", { seriesCode: "G", seriesLabel: "Giants" });
  // Three active SA collectibles, two Giants, one Swap Force — the counts
  // the database gives, not something derived from the rows below.
  const TOTALS = { total: 6, bySeries: { SA: 3, G: 2, SF: 1 } };
  const all = buildCollectionRows([entry(sa1, 1), entry(sa2, 2), entry(g1, 1)]);
  const visible = showcaseRows(all);

  it("keeps the order the database gave, not the order rows appear in", () => {
    expect(groupBySeries(visible, all, SERIES, TOTALS).map((s) => s.code)).toEqual(["SA", "G"]);
  });

  it("puts each figure under its own game", () => {
    const sections = groupBySeries(visible, all, SERIES, TOTALS);
    expect(sections[0].rows.map((r) => r.figure.skyId)).toEqual(["SKY-0001", "SKY-0002"]);
    expect(sections[1].rows.map((r) => r.figure.skyId)).toEqual(["SKY-0100"]);
  });

  it("leaves out a game with nothing owned rather than heading an empty gap", () => {
    // Swap Force exists in the catalog and in the series list, and is absent.
    expect(groupBySeries(visible, all, SERIES, TOTALS).some((s) => s.code === "SF")).toBe(false);
  });

  it("counts owned against the whole game, once per SKY-ID", () => {
    const sections = groupBySeries(visible, all, SERIES, TOTALS);
    // SA: three active collectibles, two owned — one of them twice.
    expect(sections[0]).toMatchObject({ owned: 2, total: 3 });
    expect(sections[0].ratio).toBeCloseTo(2 / 3);
    expect(sections[1]).toMatchObject({ owned: 1, total: 2, ratio: 0.5 });
  });

  it("counts the collection, never the search", () => {
    // A search narrowed the grid to one figure; the section still says 2 / 3,
    // because "how far is Spyro's Adventure" is not a question about a query.
    const searched = visible.filter((row) => row.figure.skyId === "SKY-0001");
    const sections = groupBySeries(searched, all, SERIES, TOTALS);
    expect(sections).toHaveLength(1);
    expect(sections[0].rows).toHaveLength(1);
    expect(sections[0]).toMatchObject({ owned: 2, total: 3 });
  });

  it("counts the collection, never the duplicates filter either", () => {
    // The same rule as the search, and the one that made "Duplikate" wrong as
    // a tab: filtering changes which cards are under the heading, never what
    // the heading says about the game (ADR-0038, V4.2).
    const duplicates = filterCollection(all, COLLECTION_ALL, { duplicatesOnly: true });
    const sections = groupBySeries(duplicates, all, SERIES, TOTALS);
    expect(sections.map((s) => s.code)).toEqual(["SA"]);
    expect(sections[0].rows.map((r) => r.figure.skyId)).toEqual(["SKY-0002"]);
    expect(sections[0]).toMatchObject({ owned: 2, total: 3 });
  });

  it("keeps the same structure under a filter: sections, not a flat list", () => {
    // Whatever narrows the view, the page is still games with headings — one
    // for a chosen game, several for "Alle" — so nothing rearranges itself.
    const scoped = filterCollection(all, "SA", { duplicatesOnly: false });
    const sections = groupBySeries(scoped, all, SERIES, TOTALS);
    expect(sections.map((s) => s.code)).toEqual(["SA"]);
    expect(sections[0].rows).toHaveLength(2);
  });

  it("excludes software from both halves of every section", () => {
    const game = figure("SKY-9001", { categoryName: "Spiele" });
    const withGame = buildCollectionRows([entry(sa1, 1), entry(game, 1)]);
    const sections = groupBySeries(showcaseRows(withGame), withGame, SERIES, TOTALS);
    expect(sections[0]).toMatchObject({ owned: 1, total: 3 });
    expect(sections.every((s) => s.rows.every((r) => r.figure.categoryName !== "Spiele"))).toBe(true);
  });

  it("a retired figure counts in neither half", () => {
    const retired = figure("SKY-9000", { isActive: false });
    const rows = buildCollectionRows([entry(sa1, 1), entry(retired, 1)]);
    const sections = groupBySeries(showcaseRows(rows), rows, SERIES, TOTALS);
    expect(sections[0]).toMatchObject({ owned: 1, total: 3 });
  });

  it("is empty for an empty showcase, never NaN", () => {
    const sections = groupBySeries([], [], SERIES, TOTALS);
    expect(sections).toEqual([]);
  });

  it("takes its denominator from the catalog counts, not from the rows", () => {
    // The bug this guards against: counting the rows the page happens to
    // hold would make a section say "2 / 2" for a game that has 81 figures.
    const sections = groupBySeries(visible, all, SERIES, TOTALS);
    expect(sections[0].total).toBe(3);
    expect(sections[1].total).toBe(2);
    // Without counts there is no denominator to invent — zero, never NaN.
    const unknown = groupBySeries(visible, all, SERIES);
    expect(unknown[0]).toMatchObject({ owned: 2, total: 0, ratio: 0 });
  });
});

describe("hasActiveFilter — when a reset is worth offering", () => {
  it("says no in the resting state", () => {
    // "Alle" and an empty box is where the page starts; offering to reset it
    // is an action with nothing to undo (ADR-0038, V4.1).
    expect(hasActiveFilter(COLLECTION_ALL, "")).toBe(false);
    expect(hasActiveFilter(COLLECTION_ALL, "   ")).toBe(false);
  });

  it("says yes for a chosen series, for a search and for the duplicates filter", () => {
    expect(hasActiveFilter("G", "")).toBe(true);
    expect(hasActiveFilter(COLLECTION_ALL, "bash")).toBe(true);
    expect(hasActiveFilter(COLLECTION_ALL, "", { duplicatesOnly: true })).toBe(true);
  });
});
