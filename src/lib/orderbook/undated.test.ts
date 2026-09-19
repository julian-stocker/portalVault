/**
 * A purchase whose date nobody knows yet (ADR-0088).
 *
 * WHAT CHANGED AND WHY IT IS NOT A LOOSENING
 *
 * Thirteen groups of `Order 2026` carry the literal text `#REF!` where their
 * date formula was: the referenced cell was deleted and the date is gone from
 * the file. The importer called them `blocked` and refused them — correct
 * while "a purchase" meant "a purchase with a date", and wrong once the owner
 * pointed out that 943,80 € was spent and only a number is missing.
 *
 * The thing still refused is INVENTING the date. Not the neighbouring group's,
 * not 2026-01-01 because the sheet is called Order 2026, not the day the
 * import ran. Every one of those is a lie that outlives the session in which
 * it was told, and the last one is the worst: it looks like data.
 */
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { de } from "@/lib/i18n/de";
import { code, latestFunction, migrationSource } from "@/test-support/migrations";
import { planGroup, purchaseFingerprint, sourceNote, type PlanDeps } from "./batch-import.ts";
import { UNDATED, ledgerHref, parseYearFilter, sortLedger } from "./ledger.ts";
import { classifyGroup, indexCatalog, type PurchaseGroup, type RawRow } from "./order-2026.ts";

const SQL = migrationSource("0058_orderbook_undated_purchases.sql");
const LEDGER = code(latestFunction("seller_orderbook_ledger").body);
const SET_DATE = code(latestFunction("seller_set_purchase_date").body);
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const PAGE = read("src/app/(business)/business/orderbuch/page.tsx");
const DETAIL = read("src/app/(business)/business/orderbuch/[id]/page.tsx");
const COMPONENT = read("src/components/business/orderbook-ledger.tsx");
const DATE_EDIT = read("src/components/business/purchase-date.tsx");

const deps = (): PlanDeps => ({
  stockName: (s, r) => (({ "T|74": "Mini Bop" }) as Record<string, string>)[`${s}|${r}`] ?? null,
  bySheetName: indexCatalog([{ skyId: "SKY-0371", name: "Mini Bop", series: "T" }]),
  mappings: new Map(),
  imported: new Set<string>(),
});
const raw = (over: Partial<RawRow> = {}): RawRow =>
  ({ row: 1947, a: "", b: "", c: "x", d: "x", e: "1", f: "Bob", g: "", gFormula: "T!I74", h: "", i: "", ...over });
const group = (over: Partial<PurchaseGroup> = {}): PurchaseGroup => ({
  headerRow: 1946, firstRow: 1947, lastRow: 1988, date: null, rawDate: "#REF!",
  totalCost: 37.69, items: [raw()], ...over,
});

describe("the column accepts a missing date", () => {
  it("0058 drops NOT NULL and rewrites nothing", () => {
    expect(SQL).toContain("alter column purchased_at drop not null");
    expect(code(SQL)).not.toMatch(/create table|drop table|delete from|update public\.purchases set/i);
  });

  it("and says in the schema what NULL means", () => {
    // A nullable date with no comment invites the next reader to fill it in.
    expect(SQL).toContain("comment on column public.purchases.purchased_at");
    expect(SQL).toContain("not known YET");
  });
});

describe("an undated group imports, and no date is invented", () => {
  it("is eligible rather than blocked", async () => {
    const plan = await planGroup(group(), deps());
    expect(plan.status).toBe("eligible");
    expect(plan.reason).toBeNull();
  });

  it("carries no date at all", async () => {
    const plan = await planGroup(group(), deps());
    expect(plan.date).toBeNull();
    expect(typeof plan.date).not.toBe("string");
  });

  it("keeps `#REF!` as provenance, because the cell it names is gone", () => {
    expect(sourceNote({ headerRow: 1946, firstRow: 1947, lastRow: 1988, date: null, rawDate: "#REF!" }))
      .toContain("Kaufdatum im Workbook: #REF!");
  });

  it("but a group with no COST is still blocked — that is a different fault", async () => {
    const plan = await planGroup(group({ totalCost: null }), deps());
    expect(plan.status).toBe("blocked");
  });

  it("and the importer still refuses Excel error values among the item names", async () => {
    const plan = await planGroup(group({ items: [raw({ f: "#REF!", gFormula: "" })] }), deps());
    expect(plan.status).toBe("blocked");
  });
});

