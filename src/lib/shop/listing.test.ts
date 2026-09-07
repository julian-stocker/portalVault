import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { summarizeOffers, type Offer } from "@/lib/shop/offer";
import { resolveCart, addLine, type Cart } from "@/lib/cart/cart";
import type { OfferIndex } from "@/lib/shop/offer";

/**
 * The shop is opt-out (ADR-0048).
 *
 * Stock that exists is offered unless somebody said otherwise. The rules that
 * make that safe are all in the database, so most of this reads the
 * migration — and the one thing that must never appear anywhere reads the
 * whole tree: a synchronisation step.
 */
function sql(path: string): string {
  return readFileSync(path, "utf8");
}

/** The migration without its comments — what it does, not what it says. */
function code(path: string): string {
  return sql(path)
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

/** One function's body, so an assertion cannot match a different one. */
function body(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf("$$;", start));
}

const LISTING = "supabase/migrations/0008_shop_listing_opt_out.sql";
const FOUNDATION = "supabase/migrations/0003_shop_foundation.sql";
const PRICING = "supabase/migrations/0007_shop_pricing_and_images.sql";

function offer(overrides: Partial<Offer> = {}): Offer {
  return { skyId: "SKY-0007", condition: "loose", price: 4.49, available: true, ...overrides };
}
function index(offers: readonly Offer[]): OfferIndex {
  const map = new Map<string, Offer[]>();
  for (const o of offers) {
    const list = map.get(o.skyId);
    if (list) list.push(o);
    else map.set(o.skyId, [o]);
  }
  return map;
}

describe("new positions are released by default", () => {
  const source = code(LISTING);

  it("through the column default, which every creation path inherits", () => {
    expect(source).toContain("alter column is_listed set default true");
    // The default used to be the opposite.
    expect(code(FOUNDATION)).toContain("is_listed          boolean     not null default false");
  });

  it("covers every path, because only one of them names the column", () => {
    // A position is created by its first movement, and that insert lists no
    // flags at all — quick stock, the detailed booking and the system path
    // used by the import all go through it.
    const create = body(code(FOUNDATION), "create or replace function public.apply_inventory_movement");
    expect(create).toContain("insert into public.shop_inventory (sky_id, condition)");
    expect(create).not.toContain("is_listed");
  });

  it("and the one that does name it now defaults to released too", () => {
    const listing = body(code(LISTING), "create or replace function public.set_shop_listing");
    expect(listing).toContain("coalesce(p_is_listed, true)");
  });

  it("is safe, because the default is not the gate", () => {
    // A movement can be booked against software or an inactive figure. The
    // projection still refuses to offer it.
    const offers = body(code(LISTING), "create or replace function public.shop_offers()");
    expect(offers).toContain("public.is_shop_eligible(i.sky_id)");
  });
});

describe("release and buyability are two questions", () => {
  const source = code(LISTING);

  it("releasing no longer requires a price", () => {
    // 0007 refused it; that made "sell this when possible" depend on a price
    // that may not be known yet.
    expect(code(PRICING)).toContain("if coalesce(p_is_listed, false) and v_effective is null then");
    const listing = body(source, "create or replace function public.set_shop_listing");
    expect(listing).not.toContain("v_effective");
    expect(listing).not.toContain("cannot list");
  });

  it("but a priceless position is still never offered", () => {
    const offers = body(source, "create or replace function public.shop_offers()");
    expect(offers).toContain(
      "public.shop_price(i.sale_price, s.market_price, st.price_percentage) is not null",
    );
  });

  it("and the application no longer translates a refusal that cannot happen", () => {
    const actions = readFileSync("src/lib/admin/actions.ts", "utf8");
    expect(actions).not.toContain("listingNeedsPrice");
  });

  it("shows nothing buyable at stock zero, and does not un-release it", () => {
    // The card's rule, unchanged: available=false summarises to "none".
    expect(summarizeOffers([offer({ available: false })])).toEqual({ kind: "none" });
    // And nothing anywhere sets is_listed from a quantity.
    const foundation = code(FOUNDATION);
    expect(foundation).not.toMatch(/is_listed\s*=\s*(false|quantity)/);
    expect(code(LISTING)).not.toMatch(/set is_listed = false/);
  });

  it("offers again as soon as stock returns, with no further step", () => {
    // Same position, same release, stock back: buyable. Derived, not stored.
    expect(summarizeOffers([offer({ available: true })])).toEqual({
      kind: "single",
      price: 4.49,
      condition: "loose",
    });
  });
});

