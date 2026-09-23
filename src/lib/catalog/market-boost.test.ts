/**
 * THE TEMPORARY CATALOG BOOST, AND THE LINE IT MUST NOT CROSS (0094).
 *
 * Two things are tested here and the second matters more than the first.
 *
 * The arithmetic: a percentage on money, done on integer cents so that the
 * defect `automaticShopPrice()` once had — 16.65 × 90 % landing on 14.98
 * because binary floating point makes it 1498.4999999999998 — cannot come
 * back in a second place.
 *
 * The isolation: `skylanders.market_price` is the canonical price, and the
 * shop price, the buy-in factor and every snapshot are computed from it. The
 * boost is a DISPLAY valuation — for the public catalog AND, since the
 * operator extended it, for the collection, which is valued at what the
 * catalog says a figure is worth. It stops at the Business side. The tests at the bottom hold that boundary as a fact about the
 * module graph — a module that never imports the boost cannot apply it — so a
 * later change that pulls it into a calculation fails here rather than in
 * somebody's invoice.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { NO_MARKET_BOOST, catalogDisplayMarketPrice } from "./market-boost.ts";
import { automaticShopPrice } from "@/lib/shop/offer";
import { code, latestFunction, migrationSource } from "@/test-support/migrations";

const source = (path: string) => readFileSync(path, "utf8");

describe("the boosted price the catalog prints", () => {
  it("adds the percentage, to the cent", () => {
    expect(catalogDisplayMarketPrice(10, 5)).toBe(10.5);
    expect(catalogDisplayMarketPrice(4.99, 5)).toBe(5.24);       // 5.2395 → 5.24
    expect(catalogDisplayMarketPrice(16.65, 7.5)).toBe(17.9);    // 17.89875 → 17.90
  });

  it("rounds half away from zero, like Postgres `round(numeric, 2)`", () => {
    // 10.10 × 1.05 = 10.605 — exactly on the half, and it goes up.
    expect(catalogDisplayMarketPrice(10.1, 5)).toBe(10.61);
    // And the case that broke the shop preview, in this shape: no binary
    // rounding error is allowed to eat the last cent.
    expect(catalogDisplayMarketPrice(16.65, 10)).toBe(18.32);    // 18.315 → 18.32
  });

  it("never invents a price where there is none", () => {
    expect(catalogDisplayMarketPrice(null, 5)).toBeNull();
    expect(catalogDisplayMarketPrice(null, 0)).toBeNull();
  });

  it("shows the stored price when the boost says nothing", () => {
    for (const boost of [0, NO_MARKET_BOOST, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(catalogDisplayMarketPrice(12.34, boost), String(boost)).toBe(12.34);
    }
  });

  it("shows the stored value for a price the database could not hold", () => {
    // `market_price > 0` is a CHECK, so these cannot occur — and if one did,
    // the answer is the stored value, not a number this function made up.
    expect(catalogDisplayMarketPrice(0, 5)).toBe(0);
    expect(catalogDisplayMarketPrice(-3, 5)).toBe(-3);
    expect(catalogDisplayMarketPrice(Number.NaN, 5)).toBeNaN();
  });

  it("is a pure function of its two arguments", () => {
    expect(catalogDisplayMarketPrice(7.77, 5)).toBe(catalogDisplayMarketPrice(7.77, 5));
    // And it leaves the shop's own arithmetic exactly where it was.
    expect(automaticShopPrice(16.65, 90)).toBe(14.99);
  });

  /**
   * The same money, through both paths, at the operator's default.
   *
   * A stored 10.00 is printed as 10.50 in the catalog and still sells for
   * 9.00 at the shop's 90 % — because the shop reads the stored price, not
   * the printed one.
   */
  it("does not move what the shop asks for the same figure", () => {
    expect(catalogDisplayMarketPrice(10, 5)).toBe(10.5);
    expect(automaticShopPrice(10, 90)).toBe(9);
    expect(automaticShopPrice(catalogDisplayMarketPrice(10, 5) ?? 0, 90)).not.toBe(9);
  });
});

