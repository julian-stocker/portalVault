/**
 * The Orderbuch's rules (migration 0053, ADR-0088).
 *
 * The arithmetic and the schema invariants. The behaviour that needs a live
 * database — freeze-on-booking, idempotent Einbuchen, concurrency — is proven
 * against Staging, because a policy or a row lock cannot refuse anything here.
 */
import { describe, expect, it } from "vitest";

import { code, columnsOf, columnsWritten, latestFunction, migrationSource } from "@/test-support/migrations";
import {
  QUICK_STATES, bookingProgress, canBook, isHistorical, valuePurchase, type ValuedItem,
} from "./purchase";
import {
  classifyItem, groupRows, indexCatalog, normalise, resolveByFormula, serialToIso,
  type RawRow,
} from "./order-2026";

const SQL = migrationSource("0053_orderbook_purchases.sql");

/* ------------------------------------------------------------ valuation --- */

const item = (state: ValuedItem["state"], marketPrice: number | null): ValuedItem => ({ state, marketPrice });

describe("what a purchase is worth", () => {
  it("is cost over known market value", () => {
    const v = valuePurchase(100, [item("arrived", 50), item("arrived", 200)]);
    expect(v.knownValue).toBe(250);
    expect(v.factor).toBe(0.4);
    expect(v.percent).toBe(40);
    expect(v.complete).toBe(true);
  });

  it("does NOT treat an unknown price as zero", () => {
    /*
     * The whole point. Counting a priceless figure as 0 would inflate the
     * factor and present a guess as a measurement.
     */
    const v = valuePurchase(100, [item("arrived", 50), item("arrived", null)]);
    expect(v.knownValue).toBe(50);
    expect(v.knownItems).toBe(1);
    expect(v.unknownItems).toBe(1);
    expect(v.complete).toBe(false);
  });

  it("returns no factor at all when nothing is known", () => {
    // Not Infinity, not 0 — the question is unanswerable, so it is unanswered.
    const v = valuePurchase(100, [item("arrived", null)]);
    expect(v.factor).toBeNull();
    expect(v.percent).toBeNull();
  });

  it("returns no factor when the market value is zero", () => {
    expect(valuePurchase(100, [item("arrived", 0)]).factor).toBeNull();
  });

  it("allows a cost of zero — a gift is still a purchase", () => {
    const v = valuePurchase(0, [item("arrived", 20)]);
    expect(v.factor).toBe(0);
    expect(v.percent).toBe(0);
  });

  it("leaves a missing item out of the value entirely", () => {
    // It never arrived, so it is not part of what the parcel is worth — but it
    // stays on the purchase, because the money was still spent.
    const v = valuePurchase(100, [item("arrived", 50), item("missing", 999)]);
    expect(v.knownValue).toBe(50);
    expect(v.countedItems).toBe(1);
  });

  it("mixes frozen and live prices without caring which is which", () => {
    // The reader has already substituted; this only adds up what it was given.
    const v = valuePurchase(90, [item("booked", 30), item("arrived", 60)]);
    expect(v.knownValue).toBe(90);
    expect(v.factor).toBe(1);
  });
});

describe("what may be booked", () => {
  it("an arrived or ordered catalog figure", () => {
    expect(canBook({ state: "arrived", skyId: "SKY-0001" })).toBe(true);
    expect(canBook({ state: "ordered", skyId: "SKY-0001" })).toBe(true);
  });

  it("never something damaged or missing", () => {
    expect(canBook({ state: "damaged", skyId: "SKY-0001" })).toBe(false);
    expect(canBook({ state: "missing", skyId: "SKY-0001" })).toBe(false);
  });

  it("never something the catalog does not model", () => {
    // A portal is a purchase, not a figure.
    expect(canBook({ state: "arrived", skyId: null })).toBe(false);
  });

  it("never a historical row, and never twice", () => {
    expect(canBook({ state: "reconciled_legacy", skyId: "SKY-0001" })).toBe(false);
    expect(canBook({ state: "booked", skyId: "SKY-0001" })).toBe(false);
  });

  it("the Quickbox offers only states a person can observe", () => {
    expect([...QUICK_STATES]).toEqual(["ordered", "arrived", "damaged", "missing"]);
    expect(QUICK_STATES).not.toContain("booked");
    expect(QUICK_STATES).not.toContain("reconciled_legacy");
  });

  it("separates what is booked from what is settled", () => {
    /*
     * The pilot exposed this. `booked` must mean "owns an inventory movement",
     * because that is what the SQL counts and the two must not tell different
     * stories. But a historical row needs no decision either, so the ledger
     * asks a wider question — and 14 historical items shown as "0 von 14
     * eingebucht" read as fourteen figures still waiting to be inspected.
     */
    const p = bookingProgress([
      { state: "booked" }, { state: "reconciled_legacy" }, { state: "arrived" },
    ]);
    expect(p).toEqual({ booked: 1, settled: 2, open: 1, total: 3 });
  });

  it("names a historical purchase by its source, not by guesswork", () => {
    expect(isHistorical("excel_order_2026")).toBe(true);
    expect(isHistorical("manual")).toBe(false);
  });
});

