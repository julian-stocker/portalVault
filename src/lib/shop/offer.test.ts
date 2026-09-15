import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  v1BuyableOffers,
  findOffer,
  offerIndex,
  offerRecord,
  offersFor,
  sortOffers,
  summarizeOffers,
  type Offer,
  type OfferIndex,
} from "@/lib/shop/offer";

/**
 * The public shop (ADR-0043).
 *
 * Two things are being defended here. The first is what a card says about a
 * price. The second, and the one that matters, is what a visitor can learn
 * about the stock behind it — which is nothing.
 */
function offer(overrides: Partial<Offer> = {}): Offer {
  return {
    skyId: "SKY-0001",
    condition: "loose",
    price: 9.9,
    available: true,
    ...overrides,
  };
}

/** The migration without its comments — what it does, not what it says. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

const OFFERS_SQL = "supabase/migrations/0006_public_shop_offers.sql";
/** 0007 replaced shop_offers() to derive the price (ADR-0045). */
const PRICING_SQL = "supabase/migrations/0007_shop_pricing_and_images.sql";
const FOUNDATION_SQL = "supabase/migrations/0003_shop_foundation.sql";

describe("what a card says", () => {
  it("says nothing when SkyIsles does not carry the figure", () => {
    // 561 figures, a handful of them stocked. A "nicht im Angebot" line on
    // the rest would be the loudest thing in the catalog.
    expect(summarizeOffers([])).toEqual({ kind: "none" });
  });

  it("states the price when there is one offer", () => {
    expect(summarizeOffers([offer()])).toEqual({
      kind: "single",
      price: 9.9,
      condition: "loose",
    });
  });

  it("quotes one price, because V1 sells one condition", () => {
    /*
     * "ab …" needed two buyable prices, and V1 cannot have them: one loose
     * position per figure (unique on sky_id + condition) and boxed is not
     * public. The `from` branch stays in the model for the day a second
     * seller makes two prices possible again.
     */
    const two = [offer({ condition: "loose", price: 9.9 }), offer({ condition: "boxed", price: 19 })];
    expect(summarizeOffers(two)).toEqual({ kind: "single", price: 9.9, condition: "loose" });
  });

  it("never quotes a boxed price — V1 does not sell OVP", () => {
    const summary = summarizeOffers([
      offer({ condition: "loose", price: 5, available: false }),
      offer({ condition: "boxed", price: 19, available: true }),
    ]);
    // The loose one is out of stock and the boxed one is not for sale here,
    // so the card says nothing rather than teasing 19,00 €.
    expect(summary).toEqual({ kind: "none" });
  });

  it("says nothing at all when nothing can be bought", () => {
    // V7: a listed but empty position gets no shop area on a catalog card —
    // no disabled button, no "Nicht auf Lager", no greyed-out surface. The
    // collector catalog is a catalog of objects; sold-out state belongs on a
    // shop surface of its own, later.
    expect(summarizeOffers([offer({ available: false })])).toEqual({ kind: "none" });
    expect(summarizeOffers([
      offer({ condition: "loose", available: false }),
      offer({ condition: "boxed", price: 19, available: false }),
    ])).toEqual({ kind: "none" });
  });

  it("offers only what V1 actually sells", () => {
    const mixed = [
      offer({ condition: "loose", price: 5, available: false }),
      offer({ condition: "boxed", price: 19, available: true }),
    ];
    // Neither qualifies: one is sold out, the other is a condition V1 has no
    // public concept of.
    expect(v1BuyableOffers(mixed)).toEqual([]);
    expect(v1BuyableOffers([offer({ available: false })])).toEqual([]);
    expect(
      v1BuyableOffers([offer({ condition: "boxed", available: true })]),
    ).toEqual([]);
    expect(
      v1BuyableOffers([offer({ condition: "loose", available: true })]),
    ).toHaveLength(1);
  });
});

describe("the order offers are shown in", () => {
  it("puts what can be bought first, then the cheaper one", () => {
    const sorted = sortOffers([
      offer({ condition: "boxed", price: 19, available: false }),
      offer({ condition: "loose", price: 12 }),
    ]);
    expect(sorted.map((o) => o.condition)).toEqual(["loose", "boxed"]);
  });
});

