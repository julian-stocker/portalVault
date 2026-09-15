import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { isV1Buyable, summarizeOffers, v1BuyableOffers, type Offer } from "@/lib/shop/offer";
import { hasQuickViewOffer, quickViewModel } from "@/lib/ui/quick-view";
import { hasBuyableOffer, matchesAvailability } from "@/lib/catalog/availability";
import { shopEntries } from "@/lib/shop/surface";
import { resolveCart, addLine, cartTotal } from "@/lib/cart/cart";
import type { CatalogFigure } from "@/lib/catalog/types";

/**
 * V1 sells loose figures. That is the whole contract (V3.3).
 *
 * Not "the quick view is loose-only" — the PRODUCT is. There is no condition
 * to choose, no OVP listing, no OVP navigation and no way to buy one. `boxed`
 * stays in the database and its rows stay untouched, because a real OVP
 * concept has to be designed rather than switched on; it is simply not public.
 *
 * The bug that produced this: Hex (SKY-0043) has one staging row —
 * `condition=boxed, price=21.5, available=true` — and the catalog advertised
 * "Angebote ab 21,50 €" while the quick view refused to open, because the two
 * asked different questions. Every surface below now asks one.
 */
const offer = (over: Partial<Offer> = {}): Offer => ({
  skyId: "SKY-0043",
  condition: "loose",
  price: 4.49,
  available: true,
  ...over,
});

const figure = (over: Partial<CatalogFigure> = {}): CatalogFigure =>
  ({
    skyId: "SKY-0043",
    name: "Hex",
    slug: "hex",
    seriesCode: "SSA",
    seriesLabel: "Spyro's Adventure",
    seriesPosition: 0,
    categoryPosition: 0,
    categoryName: "Figuren",
    categoryId: 1,
    catalogGroup: "figure",
    displayName: "Hex",
    sortBaseName: "Hex",
    sortVariantLabel: null,
    searchIndex: "hex",
    marketPrice: 5.49,
    imageFile: "hex.webp",
    imageOverridePath: null,
    isActive: true,
    catalogVisible: true,
    canonicalName: "Hex",
    displayNameOverride: null,
    element: null,
    characterId: null,
    ...over,
  }) as CatalogFigure;

/** Every public surface, asked the same question about the same offers. */
function surfaces(offers: readonly Offer[]) {
  const index = new Map([["SKY-0043", offers]]);
  return {
    card: summarizeOffers(offers).kind !== "none",
    filter: hasBuyableOffer(offers),
    quickView: hasQuickViewOffer(offers),
    detail: v1BuyableOffers(offers).length > 0,
    shop: shopEntries([figure()], index).length > 0,
  };
}

const ALL = ["card", "filter", "quickView", "detail", "shop"] as const;

describe("A — a buyable loose offer is sold everywhere", () => {
  const s = surfaces([offer({ condition: "loose", price: 4.49, available: true })]);
  for (const surface of ALL) {
    it(`${surface} offers it`, () => expect(s[surface]).toBe(true));
  }
});

describe("B — a buyable boxed offer is sold nowhere (the Hex case)", () => {
  const s = surfaces([offer({ condition: "boxed", price: 21.5, available: true })]);
  for (const surface of ALL) {
    it(`${surface} treats it as no offer`, () => expect(s[surface]).toBe(false));
  }

  it("and the quick view has no model to open", () => {
    expect(quickViewModel(figure(), [offer({ condition: "boxed", available: true })])).toBeNull();
  });

  it("so the card says 'no offer' rather than a price it will not honour", () => {
    expect(summarizeOffers([offer({ condition: "boxed", available: true })])).toEqual({
      kind: "none",
    });
  });
});

describe("C — loose beside boxed uses the loose one only", () => {
  const both = [
    offer({ condition: "loose", price: 9.9, available: true }),
    offer({ condition: "boxed", price: 21.5, available: true }),
  ];

  it("every surface offers it", () => {
    const s = surfaces(both);
    for (const surface of ALL) expect(s[surface], surface).toBe(true);
  });

  it("the card quotes the loose price", () => {
    expect(summarizeOffers(both)).toMatchObject({ price: 9.9, condition: "loose" });
  });

  it("the quick view lists the loose one alone", () => {
    expect(quickViewModel(figure(), both)?.offers.map((o) => o.condition)).toEqual(["loose"]);
  });

  it("the shop grid quotes the loose price and holds one offer", () => {
    const [entry] = shopEntries([figure()], new Map([["SKY-0043", both]]));
    expect(entry.fromPrice).toBe(9.9);
    expect(entry.offers).toHaveLength(1);
  });
});