/* ===================================================================== */
describe("the setting, in the database", () => {
  const SQL = migrationSource("0094_catalog_market_boost.sql");

  it("is a typed column on the platform's settings, not the seller's", () => {
    expect(SQL).toContain("alter table public.platform_settings");
    expect(SQL).toContain("catalog_market_boost_percent numeric(5,2) not null default 5.00");
    // The seller's own percentage is a different number for a different job.
    // Against the EXECUTABLE sql: the header explains why it is not there.
    expect(code(SQL)).not.toContain("shop_settings");
  });

  it("accepts 0 to 50 and nothing else", () => {
    expect(SQL).toContain(
      "check (catalog_market_boost_percent >= 0 and catalog_market_boost_percent <= 50)");
    const writer = code(latestFunction("admin_set_catalog_market_boost").body);
    expect(writer).toContain("p_percent is null or p_percent < 0 or p_percent > 50");
    expect(writer).toContain("round(p_percent, 2)");
  });

  it("is written by the platform administrator and by nobody else", () => {
    const writer = latestFunction("admin_set_catalog_market_boost");
    expect(writer.file).toBe("0094_catalog_market_boost.sql");
    expect(writer.body).toContain("security definer");
    expect(writer.body).toContain("set search_path = ''");
    expect(code(writer.body)).toContain("if not public.is_platform_admin() then");
    // A seller operator holds a different capability, and it is not this one.
    expect(code(writer.body)).not.toContain("can_operate_active_seller");
    expect(SQL).toContain(
      "revoke all on function public.admin_set_catalog_market_boost(numeric) from public, anon;");
    expect(SQL).toContain(
      "grant execute on function public.admin_set_catalog_market_boost(numeric) to authenticated;");
  });

  it("writes one column and touches no price", () => {
    const writer = code(latestFunction("admin_set_catalog_market_boost").body);
    expect(writer).toContain("update public.platform_settings");
    expect(writer).toContain("set catalog_market_boost_percent = round(p_percent, 2)");
    for (const forbidden of [
      "skylanders", "market_price", "shop_price", "shop_inventory",
      "inventory_movements", "sale_items", "legacy_stock_events", "buy_in_factor",
    ]) {
      expect(writer, forbidden).not.toContain(forbidden);
    }
  });

  it("the public reader returns one number and opens nothing else", () => {
    const reader = latestFunction("catalog_market_boost");
    expect(reader.file).toBe("0094_catalog_market_boost.sql");
    expect(reader.body).toContain("returns numeric");
    expect(reader.body).toContain("stable");
    expect(reader.body).toContain("security definer");
    expect(reader.body).toContain("set search_path = ''");
    // One column. Never `select p.*`, never a second field.
    expect(code(reader.body))
      .toContain("select p.catalog_market_boost_percent from public.platform_settings p;");
    expect(code(reader.body)).not.toContain("contact_email");
    expect(code(reader.body)).not.toContain("support_email");
    expect(SQL).toContain("grant execute on function public.catalog_market_boost() to anon, authenticated;");
  });

  it("opens no direct access to platform_settings", () => {
    // The table's own grants are not touched: 0026's revoke still stands.
    expect(SQL).not.toMatch(/grant [a-z, ]*on public\.platform_settings/);
    expect(SQL).not.toContain("enable row level security");
    expect(SQL).not.toContain("create policy");
    expect(SQL).not.toContain("drop policy");
  });

  it("changes no data", () => {
    // A column with a default, two functions and a reader. No DML at all.
    expect(SQL).not.toMatch(/^\s*(insert|delete)\s+/im);
    // The only UPDATE in the file is the one inside the writer function.
    expect(SQL.match(/update public\./g) ?? []).toHaveLength(1);
  });
});

/* ===================================================================== */
/**
 * WHERE THE BOOST APPLIES, AND WHERE IT MUST NOT.
 *
 * `FigureCard` is rendered by four surfaces. Three are catalog surfaces and
 * pass the percentage; the collection does not, because the card there sits
 * beside a total computed from the stored price.
 */
