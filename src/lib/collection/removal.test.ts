import { describe, expect, it } from "vitest";

import type { CatalogFigure, CollectionEntry } from "@/lib/catalog/types";
import { collectionStats } from "@/lib/collection/stats";
import { remainingEntries, withRemoval } from "./removal.ts";

function entry(skyId: string, marketPrice: number | null = 10, quantity = 1): CollectionEntry {
  const figure: CatalogFigure = {
    skyId,
    name: "Drobot",
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
    marketPrice,
    imageFile: null,
    displayName: "Drobot",
    sortBaseName: "Drobot",
    sortVariantLabel: null,
    searchIndex: "drobot",
    isActive: true,
    element: null,
    characterId: null,
  };
  return { figure, quantity };
}

describe("withRemoval", () => {
  it("marks a figure as removed", () => {
    expect([...withRemoval(new Set(), "SKY-0001", true)]).toEqual(["SKY-0001"]);
  });

  it("is idempotent — removing twice is still removed once", () => {
    const once = withRemoval(new Set(), "SKY-0001", true);
    const twice = withRemoval(once, "SKY-0001", true);
    expect([...twice]).toEqual(["SKY-0001"]);
    // Same state, same object: a repeated tap does not even re-render.
    expect(twice).toBe(once);
  });

  it("undo puts the figure back, and a second undo changes nothing", () => {
    const removedOnce = withRemoval(new Set(), "SKY-0001", true);
    const restored = withRemoval(removedOnce, "SKY-0001", false);
    expect([...restored]).toEqual([]);
    expect(withRemoval(restored, "SKY-0001", false)).toBe(restored);
  });

  it("a rollback after a failed request lands back on the previous state", () => {
    const before = withRemoval(new Set(), "SKY-0002", true);
    const optimistic = withRemoval(before, "SKY-0001", true); // user taps remove
    const rolledBack = withRemoval(optimistic, "SKY-0001", false); // request failed
    expect([...rolledBack]).toEqual([...before]);
  });

  it("keeps figures apart", () => {
    let state: ReadonlySet<string> = new Set();
    state = withRemoval(state, "SKY-0001", true);
    state = withRemoval(state, "SKY-0002", true);
    state = withRemoval(state, "SKY-0001", false);
    expect([...state]).toEqual(["SKY-0002"]);
  });

  it("does not mutate the set it was given", () => {
    const before = new Set(["SKY-0001"]);
    withRemoval(before, "SKY-0002", true);
    expect([...before]).toEqual(["SKY-0001"]);
  });
});

describe("remainingEntries", () => {
  const entries = [entry("SKY-0001"), entry("SKY-0002", null), entry("SKY-0003", 12.5, 3)];

  it("drops exactly the removed figure", () => {
    const left = remainingEntries(entries, new Set(["SKY-0002"]));
    expect(left.map((item) => item.figure.skyId)).toEqual(["SKY-0001", "SKY-0003"]);
  });

  it("removing a figure held more than once removes all of its pieces", () => {
    // The row is deleted whole; there is no quantity control in V1.5.
    const left = remainingEntries(entries, new Set(["SKY-0003"]));
    expect(collectionStats(left, 561).totalPieces).toBe(2);
  });

  it("feeds the same numbers the server would compute after a reload", () => {
    const left = remainingEntries(entries, new Set(["SKY-0001"]));
    const reloaded = [entry("SKY-0002", null), entry("SKY-0003", 12.5, 3)];
    expect(collectionStats(left, 561)).toEqual(collectionStats(reloaded, 561));
  });

  it("removing everything leaves an empty collection", () => {
    const ids = entries.map((item) => item.figure.skyId);
    expect(remainingEntries(entries, new Set(ids))).toEqual([]);
  });
});
