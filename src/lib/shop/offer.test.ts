import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
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

  it("says 'ab' only when the buyable prices actually differ", () => {
    const two = [offer({ condition: "loose", price: 9.9 }), offer({ condition: "boxed", price: 19 })];
    expect(summarizeOffers(two)).toEqual({ kind: "from", price: 9.9 });

    // Same price in both conditions is one price. "ab 9,90 €" beside nothing
    // cheaper than 9,90 € reads as though something were being withheld.
    const same = [offer({ condition: "loose" }), offer({ condition: "boxed" })];
    expect(summarizeOffers(same)).toEqual({ kind: "single", price: 9.9, condition: "loose" });
  });

  it("ignores what cannot be bought when quoting a price", () => {
    const summary = summarizeOffers([
      offer({ condition: "loose", price: 5, available: false }),
      offer({ condition: "boxed", price: 19, available: true }),
    ]);
    // The cheap one is out of stock, so 5,00 € is not a price anyone can pay.
    expect(summary).toEqual({ kind: "single", price: 19, condition: "boxed" });
  });

  it("says 'not in stock' rather than nothing when it is carried but empty", () => {
    expect(summarizeOffers([offer({ available: false })])).toEqual({ kind: "soldOut" });
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
  const sql = code(OFFERS_SQL);

  it("returns four values and no more", () => {
    const signature = /returns table \(([\s\S]*?)\)\n/.exec(sql)?.[1] ?? "";
    const columns = signature
      .split("\n")
      .map((line) => line.trim().split(/\s+/)[0])
      .filter(Boolean);
    expect(columns).toEqual(["sky_id", "condition", "sale_price", "available"]);
  });

  it("never returns a stock level", () => {
    // The whole point of the boolean. `available_quantity` may be read to
    // compute it; it may not be selected.
    for (const column of ["i.quantity", "i.reserved", "i.note"]) {
      expect(sql).not.toContain(column);
    }
    expect(sql).toContain("(i.available_quantity > 0) as available");
  });

  it("never touches the journal", () => {
    // Purchase prices, reasons and actors live there (docs/SECURITY.md).
    expect(sql).not.toContain("inventory_movements");
  });

  it("offers only what the public catalog shows", () => {
    expect(sql).toContain("i.is_listed");
    expect(sql).toContain("s.is_active");
    expect(sql).toContain("s.catalog_visible");
    expect(sql).toContain("public.non_collectible_categories()");
  });

  it("grants no table privilege and adds no policy", () => {
    expect(sql).not.toMatch(/grant\s+select\s+on\s+(table\s+)?public\.shop_inventory/i);
    expect(sql).not.toMatch(/create\s+policy/i);
    expect(sql).not.toMatch(/alter\s+table/i);
  });

  it("is executable by both client roles and by no one else implicitly", () => {
    expect(sql).toContain("revoke all on function public.shop_offers()                from public;");
    expect(sql).toContain(
      "grant execute on function public.shop_offers()                to anon, authenticated;",
    );
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