describe("the boundary", () => {
  const CARD = source("src/components/catalog/figure-card.tsx");
  const QUICK_VIEW = source("src/components/catalog/quick-view.tsx");
  const CATALOG_PAGE = source("src/app/(public)/(catalog)/page.tsx");
  const SHOP_PAGE = source("src/app/(public)/shop/page.tsx");
  const FIGURE_PAGE = source("src/app/(public)/skylanders/[slug]/page.tsx");
  const COLLECTION_VIEW = source("src/components/collection/collection-view.tsx");

  it("the card and the dialog boost nothing unless they are told to", () => {
    for (const [name, file] of [["card", CARD], ["quick view", QUICK_VIEW]] as const) {
      expect(file, name).toMatch(/marketBoostPercent = NO_MARKET_BOOST/);
      expect(file, name).toContain("catalogDisplayMarketPrice(");
    }
    expect(NO_MARKET_BOOST).toBe(0);
  });

  it("the three public catalog surfaces pass it", () => {
    for (const [name, file] of [["catalog", CATALOG_PAGE], ["shop", SHOP_PAGE],
                                ["figure page", FIGURE_PAGE]] as const) {
      expect(file, name).toContain("fetchCatalogMarketBoost()");
      expect(file, name).toMatch(/marketBoostPercent=\{marketBoost\}/);
    }
  });

  /**
   * AND SO DOES THE COLLECTION — ALL OF IT, OR NONE OF IT.
   *
   * A collection is valued at what the catalog says its figures are worth, so
   * it follows the same percentage. The danger is not that it applies, it is
   * that it applies to SOME of the five consumers: cards boosted and the
   * total not would be worse than either number alone. So all five are named
   * here, and the page reads the percentage once.
   */
  it("the collection boosts every one of its five consumers", () => {
    const PAGE = source("src/app/(app)/collection/page.tsx");
    expect(PAGE).toContain("fetchCatalogMarketBoost()");
    expect(PAGE).toContain("marketBoostPercent={marketBoost}");

    for (const call of [
      "collectionStats(counted, totals.total, marketBoostPercent)",
      "segmentSummary(rows, scope, totals, marketBoostPercent)",
      "duplicateSummary(rows, scope, marketBoostPercent)",
    ]) expect(COLLECTION_VIEW, call).toContain(call);
    // The card and the table, both of them.
    expect(COLLECTION_VIEW.match(/marketBoostPercent=\{marketBoostPercent\}/g) ?? [])
      .toHaveLength(3);   // two tables (grouped and flat) + the showcase card
  });

  it("the collection rounds the unit first, then multiplies", () => {
    const stats = source("src/lib/collection/stats.ts");
    const view = source("src/lib/collection/view.ts");
    const table = source("src/components/collection/collection-table.tsx");
    // Never `quantity * figure.marketPrice`: that is the stored price.
    for (const [name, file] of [["stats", stats], ["view", view], ["table", table]] as const) {
      expect(file, name).not.toMatch(/quantity \* (row|entry)\.figure\.marketPrice/);
      expect(file, name).toContain("catalogDisplayMarketPrice(");
    }
    expect(stats).toContain(
      "entry.quantity * (catalogDisplayMarketPrice(entry.figure.marketPrice, boostPercent) ?? 0)");
    expect(table).toContain("const unit = catalogDisplayMarketPrice(row.figure.marketPrice, boostPercent);");
    expect(table).toContain("return unit === null ? null : row.quantity * unit;");
  });

  it("one read per request, never one per card", () => {
    const reader = source("src/lib/catalog/market-boost-server.ts");
    expect(reader).toContain("cache(async ()");
    expect(reader).toContain('supabase.rpc("catalog_market_boost")');
    // Fail closed: an error is no boost, which shows the stored price.
    expect(reader).toContain("return NO_MARKET_BOOST;");
    for (const [name, file] of [["card", CARD], ["quick view", QUICK_VIEW]] as const) {
      expect(file, name).not.toContain("fetchCatalogMarketBoost");
    }
  });

  /**
   * THE ONE THAT MATTERS.
   *
   * Not a word search: a module that does not IMPORT the boost cannot apply
   * it, whatever it happens to say in a comment. These are the modules that
   * compute with the market price, and none of them may reach it.
   */
  it("never reaches anything that calculates", () => {
    const imports = (file: string) =>
      [...source(file).matchAll(/^import[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => m[1]);
    for (const file of [
      "src/lib/catalog/queries.ts",
      "src/lib/catalog/types.ts",
      "src/lib/shop/offer.ts",
      "src/lib/shop/queries.ts",
      "src/lib/shop/surface.ts",
      /* The collection is IN, by decision — see above. `queries.ts` is still
         out: it builds the canonical rows and must not boost them. */
      "src/lib/collection/queries.ts",
      "src/lib/orderbook/purchase.ts",
      "src/lib/orderbook/draft.ts",
      "src/lib/orderbook/queries.ts",
      "src/lib/admin/inventory.ts",
      "src/lib/admin/inventory-model.ts",
      "src/components/admin/inventory-card.tsx",
    ]) {
      expect(imports(file).filter((i) => i.includes("market-boost")), file).toEqual([]);
      expect(source(file), file).not.toContain("catalogDisplayMarketPrice");
    }
  });

  it("the canonical projection is untouched", () => {
    const queries = source("src/lib/catalog/queries.ts");
    // Still the stored column, still straight into `marketPrice`.
    expect(queries).toContain("marketPrice: row.market_price === null ? null : Number(row.market_price)");
    expect(queries).toContain(", market_price,");
    // And the shop price rule in the database still reads the stored price.
    const shopPrice = code(latestFunction("shop_price").body);
    expect(shopPrice).toContain("round(p_market_price * p_percentage / 100, 2)");
    expect(shopPrice).not.toContain("boost");
  });
});