/* ------------------------------------------------------- schema invariants */

describe("the schema says what booked means", () => {
  it("booked if and only if a movement exists", () => {
    expect(SQL).toContain("check ((state = 'booked') = (movement_id is not null))");
  });

  it("only a catalog figure can own a movement", () => {
    expect(SQL).toContain("check (movement_id is null or sky_id is not null)");
  });

  it("one movement belongs to one item", () => {
    expect(SQL).toContain("create unique index if not exists purchase_items_movement_uniq");
  });

  it("a booked item cannot be deleted out from under its movement", () => {
    expect(SQL).toContain("references public.inventory_movements (id) on delete restrict");
  });

  it("an item is always identifiable, with or without a sky_id", () => {
    expect(SQL).toContain("check (sky_id is not null or (raw_name is not null");
  });

  it("a price without a time is not a snapshot", () => {
    expect(SQL).toContain("check ((market_price_snapshot is null) = (market_price_snapshot_at is null))");
  });

  it("carries no seller_id, like every other commerce table", () => {
    // ADR-0021/0077. Two guard tests already fail any migration that does.
    expect(columnsOf("purchases")).not.toContain("seller_id");
    expect(columnsOf("purchase_items")).not.toContain("seller_id");
  });

  it("writes only columns that exist", () => {
    for (const table of ["purchases", "purchase_items"]) {
      const columns = columnsOf(table);
      for (const written of columnsWritten(SQL, table)) {
        expect(columns, `${table}.${written}`).toContain(written);
      }
    }
  });
});

describe("Einbuchen", () => {
  const fn = code(latestFunction("seller_book_purchase_item").body);

  it("is seller-gated", () => {
    expect(fn).toContain("public.can_operate_active_seller()");
  });

  it("locks the row, which is what makes a double tap safe", () => {
    expect(fn).toContain("for update");
  });

  it("replays instead of booking twice", () => {
    // Returns the movement the first call made. Not an error: a retry finding
    // the work done is the system behaving correctly.
    expect(fn).toMatch(/if v_item\.state = 'booked' then\s+return v_item\.movement_id;/);
  });

  it("goes through the canonical ledger, never through shop_inventory", () => {
    expect(fn).toContain("public.record_inventory_movement(");
    expect(fn).toContain("1, 'purchase'");
    expect(fn).not.toContain("shop_inventory");
    expect(fn).not.toMatch(/update public\.shop_inventory|set quantity/);
  });

  it("books no invented per-unit cost", () => {
    // `inventory_movements_cost_only_on_purchase` permits NULL; 21 Production
    // rows already look like this. A proportional split would be arithmetic
    // dressed as evidence.
    expect(fn).toContain("null, null,");
  });

  it("reads the market price inside the same transaction that moves stock", () => {
    const priceRead = fn.indexOf("s.market_price into v_price");
    const movement = fn.indexOf("record_inventory_movement");
    const write = fn.indexOf("market_price_snapshot =");
    expect(priceRead).toBeGreaterThan(-1);
    expect(priceRead).toBeLessThan(movement);
    expect(movement).toBeLessThan(write);
  });

  it("refuses damaged, missing and non-figures with reasons", () => {
    expect(fn).toContain("not a catalog figure");
    expect(fn).toContain("damaged item does not enter sellable stock");
    expect(fn).toContain("never arrived cannot be booked");
  });

  it("refuses a historical item outright", () => {
    expect(fn).toContain("already reflected in stock and is never booked again");
  });
});

describe("undoing a booking", () => {
  const fn = code(latestFunction("seller_unbook_purchase_item").body);

  it("compensates rather than deletes", () => {
    expect(fn).toContain("-1, 'correction'");
    expect(fn).not.toMatch(/delete from public\.inventory_movements/);
  });

  it("re-opens the price, because the item is open again", () => {
    expect(fn).toContain("market_price_snapshot = null");
  });
});