describe("fingerprints without a date", () => {
  it("thirteen dateless groups get thirteen identities", async () => {
    /*
     * The scheme never needed a date: it keys on the sheet and the group's own
     * header row. Which is why no fake date was required to make this work.
     */
    const rows = [1946, 1989, 2005, 2008, 2088, 2090, 2105, 2112, 2168, 2213, 2268, 2278, 2283];
    const prints = await Promise.all(rows.map((headerRow) =>
      purchaseFingerprint({ headerRow, date: null, totalCost: 37.69 }, [])));
    expect(new Set(prints).size).toBe(rows.length);
  });

  it("and a dateless group never collides with a dated one", async () => {
    const dateless = await purchaseFingerprint({ headerRow: 1946, date: null, totalCost: 37.69 }, []);
    const dated = await purchaseFingerprint({ headerRow: 1946, date: "2026-01-03", totalCost: 37.69 }, []);
    expect(dateless).not.toBe(dated);
  });
});

describe("the filters", () => {
  it("`Ohne Datum` is its own state, not a year", () => {
    expect(UNDATED).toBe("ohne");
    expect(parseYearFilter("ohne")).toBe("ohne");
    expect(parseYearFilter("2026")).toBe(2026);
    expect(parseYearFilter(undefined)).toBeUndefined();
    expect(parseYearFilter("nonsense")).toBeUndefined();
  });

  it("selects exactly purchased_at IS NULL", () => {
    expect(LEDGER).toContain("then p.purchased_at is null");
  });

  it("a year filter excludes undated purchases by itself", () => {
    /*
     * `extract(year from null)` is NULL and `NULL = 2026` is not true, so no
     * extra clause is needed — and none was added, which is why 2025 and 2026
     * kept working untouched.
     */
    expect(LEDGER).toContain("extract(year  from p.purchased_at) = p_year");
  });

  it("no filter at all includes them", () => {
    // `Alle Jahre` is p_year NULL and p_undated false -> the year branch, whose
    // own condition is `p_year is null or …`, which is true.
    expect(LEDGER).toContain("p_year  is null or");
  });

  it("drops the month when the year filter is `Ohne Datum`", () => {
    // There is no date to be in a month of.
    expect(ledgerHref(UNDATED, 7, null)).toBe("/business/orderbuch?jahr=ohne");
    expect(ledgerHref(2026, 7, null)).toBe("/business/orderbuch?jahr=2026&monat=7");
  });

  it("and the page offers no month chips there", () => {
    expect(PAGE).toContain("typeof year === \"number\" ? (");
    expect(PAGE).toContain("copy.undatedFilter");
  });

  it("an undated purchase contributes no year to the year list", () => {
    const queries = read("src/lib/orderbook/queries.ts");
    expect(queries).toContain("p.purchasedAt !== null");
  });
});

describe("sorting", () => {
  it("puts undated purchases last, as a block", () => {
    const sorted = sortLedger([
      { id: 81, purchasedAt: null }, { id: 80, purchasedAt: "2026-08-17" },
      { id: 85, purchasedAt: null }, { id: 6, purchasedAt: "2025-12-06" },
    ]);
    expect(sorted.map((p) => p.id)).toEqual([80, 6, 85, 81]);
  });

  it("orders the undated block deterministically by id", () => {
    const sorted = sortLedger([{ id: 81, purchasedAt: null }, { id: 93, purchasedAt: null }]);
    expect(sorted.map((p) => p.id)).toEqual([93, 81]);
  });

  it("and the database agrees — `nulls last`, not Postgres's default", () => {
    /*
     * Postgres sorts NULLs FIRST under `desc`. Without this the thirteen
     * dateless purchases would sit above the newest real one and read as this
     * week's parcels.
     */
    expect(LEDGER).toContain("order by m.purchased_at desc nulls last, m.id desc");
  });
});

describe("the screen never shows a fake date", () => {
  it("says so in words instead", () => {
    expect(de.business.orderbook.undated).toBe("Datum fehlt");
    expect(COMPONENT).toContain("iso === null");
    expect(COMPONENT).toContain("copy.undated");
  });

  it("and never constructs a Date from null", () => {
    // `new Date(null)` is 01.01.1970; `new Date(undefined)` is Invalid Date.
    expect(COMPONENT).not.toMatch(/new Date\(purchase\.purchasedAt\)/);
    expect(DETAIL).toContain("purchase.purchasedAt === null");
  });

  it("the detail page heading falls back to the same words", () => {
    expect(DETAIL).toContain("copy.undated");
  });
});

