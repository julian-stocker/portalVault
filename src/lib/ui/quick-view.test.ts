import { describe, expect, it } from "vitest";

import { quickViewModel } from "@/lib/ui/quick-view";
import type { CatalogFigure } from "@/lib/catalog/types";
import type { Offer } from "@/lib/shop/offer";

function figure(over: Partial<CatalogFigure> = {}): CatalogFigure {
  return {
    skyId: "SKY-0096",
    name: "Anvil Rain",
    slug: "anvil-rain",
    seriesCode: "SSA",
    seriesLabel: "Spyro's Adventure",
    seriesPosition: 0,
    categoryPosition: 2,
    categoryName: "Magische Gegenstände",
    categoryId: 4,
    catalogGroup: "item",
    displayName: "Anvil Rain",
    sortBaseName: "Anvil Rain",
    sortVariantLabel: null,
    searchIndex: "anvil rain",
    marketPrice: 12.5,
    imageFile: "abc123.webp",
    imageOverridePath: null,
    isActive: true,
    catalogVisible: true,
    canonicalName: "Anvil Rain",
    displayNameOverride: null,
    element: null,
    characterId: null,
    ...over,
  };
}

function offer(over: Partial<Offer> = {}): Offer {
  return { skyId: "SKY-0096", condition: "loose", price: 4.49, available: true, ...over };
}

describe("the quick view shows the figure that was asked for", () => {
  it("carries the identity, the game and the category", () => {
    const model = quickViewModel(figure(), [offer()]);
    expect(model?.skyId).toBe("SKY-0096");
    expect(model?.seriesLabel).toBe("Spyro's Adventure");
    expect(model?.categoryName).toBe("Magische Gegenstände");
    expect(model?.slug).toBe("anvil-rain");
  });

  it("uses the derived display name, not the stored one (ADR-0030)", () => {
    const model = quickViewModel(
      figure({ name: "Legendary Bash", displayName: "Bash (Legendary)" }),
      [offer()],
    );
    expect(model?.name).toBe("Bash (Legendary)");
  });

  it("resolves the picture through the override rule (ADR-0046)", () => {
    const model = quickViewModel(figure(), [offer()]);
    expect(model?.imageSrc).toContain("abc123.webp");
  });

  it("treats an empty category as nothing to show rather than as an empty line", () => {
    expect(quickViewModel(figure({ categoryName: "" }), [offer()])?.categoryName).toBeNull();
  });
});

describe("market value and offer stay two different numbers (ADR-0033)", () => {
  it("keeps the market price apart from the asking price", () => {
    const model = quickViewModel(figure({ marketPrice: 12.5 }), [offer({ price: 4.49 })]);
    expect(model?.marketPrice).toBe(12.5);
    expect(model?.offers[0].price).toBe(4.49);
  });

  it("passes an unknown market price through as null, never as zero (ADR-0010)", () => {
    const model = quickViewModel(figure({ marketPrice: null }), [offer()]);
    expect(model?.marketPrice).toBeNull();
  });

  it("does not derive one price from the other", () => {
    const model = quickViewModel(figure({ marketPrice: 100 }), [offer({ price: 4.49 })]);
    expect(model?.offers[0].price).toBe(4.49);
  });
});

describe("the quick view trades loose copies and nothing else", () => {
  it("excludes a boxed offer even when it is buyable", () => {
    // A product decision: OVP is a more deliberate purchase and belongs on
    // the figure page, which keeps listing and selling it.
    const model = quickViewModel(figure(), [
      offer({ condition: "loose", price: 4.49 }),
      offer({ condition: "boxed", price: 18.0 }),
    ]);
    expect(model?.offers.map((o) => o.condition)).toEqual(["loose"]);
    expect(model?.offers).toHaveLength(1);
  });

  it("opens nothing at all when the only offer is boxed", () => {
    // Not an empty dialog: the card stays a link to the figure page, where
    // the boxed offer is.
    expect(quickViewModel(figure(), [offer({ condition: "boxed", price: 18.0 })])).toBeNull();
  });

  it("never lets a boxed price reach the dialog", () => {
    const model = quickViewModel(figure(), [
      offer({ condition: "loose", price: 4.49 }),
      offer({ condition: "boxed", price: 18.0 }),
    ]);
    expect(model?.offers.map((o) => o.price)).not.toContain(18.0);
  });

  it("drops a listed but unavailable loose offer", () => {
    expect(
      quickViewModel(figure(), [offer({ condition: "loose", available: false })]),
    ).toBeNull();
  });
});

describe("loose offers are ordered by price, cheapest first", () => {
  /*
   * `shop_inventory` carries a unique index on (sky_id, condition), so one
   * figure has at most one loose position and the real list holds one entry.
   * These use a hand-built list to hold the ordering rule anyway — it is what
   * a second seller would arrive into, and an unordered list would be found
   * only then.
   */
  it("sorts ascending", () => {
    const model = quickViewModel(figure(), [
      offer({ condition: "loose", price: 9.99 }),
      { skyId: "SKY-0096", condition: "loose", price: 4.49, available: true },
    ]);
    expect(model?.offers.map((o) => o.price)).toEqual([4.49, 9.99]);
  });

  it("keeps every loose offer rather than collapsing them to the cheapest", () => {
    const model = quickViewModel(figure(), [
      offer({ condition: "loose", price: 9.99 }),
      { skyId: "SKY-0096", condition: "loose", price: 4.49, available: true },
    ]);
    expect(model?.offers).toHaveLength(2);
  });
});

describe("a figure with nothing to buy opens nothing", () => {
  it("returns null without any offer at all", () => {
    expect(quickViewModel(figure(), [])).toBeNull();
    expect(quickViewModel(figure(), undefined)).toBeNull();
  });

  it("returns null when everything listed is unavailable", () => {
    expect(quickViewModel(figure(), [offer({ available: false })])).toBeNull();
  });

  it("returns null for a figure that is not there", () => {
    // A stale SKY-ID after the catalog filtered: no dialog rather than a
    // dialog about nothing.
    expect(quickViewModel(undefined, [offer()])).toBeNull();
    expect(quickViewModel(null, [offer()])).toBeNull();
  });
});

describe("nothing is invented that the data cannot support", () => {
  const model = quickViewModel(figure(), [offer()]);

  it("carries no seller, rating, delivery or shipping field", () => {
    // The seller name is unreadable to a visitor until a `seller_public()`
    // exists, there is no rating anywhere in the product, and the shipping
    // amount depends on the whole basket. Any of them here would be a claim
    // the product cannot keep.
    for (const forbidden of [
      "seller",
      "sellerName",
      "sellerLogo",
      "rating",
      "reviews",
      "reviewCount",
      "shipping",
      "delivery",
    ]) {
      expect(model).not.toHaveProperty(forbidden);
    }
    for (const offerField of ["seller", "sellerName", "rating", "shipping"]) {
      expect(model?.offers[0]).not.toHaveProperty(offerField);
    }
  });

  it("publishes no stock level — availability is a boolean (migration 0006)", () => {
    expect(model?.offers[0]).not.toHaveProperty("quantity");
    expect(model?.offers[0]).not.toHaveProperty("stock");
    expect(typeof model?.offers[0].available).toBe("boolean");
  });
});