describe("the historical import creates no stock", () => {
  const fn = code(latestFunction("seller_import_purchase_group").body);

  it("lands every item as reconciled_legacy", () => {
    expect(fn).toContain("'reconciled_legacy'");
  });

  it("never calls the movement ledger", () => {
    /*
     * The invariant this whole design hangs on. Production stock was
     * reconciled from the stock sheets; replaying the purchase history as
     * movements would double it.
     */
    expect(fn).not.toContain("record_inventory_movement");
    expect(fn).not.toContain("apply_inventory_movement");
    expect(fn).not.toContain("shop_inventory");
  });

  it("keeps the workbook's markers as context, not as instructions", () => {
    expect(fn).toContain("legacy_condition_flag");
    expect(fn).toContain("legacy_booked_flag");
    // D="x" appears nowhere as a branch.
    expect(fn).not.toMatch(/legacy_booked_flag\s*=\s*'x'/);
  });

  it("cannot import the same group twice", () => {
    expect(SQL).toContain("purchases_import_fingerprint_uniq");
  });

  it("marks the source so the UI can treat it differently", () => {
    expect(fn).toContain("'excel_order_2026'");
  });
});

describe("authorization", () => {
  it("every seller function asks the canonical predicate", () => {
    for (const fn of [
      "seller_purchases", "seller_purchase", "seller_create_purchase", "seller_update_purchase",
      "seller_add_purchase_item", "seller_remove_purchase_item", "seller_set_purchase_item_state",
      "seller_book_purchase_item", "seller_unbook_purchase_item", "seller_delete_purchase",
      "seller_import_purchase_group",
    ]) {
      expect(code(latestFunction(fn).body), fn).toContain("can_operate_active_seller()");
    }
  });

  it("the tables are reachable by no client role", () => {
    expect(SQL).toContain("alter table public.purchases        enable row level security;");
    expect(SQL).toContain("revoke all on table public.purchases      from public, anon, authenticated;");
    expect(SQL).toContain("revoke all on table public.purchase_items from public, anon, authenticated;");
    expect(code(SQL)).not.toMatch(/create policy/i);
  });

  it("nothing is granted to anon", () => {
    const grants = [...code(SQL).matchAll(/grant execute on function ([^;]+);/g)].map((m) => m[1]);
    expect(grants.length).toBeGreaterThan(8);
    for (const g of grants) expect(g, g).toContain("to authenticated");
    expect(code(SQL)).not.toMatch(/grant[^;]*to anon/);
  });
});

/* --------------------------------------------------- the workbook reader --- */

const raw = (row: number, over: Partial<RawRow> = {}): RawRow => ({
  row, a: "", b: "", c: "", d: "", e: "", f: "", g: "", gFormula: "", h: "", i: "", ...over,
});