describe("the index", () => {
  const index: OfferIndex = new Map([["SKY-0001", [offer(), offer({ condition: "boxed" })]]]);

  it("answers with an empty list for a figure nobody stocks", () => {
    expect(offersFor(index, "SKY-0999")).toEqual([]);
  });

  it("finds one exact article", () => {
    expect(findOffer(index, "SKY-0001", "boxed")?.condition).toBe("boxed");
    expect(findOffer(index, "SKY-0001", "loose")?.condition).toBe("loose");
    expect(findOffer(index, "SKY-0002", "loose")).toBeNull();
  });

  it("survives the server → client boundary", () => {
    // A Map serialises to {} in React props, which is a bug that shows up as
    // "no offers anywhere" rather than as an error.
    const roundTrip = offerIndex(JSON.parse(JSON.stringify(offerRecord(index))));
    expect(offersFor(roundTrip, "SKY-0001")).toHaveLength(2);
  });
});

describe("what the public projection may return", () => {
  // The live definition is 0007's; 0006 created the first one.
  const sql = code(PRICING_SQL);

  it("returns four values and no more", () => {
    const offers = sql.slice(sql.indexOf("create or replace function public.shop_offers()"));
    const signature = /returns table \(([\s\S]*?)\)\n/.exec(offers)?.[1] ?? "";
    const columns = signature
      .split("\n")
      .map((line) => line.trim().split(/\s+/)[0])
      .filter(Boolean);
    expect(columns).toEqual(["sky_id", "condition", "price", "available"]);
  });

  it("never returns a stock level", () => {
    // The whole point of the boolean. `available_quantity` may be read to
    // compute it; it may not be selected.
    const offers = sql.slice(
      sql.indexOf("create or replace function public.shop_offers()"),
      sql.indexOf("comment on function public.shop_offers()"),
    );
    for (const column of ["i.quantity", "i.reserved", "i.note"]) {
      expect(offers).not.toContain(column);
    }
    expect(offers).toContain("(i.available_quantity > 0) as available");
  });

  it("never touches the journal", () => {
    // Purchase prices, reasons and actors live there (docs/SECURITY.md).
    expect(sql).not.toContain("inventory_movements");
  });

  it("publishes one price and never says where it came from", () => {
    // ADR-0045: the override, the percentage and the manual/automatic flag
    // are all internal. The public gets a number.
    const offers = sql.slice(
      sql.indexOf("create or replace function public.shop_offers()"),
      sql.indexOf("comment on function public.shop_offers()"),
    );
    expect(offers).toContain("public.shop_price(i.sale_price, s.market_price, st.price_percentage) as price");
    expect(offers).not.toContain("price_source");
    expect(offers).not.toContain("as percentage");
  });

  it("never offers something it cannot price", () => {
    // The half of the dropped CHECK that a constraint could not carry: a
    // market price cleared after listing leaves no effective price.
    const offers = sql.slice(sql.indexOf("create or replace function public.shop_offers()"));
    expect(offers).toContain(
      "public.shop_price(i.sale_price, s.market_price, st.price_percentage) is not null",
    );
  });

  it("offers only what the public catalog shows", () => {
    expect(sql).toContain("i.is_listed");
    expect(sql).toContain("s.is_active");
    expect(sql).toContain("s.catalog_visible");
    expect(sql).toContain("public.non_collectible_categories()");
  });

  it("grants no table privilege on the stock", () => {
    expect(sql).not.toMatch(/grant\s+\w+\s+on\s+(table\s+)?public\.shop_inventory/i);
    expect(sql).not.toMatch(/grant\s+\w+\s+on\s+(table\s+)?public\.shop_settings/i);
  });

  it("is executable by both client roles and by no one else implicitly", () => {
    expect(sql).toContain("revoke all on function public.shop_offers() from public;");
    expect(sql).toContain("grant execute on function public.shop_offers() to anon, authenticated;");
  });
});

describe("the category rule the projection mirrors", () => {
  it("names the same categories the application excludes", () => {
    // src/lib/catalog/collectible.ts is where the rule is explained; this is
    // the SQL copy of it. If one is changed the other has to be.
    const application = readFileSync("src/lib/catalog/collectible.ts", "utf8");
    const names = /new Set\(\[([^\]]*)\]\)/.exec(application)?.[1] ?? "";
    const parsed = [...names.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    expect(parsed).toEqual(["Spiele"]);

    const sql = code(OFFERS_SQL);
    const array = /select array\[([^\]]*)\]::text\[\]/.exec(sql)?.[1] ?? "";
    expect([...array.matchAll(/'([^']+)'/g)].map((match) => match[1])).toEqual(parsed);
  });
});

describe("the shop still cannot be read any other way", () => {
  it("keeps shop_inventory unreadable to every client role", () => {
    // The guarantee 0006 must not weaken: the projection is the whole public
    // read surface, and it exists precisely because a table grant is
    // column-blind.
    const foundation = code(FOUNDATION_SQL);
    expect(foundation).toMatch(
      /revoke all on public\.shop_inventory[\s\S]{0,120}from public, anon, authenticated/,
    );
  });
});