describe("D — a sold-out loose offer beside a buyable boxed one is nothing", () => {
  const s = surfaces([
    offer({ condition: "loose", price: 3, available: false }),
    offer({ condition: "boxed", price: 21.5, available: true }),
  ]);
  for (const surface of ALL) {
    it(`${surface} treats it as no offer`, () => expect(s[surface]).toBe(false));
  }
});

describe("E — a cheaper boxed offer is never teased", () => {
  const cheaperBoxed = [
    offer({ condition: "loose", price: 12, available: true }),
    offer({ condition: "boxed", price: 4.49, available: true }),
  ];

  it("the card quotes 12, not 4.49", () => {
    expect(summarizeOffers(cheaperBoxed)).toMatchObject({ price: 12 });
  });

  it("and so does the shop grid", () => {
    const [entry] = shopEntries([figure()], new Map([["SKY-0043", cheaperBoxed]]));
    expect(entry.fromPrice).toBe(12);
  });

  it("and the quick view", () => {
    expect(quickViewModel(figure(), cheaperBoxed)?.offers[0].price).toBe(12);
  });
});

describe("F — the availability filter agrees with every other surface", () => {
  it("keeps a loose figure", () => {
    expect(matchesAvailability([offer({ condition: "loose" })], "available")).toBe(true);
  });

  it("drops a boxed-only figure", () => {
    expect(matchesAvailability([offer({ condition: "boxed" })], "available")).toBe(false);
  });

  it("and 'all' still means all, offer or not", () => {
    expect(matchesAvailability([offer({ condition: "boxed" })], "all")).toBe(true);
    expect(matchesAvailability(undefined, "all")).toBe(true);
  });
});

describe("the ordinary purchase path refuses boxed", () => {
  it("a boxed cart line cannot be bought and counts nothing", () => {
    const line = { skyId: "SKY-0043", condition: "boxed" as const, name: "Hex", imageSrc: null, price: 21.5 };
    const cart = addLine([], line, 1);
    const entries = resolveCart(cart, new Map([["SKY-0043", [offer({ condition: "boxed", available: true })]]]));
    expect(entries[0].purchasable).toBe(false);
    expect(cartTotal(entries)).toBe(0);
  });

  it("the quantity check refuses it before it reaches the server", () => {
    const src = readFileSync("src/lib/shop/quantity.ts", "utf8");
    expect(src).toContain("condition !== V1_CONDITION");
    // And it says, in as many words, that this is not the boundary.
    expect(src).toContain("NOT THE BOUNDARY");
  });

  it("isV1Buyable is the single predicate the cart uses", () => {
    expect(isV1Buyable(offer({ condition: "loose", available: true }))).toBe(true);
    expect(isV1Buyable(offer({ condition: "boxed", available: true }))).toBe(false);
    expect(isV1Buyable(offer({ condition: "loose", available: false }))).toBe(false);
  });
});

describe("one truth, not five", () => {
  it("every public surface resolves to the same function", () => {
    const strip = (p: string) =>
      readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

    // Nobody re-derives the rule; they all call into `lib/shop/offer.ts`.
    for (const consumer of [
      "src/lib/catalog/availability.ts",
      "src/lib/ui/quick-view.ts",
      "src/lib/shop/surface.ts",
      "src/components/shop/offer-panel.tsx",
    ]) {
      const src = strip(consumer);
      expect(src, `${consumer} must not name a condition`).not.toContain('"boxed"');
      expect(src, `${consumer} must not name a condition`).not.toContain('"loose"');
      expect(src).toMatch(/v1BuyableOffers|hasV1BuyableOffer/);
    }
  });

  it("and the rule itself is written down once", () => {
    const offerModule = readFileSync("src/lib/shop/offer.ts", "utf8");
    expect(offerModule).toContain('V1_CONDITION: OfferCondition = "loose"');
    const matches = offerModule.match(/offer\.condition === V1_CONDITION/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("but the column and its data are untouched", () => {
    // `boxed` stays a condition the database knows and the admin can stock.
    expect(readFileSync("src/lib/shop/offer.ts", "utf8")).toContain(
      'OFFER_CONDITIONS = ["loose", "boxed"]',
    );
  });
});