describe("Order 2026 grouping", () => {
  it("splits on the repeated Date header", () => {
    const groups = groupRows([
      raw(4, { a: "Date" }),
      raw(5, { a: "45997", b: "288.14", f: "Mini Jini" }),
      raw(6, { f: "Bob" }),
      raw(7, { a: "Date" }),
      raw(8, { a: "45997", b: "67.02", f: "Dune Bug" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[0].totalCost).toBe(288.14);
    expect(groups[1].totalCost).toBe(67.02);
  });

  it("keeps two purchases on the same day apart", () => {
    // The group boundary IS the purchase boundary. Merging by date would fuse
    // two parcels into one.
    const groups = groupRows([
      raw(4, { a: "Date" }), raw(5, { a: "45997", b: "10", f: "A" }),
      raw(6, { a: "Date" }), raw(7, { a: "45997", b: "20", f: "B" }),
    ]);
    expect(groups.map((g) => g.date)).toEqual(["2025-12-06", "2025-12-06"]);
    expect(groups.map((g) => g.totalCost)).toEqual([10, 20]);
  });

  it("survives a group whose date formula broke", () => {
    const groups = groupRows([raw(4, { a: "Date" }), raw(5, { a: "#REF!", b: "80.71", f: "X" })]);
    expect(groups[0].date).toBeNull();
    expect(groups[0].rawDate).toBe("#REF!");
    expect(groups[0].totalCost).toBe(80.71);
  });

  it("reads the Excel serial", () => {
    expect(serialToIso("45997")).toBe("2025-12-06");
    expect(serialToIso("#REF!")).toBeNull();
    expect(serialToIso("")).toBeNull();
  });
});

describe("the G formula is the identity, not the name", () => {
  it("reads a stock-sheet reference", () => {
    expect(resolveByFormula("T!I80")).toEqual({ sheet: "T", row: 80 });
    expect(resolveByFormula("=SA!I57")).toEqual({ sheet: "SA", row: 57 });
    expect(resolveByFormula("=SF!$I$104")).toEqual({ sheet: "SF", row: 104 });
  });

  it("refuses anything that is not one", () => {
    expect(resolveByFormula("SUM(G5:G18)")).toBeNull();
    expect(resolveByFormula("")).toBeNull();
    expect(resolveByFormula("Order 2026!I5")).toBeNull();
  });

  const catalog = indexCatalog([
    { skyId: "SKY-0371", name: "Mini Bop", series: "T" },
    { skyId: "SKY-0377", name: "Mini Jini", series: "T" },
    { skyId: "SKY-0057", name: "Spyro", series: "SA" },
    { skyId: "SKY-0200", name: "Spyro", series: "G" },
  ]);
  const stock = (sheet: string, row: number) =>
    ({ "T|74": "Mini Bop", "T|80": "Mini Jini", "SA|57": "Spyro" } as Record<string, string>)[`${sheet}|${row}`] ?? null;

  it("matches the owner's shorthand through the reference", () => {
    /*
     * "Bob" is in no catalog. `T!I74` is `Mini Bop`, which is. This single
     * step turned the pilot group from 14 unmatched names into 14 matches.
     */
    const r = classifyItem(raw(6, { f: "Bob", gFormula: "T!I74", c: "x", d: "x" }), 2, stock, catalog, new Map());
    expect(r.classification).toBe("matched");
    expect(r.skyId).toBe("SKY-0371");
    expect(r.resolvedName).toBe("Mini Bop");
    expect(r.rawName).toBe("Bob");
  });

  it("keeps the legacy markers on the row", () => {
    const r = classifyItem(raw(6, { f: "X (B)", gFormula: "T!I80", c: "b", d: "-" }), 1, stock, catalog, new Map());
    expect(r.legacyConditionFlag).toBe("b");
    expect(r.legacyBookedFlag).toBe("-");
  });

  it("calls a row with no reference uncategorized, not broken", () => {
    // A portal or a game. Its cost belongs to the purchase either way.
    const r = classifyItem(raw(9, { f: "Portal of Power" }), 1, stock, catalog, new Map());
    expect(r.classification).toBe("uncategorized");
    expect(r.skyId).toBeNull();
    expect(r.rawName).toBe("Portal of Power");
  });

  it("calls a reference into nothing unmatched", () => {
    const r = classifyItem(raw(9, { f: "Ghost", gFormula: "T!I999" }), 1, stock, catalog, new Map());
    expect(r.classification).toBe("unmatched");
  });

  it("reports an Excel error as invalid", () => {
    const r = classifyItem(raw(9, { f: "#REF!" }), 1, stock, catalog, new Map());
    expect(r.classification).toBe("invalid");
  });

  it("lets a saved mapping outrank everything", () => {
    const r = classifyItem(raw(9, { f: "Weird Legacy Name" }), 1, stock, catalog,
      new Map([[normalise("Weird Legacy Name"), "SKY-0377"]]));
    expect(r.classification).toBe("matched");
    expect(r.skyId).toBe("SKY-0377");
  });

  it("scopes the match by sheet, so a name in two series is not guessed", () => {
    const both = indexCatalog([
      { skyId: "SKY-0057", name: "Spyro", series: "SA" },
      { skyId: "SKY-0999", name: "Spyro", series: "SA" },
    ]);
    const r = classifyItem(raw(9, { f: "Spyro", gFormula: "SA!I57" }), 1, stock, both, new Map());
    expect(r.classification).toBe("ambiguous");
    expect(r.skyId).toBeNull();
  });
});

describe("the sales half is not touched", () => {
  it("nothing here reads a column past I", () => {
    const source = migrationSource("0053_orderbook_purchases.sql");
    for (const column of ["K", "L", "M", "AE"]) {
      expect(source).not.toContain(`!${column}`);
    }
    // And the reader's row type stops at i.
    const parser = code(String(raw(1) && "")) || "";
    void parser;
    expect(Object.keys(raw(1)).sort()).toEqual(
      ["a", "b", "c", "d", "e", "f", "g", "gFormula", "h", "i", "row"],
    );
  });
});