describe("one rule for which figures belong in the shop", () => {
  const source = code(LISTING);

  it("is named once and asked by both the projection and the activation", () => {
    const rule = body(source, "create or replace function public.is_shop_eligible");
    expect(rule).toContain("s.is_active");
    expect(rule).toContain("s.catalog_visible");
    expect(rule).toContain("public.non_collectible_categories()");
    // Wherever a category is judged, it is judged by the same central list —
    // never by a literal. The audit function names the failing condition for
    // the report, which is why the call appears more than once; what must
    // not appear is a second, slightly different rule.
    expect(source).not.toContain("'Spiele'");
    expect(source).not.toMatch(/c\.name\s*(<>|=)\s*'/);
    // And exactly one predicate answers "may this be sold at all".
    expect((source.match(/create or replace function public\.is_shop_eligible/g) ?? []).length).toBe(1);
    expect(body(source, "create or replace function public.shop_offers()")).toContain(
      "public.is_shop_eligible(i.sky_id)",
    );
  });

  it("says nothing about stock, price or reservations", () => {
    const rule = body(source, "create or replace function public.is_shop_eligible");
    for (const word of ["quantity", "reserved", "sale_price", "shop_price"]) {
      expect(rule).not.toContain(word);
    }
  });

  it("is what the one-time activation selects by", () => {
    expect(source).toContain("update public.shop_inventory i");
    expect(source).toContain("set is_listed = true");
    expect(source).toContain("and public.is_shop_eligible(i.sky_id)");
  });
});

describe("what the activation must not do", () => {
  const source = code(LISTING);

  it("never switches a position off", () => {
    // An opt-out is a decision; a migration does not overrule decisions.
    expect(source).toContain("where not i.is_listed");
    expect(source).not.toMatch(/set is_listed = false/);
  });

  it("changes no quantity, no reservation and no price", () => {
    const update = source.slice(source.indexOf("update public.shop_inventory i"));
    for (const column of ["quantity", "reserved", "sale_price", "market_price"]) {
      expect(update).not.toContain(column);
    }
  });

  it("writes no movement — listing is not a stock change", () => {
    expect(source).not.toContain("inventory_movements");
    expect(source).not.toContain("record_inventory_movement");
  });

  it("touches no collection data", () => {
    expect(source).not.toContain("collection_items");
    expect(source).not.toContain("profiles");
  });

  it("is idempotent", () => {
    // `where not is_listed` selects nothing on a second run.
    expect(source).toMatch(/where not i\.is_listed\s*\n\s*and public\.is_shop_eligible/);
  });
});

describe("there is no synchronisation anywhere", () => {
  it("no snapshot table, no sync function, no sync button", () => {
    for (const path of [
      LISTING,
      "supabase/migrations/0007_shop_pricing_and_images.sql",
      "src/lib/shop/queries.ts",
      "src/components/admin/inventory-view.tsx",
      "src/components/admin/inventory-card.tsx",
      "src/lib/admin/actions.ts",
    ]) {
      const source = code(path);
      expect(source).not.toMatch(/synchron|shop_snapshot|sync_shop|syncShop/i);
    }
  });

  it("the projection reads the stock table live", () => {
    const offers = body(code(LISTING), "create or replace function public.shop_offers()");
    expect(offers).toContain("from public.shop_inventory i");
    expect(offers).toContain("(i.available_quantity > 0) as available");
  });
});

describe("the release is per position, not per figure", () => {
  it("is a column on shop_inventory, keyed by sky_id and condition", () => {
    const foundation = code(FOUNDATION);
    expect(foundation).toContain("create unique index shop_inventory_sky_condition_key");
    expect(foundation).toContain("on public.shop_inventory (sky_id, condition)");
    // And nothing added a figure-wide flag.
    expect(code(LISTING)).not.toMatch(/alter table public\.skylanders/);
  });

  it("so one condition can be offered while the other is not", () => {
    // Only the released, in-stock one reaches a card.
    const loose = offer({ condition: "loose", price: 4.49, available: true });
    expect(summarizeOffers([loose])).toEqual({
      kind: "single",
      price: 4.49,
      condition: "loose",
    });
  });
});

describe("the cart follows the offers, still", () => {
  const cart: Cart = addLine([], {
    skyId: "SKY-0007",
    condition: "loose",
    name: "Bash",
    imageSrc: null,
    price: 4.49,
  }, 2);

  it("treats a de-listed line as no longer available", () => {
    // De-listing removes the row from shop_offers() entirely.
    const [entry] = resolveCart(cart, index([]));
    expect(entry.offer).toBeNull();
    expect(entry.purchasable).toBe(false);
    expect(entry.total).toBeNull();
  });

  it("treats a sold-out line as no longer available", () => {
    const [entry] = resolveCart(cart, index([offer({ available: false })]));
    expect(entry.purchasable).toBe(false);
    expect(entry.total).toBeNull();
  });

  it("recognises it again once it is re-listed and restocked", () => {
    const [entry] = resolveCart(cart, index([offer({ available: true })]));
    expect(entry.purchasable).toBe(true);
    expect(entry.total).toBe(8.98);
  });

  it("keeps its identity and mutates no stock", () => {
    expect(cart[0].skyId).toBe("SKY-0007");
    expect(cart[0].condition).toBe("loose");
    const model = code("src/lib/cart/cart.ts");
    expect(model).not.toContain("reserved");
    expect(model).not.toContain("inventory_movement");
  });
});

describe("who may change a release", () => {
  const source = code(LISTING);

  it("only an administrator, asked inside the database", () => {
    const listing = body(source, "create or replace function public.set_shop_listing");
    expect(listing).toContain("if not public.is_shop_admin() then");
  });

  it("through the existing function, never a table write", () => {
    expect(source).not.toMatch(/grant\s+\w+\s+on\s+(table\s+)?public\.shop_inventory/i);
    const actions = readFileSync("src/lib/admin/actions.ts", "utf8");
    expect(actions).toContain('"set_shop_listing"');
    expect(actions).not.toMatch(/from\("shop_inventory"\)/);
  });

  it("and the audit view is administrator-only", () => {
    const audit = body(source, "create or replace function public.admin_shop_listing_audit");
    expect(audit).toContain("if not public.is_shop_admin() then");
    expect(source).toContain("revoke all on function public.admin_shop_listing_audit() from public, anon;");
  });
});

describe("what the public still cannot see", () => {
  it("no stock level, and no release detail", () => {
    const offers = body(code(LISTING), "create or replace function public.shop_offers()");
    for (const column of ["i.quantity", "i.reserved", "i.note", "i.is_listed as", "i.sale_price as"]) {
      expect(offers).not.toContain(column);
    }
    expect(offers).toContain("(i.available_quantity > 0) as available");
  });
});