describe("assigning the date later", () => {
  it("has its own function, because NULL had to stop meaning `leave alone`", () => {
    /*
     * `seller_update_purchase` writes `coalesce(p_purchased_at, …)`, the right
     * reading for a partial update and one that makes clearing impossible to
     * say. So the date gets a function where NULL IS the instruction.
     */
    expect(SET_DATE).toContain("set purchased_at = p_purchased_at");
    expect(SET_DATE).not.toContain("coalesce(p_purchased_at");
  });

  it("is seller-gated like everything else", () => {
    expect(SET_DATE).toContain("can_operate_active_seller()");
    expect(SET_DATE).toContain("insufficient_privilege");
    expect(SQL).toContain("revoke all on function public.seller_set_purchase_date(bigint, date) from public, anon;");
    expect(SQL).toContain("grant execute on function public.seller_set_purchase_date(bigint, date) to authenticated;");
  });

  it("refuses an implausible date instead of storing a typo", () => {
    expect(SET_DATE).toContain("outside the plausible range");
  });

  it("touches the date and nothing else", () => {
    // Not the identity, not the fingerprint, not the items, and never stock.
    for (const forbidden of ["import_fingerprint", "total_cost", "purchase_items",
                             "record_inventory_movement", "shop_inventory", "delete"]) {
      expect(SET_DATE, forbidden).not.toContain(forbidden);
    }
  });

  it("the action clears with null rather than a magic string", () => {
    const actions = read("src/lib/orderbook/actions.ts");
    expect(actions).toContain("setPurchaseDate(id: number, purchasedAt: string | null)");
    expect(actions).toContain('run("seller_set_purchase_date"');
  });

  it("the editor offers assign, change and clear", () => {
    expect(DATE_EDIT).toContain("copy.setDate");
    expect(DATE_EDIT).toContain("copy.changeDate");
    expect(DATE_EDIT).toContain("copy.clearDate");
    expect(DATE_EDIT).toContain("save(null)");
    expect(DATE_EDIT).toContain('type="date"');
  });

  it("and re-reads from the server rather than guessing the new state", () => {
    // The ledger, the filters and the summary all move with it.
    expect(DATE_EDIT).toContain("router.refresh()");
    expect(DATE_EDIT).not.toContain("useOptimistic");
  });

  it("it lives on the detail page, not in every ledger row", () => {
    // A date input per row would cost the density the ledger exists for, to
    // serve thirteen rows out of eighty-four.
    expect(DETAIL).toContain("<PurchaseDate");
    expect(COMPONENT).not.toContain("PurchaseDate");
  });
});

describe("search does not need a date", () => {
  it("every date comparison yields NULL for an undated row, and the rest still match", () => {
    expect(LEDGER).toContain("h.total_cost::text");
    expect(LEDGER).toContain("coalesce(h.note, '')");
    expect(LEDGER).toContain("i.raw_name ilike");
    expect(LEDGER).toContain("s.name     ilike");
  });

  it("and the `#REF!` provenance is in the note, so it is searchable", () => {
    expect(sourceNote({ headerRow: 1946, firstRow: 1947, lastRow: 1988, date: null, rawDate: "#REF!" }))
      .toContain("#REF!");
  });
});

describe("the classification rules are untouched", () => {
  it("a damaged row in an undated group is still ignored", () => {
    const preview = classifyGroup(
      [raw({ row: 1980, c: "b", f: "jet stream (b)", gFormula: "" }), raw({ row: 1981 })],
      deps().stockName, deps().bySheetName, new Map());
    expect(preview.ignoredDamaged).toHaveLength(1);
    expect(preview.migrated).toHaveLength(1);
  });

  it("and the migrated rows still reconcile", () => {
    const preview = classifyGroup(
      [raw({ row: 1980, c: "b", f: "x (b)" }), raw({ row: 1981 })],
      deps().stockName, deps().bySheetName, new Map());
    expect(preview.sourceRows).toBe(preview.migrated.length + preview.ignoredDamaged.length + preview.invalid.length);
  });
});
