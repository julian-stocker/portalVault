import { describe, expect, it } from "vitest";

import type { CatalogFigure } from "@/lib/catalog/types";
import type { Offer, OfferIndex } from "@/lib/shop/offer";
import { shopEntries } from "@/lib/shop/surface";

function figure(over: Partial<CatalogFigure> & { skyId: string }): CatalogFigure {
  return {
    name: over.skyId,
    slug: over.skyId.toLowerCase(),
    seriesCode: "SSA",
    seriesLabel: "Spyro's Adventure",
    seriesPosition: 0,
    categoryPosition: 0,
    categoryName: "Core",
    categoryId: 1,
    catalogGroup: null,
    displayName: over.skyId,
    sortBaseName: over.skyId,
    sortVariantLabel: null,
    searchIndex: over.skyId.toLowerCase(),
    marketPrice: 10,
    imageFile: null,
    imageOverridePath: null,
    isActive: true,
    catalogVisible: true,
    canonicalName: over.skyId,
    displayNameOverride: null,
    element: null,
    ...over,
  } as CatalogFigure;
}

function offers(entries: Record<string, readonly Offer[]>): OfferIndex {
  return new Map(Object.entries(entries));
}

const offer = (skyId: string, price: number, available = true): Offer => ({
  skyId,
  condition: "loose",
  price,
  available,
});

describe("shopEntries", () => {
  it("is empty when nothing is offered", () => {
    expect(shopEntries([figure({ skyId: "SKY-0001" })], new Map())).toEqual([]);
  });

  it("keeps only figures that can actually be bought", () => {
    const catalog = [
      figure({ skyId: "SKY-0001" }),
      figure({ skyId: "SKY-0002" }),
      figure({ skyId: "SKY-0003" }),
    ];
    const index = offers({
      "SKY-0001": [offer("SKY-0001", 9)],
      // Listed but sold out is not an offer — the same rule the card follows.
      "SKY-0002": [offer("SKY-0002", 4, false)],
    });

    expect(shopEntries(catalog, index).map((entry) => entry.figure.skyId)).toEqual(["SKY-0001"]);
  });

  it("never shows an editorially hidden figure", () => {
    const catalog = [figure({ skyId: "SKY-0001", catalogVisible: false })];
    const index = offers({ "SKY-0001": [offer("SKY-0001", 9)] });
    expect(shopEntries(catalog, index)).toEqual([]);
  });

  it("never shows a non-collectible entry", () => {
    const catalog = [figure({ skyId: "SKY-0900", categoryName: "Spiele" })];
    const index = offers({ "SKY-0900": [offer("SKY-0900", 19)] });
    expect(shopEntries(catalog, index)).toEqual([]);
  });

  it("sorts by the cheapest buyable price", () => {
    const catalog = [
      figure({ skyId: "SKY-0001" }),
      figure({ skyId: "SKY-0002" }),
      figure({ skyId: "SKY-0003" }),
    ];
    const index = offers({
      "SKY-0001": [offer("SKY-0001", 30)],
      "SKY-0002": [offer("SKY-0002", 5)],
      "SKY-0003": [offer("SKY-0003", 12)],
    });

    expect(shopEntries(catalog, index).map((entry) => entry.fromPrice)).toEqual([5, 12, 30]);
  });

  it("shows the loose price and never the boxed one beside it (V3.3)", () => {
    const catalog = [figure({ skyId: "SKY-0001" })];
    const index = offers({
      "SKY-0001": [
        { skyId: "SKY-0001", condition: "boxed", price: 22, available: true },
        { skyId: "SKY-0001", condition: "loose", price: 8, available: true },
      ],
    });

    const [entry] = shopEntries(catalog, index);
    expect(entry.fromPrice).toBe(8);
    // One offer, not two: V1 sells loose, and the boxed row is not public.
    expect(entry.offers).toHaveLength(1);
    expect(entry.offers[0].condition).toBe("loose");
  });

  it("drops a figure whose only listing is boxed", () => {
    /*
     * Not "shows it at the boxed price": V1 has no public concept of OVP, so
     * such a figure has no offer at all and does not belong on a page whose
     * whole subject is what can be bought.
     */
    const catalog = [figure({ skyId: "SKY-0001" })];
    const index = offers({
      "SKY-0001": [
        { skyId: "SKY-0001", condition: "loose", price: 3, available: false },
        { skyId: "SKY-0001", condition: "boxed", price: 22, available: true },
      ],
    });

    expect(shopEntries(catalog, index)).toHaveLength(0);
  });

  it("breaks price ties by name so the order is stable", () => {
    const catalog = [
      figure({ skyId: "SKY-0002", displayName: "Zook" }),
      figure({ skyId: "SKY-0001", displayName: "Bash" }),
    ];
    const index = offers({
      "SKY-0001": [offer("SKY-0001", 9)],
      "SKY-0002": [offer("SKY-0002", 9)],
    });

    expect(shopEntries(catalog, index).map((entry) => entry.figure.displayName)).toEqual([
      "Bash",
      "Zook",
    ]);
  });

  /** The shop surface must not become the place a stock level leaks. */
  it("carries no quantity of any kind", () => {
    const catalog = [figure({ skyId: "SKY-0001" })];
    const index = offers({ "SKY-0001": [offer("SKY-0001", 9)] });
    const [entry] = shopEntries(catalog, index);

    const keys = new Set(Object.keys(entry.offers[0]));
    expect(keys).toEqual(new Set(["skyId", "condition", "price", "available"]));
    expect(Object.keys(entry)).toEqual(["figure", "offers", "fromPrice"]);
  });
});
