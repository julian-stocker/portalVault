import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { hasQuickViewOffer, quickViewModel } from "@/lib/ui/quick-view";
import { hasBuyableOffer } from "@/lib/catalog/availability";
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

describe("who gets a quick view, and who gets the figure page", () => {
  /**
   * The report that produced these: Hex (SKY-0043) showed "Angebote ab
   * 21,50 €" in the catalog and led to its page instead of opening the
   * dialog. The offer is real — and it is BOXED. Staging holds exactly one
   * row for it: `condition=boxed, price=21.5, available=true`.
   *
   * So the two questions are genuinely different, and mixing them up is the
   * mistake these guard against:
   *
   *   hasBuyableOffer     any buyable offer      → the card shows a price
   *   hasQuickViewOffer   a buyable LOOSE offer  → the dialog has something
   */
  const boxedOnly = [offer({ condition: "boxed", price: 21.5, available: true })];

  it("a buyable loose offer opens the dialog", () => {
    expect(hasQuickViewOffer([offer({ condition: "loose" })])).toBe(true);
  });

  it("a boxed-only figure does not — and that is the contract, not a defect", () => {
    expect(hasQuickViewOffer(boxedOnly)).toBe(false);
    expect(quickViewModel(figure(), boxedOnly)).toBeNull();
  });

  it("and its card says nothing either — one truth, not two (V3.3)", () => {
    /*
     * This assertion used to be the opposite way round, and the difference is
     * the whole of the Hex report: the card advertised "Angebote ab 21,50 €"
     * and the dialog refused to open, because the row asked "is anything
     * available" and the dialog asked "is anything loose".
     *
     * V1 sells loose only, everywhere. So both answer no, and the card shows
     * "Aktuell kein Angebot" rather than a price it will not honour.
     */
    expect(hasBuyableOffer(boxedOnly)).toBe(false);
    expect(hasQuickViewOffer(boxedOnly)).toBe(false);
  });

  it("a listed but unavailable loose offer opens nothing", () => {
    expect(hasQuickViewOffer([offer({ condition: "loose", available: false })])).toBe(false);
  });

  it("boxed beside loose opens the dialog, on the loose one", () => {
    const mixed = [offer({ condition: "boxed", price: 21.5 }), offer({ condition: "loose", price: 4.49 })];
    expect(hasQuickViewOffer(mixed)).toBe(true);
    expect(quickViewModel(figure(), mixed)?.offers.map((o) => o.condition)).toEqual(["loose"]);
  });

  it("nothing at all opens nothing", () => {
    expect(hasQuickViewOffer([])).toBe(false);
    expect(hasQuickViewOffer(undefined)).toBe(false);
  });
});

describe("the card and the dialog decide with one function", () => {
  it("the card asks `hasQuickViewOffer`, not a predicate of its own", () => {
    const card = readFileSync("src/components/catalog/catalog-card.tsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(card).toContain("hasQuickViewOffer(offers)");
    // The shapes an earlier version had, and the ones a future one might try.
    expect(card).not.toContain(".length > 0");
    expect(card).not.toContain("summarizeOffers");
    expect(card).not.toContain('"loose"');
  });

  it("and the model refuses on the same ground", () => {
    const model = readFileSync("src/lib/ui/quick-view.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(model).toContain("return quickBuyOffers(offers).length > 0");
    expect(model).toContain("const buyable = quickBuyOffers(offers)");
  });

  it("keys offers by the SKY-ID exactly as it arrives", () => {
    /*
     * `shop_offers()` returns `SKY-0043`; the record is keyed by that string
     * and read back by that string. No casing change, no trim, no prefix —
     * a transformation on one side only would silently empty the trade row.
     */
    const view = readFileSync("src/components/catalog/catalog-view.tsx", "utf8");
    expect(view).toContain("offers[figure.skyId]");
    expect(view).not.toMatch(/skyId\.(toLowerCase|toUpperCase|trim|replace)/);
    const record = readFileSync("src/lib/shop/offer.ts", "utf8");
    expect(record).toContain("Object.fromEntries(index)");
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
