/**
 * Test and Unvollständig: two classifications, three axes, no new columns of
 * state that can go stale (0063).
 *
 * WHAT THIS FILE IS DEFENDING
 *
 * 1. `Unvollständig` is DERIVED. The old `Datum fehlt` filter was a single
 *    predicate wearing a label, and the temptation when broadening it was to
 *    change the label and leave the predicate — or, worse, to add an
 *    `is_incomplete` column that would be wrong the first time somebody
 *    supplied a missing date. Neither happened, and both are checked here.
 *
 * 2. `Test` is FIRST CLASS, and it is derived from canonical data wherever
 *    canonical data exists. An internal sale reads `orders.commerce_mode`,
 *    which is stamped when the order is placed and frozen afterwards; only a
 *    hand-made purchase or external sale, which has no such signal, carries a
 *    boolean of its own. Note text decides nothing at runtime.
 *
 * 3. The three axes stay independent: Intern/Extern is where a sale happened,
 *    Test is what kind of record it is, Unvollständig is whether it still
 *    needs work. A test sale is still external. An incomplete sale is still
 *    real. A record may be both test and incomplete — sale 312 is.
 *
 * 4. None of it touches inventory, money or provenance.
 */
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { de } from "@/lib/i18n/de";
import { allMigrations, code, columnsOf, columnsWritten, latestFunction, migrationSource }
  from "@/test-support/migrations";
import {
  EMPTY_COUNTS, ORDERBOOK_STATUSES, countFor, parseStatus, readCounts, rpcStatus,
} from "./classification.ts";
import { ledgerHref } from "./ledger.ts";
import { SALE_TEMPLATES } from "./sale-template.ts";
import { salesHref } from "./sales-view.ts";

const SQL = migrationSource("0063_orderbook_test_classification.sql");
const LEDGER = code(latestFunction("seller_orderbook_ledger").body);
const SALES = code(latestFunction("seller_sales").body);
const SALE_DOC = code(latestFunction("seller_sale").body);
const IS_TEST = code(latestFunction("sale_is_test").body);
const SET_PURCHASE_TEST = code(latestFunction("seller_set_purchase_test").body);
/** The one-off data correction at the end of 0063, and nothing above it. */
const BACKFILL = SQL.slice(SQL.indexOf("-- 9. The two retained Staging smoke records"));
const SET_SALE_TEST = code(latestFunction("seller_set_sale_test").body);
const CREATE_PURCHASE = code(latestFunction("seller_create_purchase").body);
const CREATE_SALE = code(latestFunction("seller_create_sale").body);

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const EINKAUF = read("src/app/(business)/business/orderbuch/page.tsx");
const VERKAUF = read("src/app/(business)/business/orderbuch/verkauf/page.tsx");
const NAV = read("src/components/business/orderbook-nav.tsx");
const NEW_PURCHASE = read("src/components/business/new-purchase.tsx");
const NEW_SALE = read("src/components/business/new-sale.tsx");
const TEST_FLAG = read("src/components/business/test-flag.tsx");
const PURCHASE_PAGE = read("src/app/(business)/business/orderbuch/[id]/page.tsx");
const SALE_PAGE = read("src/app/(business)/business/orderbuch/verkauf/[id]/page.tsx");
const EINKAUF_LEDGER = read("src/components/business/orderbook-ledger.tsx");
const SALES_LEDGER = read("src/components/business/sales-ledger.tsx");


// ---------------------------------------------------------------------------
// The compact navigation
// ---------------------------------------------------------------------------

describe("the header is two tabs and one small action", () => {
  it("`+ Neu` sits in the tab row, not in a heading block of its own", () => {
    // The action is a child of the same element the tabs are in.
    const row = NAV.slice(NAV.indexOf('role="tablist"'), NAV.indexOf("StatusFilter"));
    expect(row).toContain("newHref ? (");
    expect(row).toContain("copy.newCompact");
    expect(de.business.orderbook.newCompact).toBe("+ Neu");
  });

  it("and it is compact without giving a thumb less than 44 px", () => {
    // 44 px on a phone, tighter from `sm:` up — the same bargain
    // `ACTION_COMMERCE_COMPACT` strikes on the quick-view offer line.
    expect(NAV).toContain("min-h-11");
    expect(NAV).toContain("sm:min-h-8");
    // Never the full-width primary: that is the shape this replaced.
    expect(NAV).not.toContain("ACTION_PRIMARY");
    expect(NAV).not.toContain("w-full");
  });

  it("there is exactly ONE creation control per screen", () => {
    /*
     * The large `+ Neuer Einkauf` / `+ Neuer Verkauf` buttons are gone rather
     * than kept beside the compact one. Two controls doing one thing is how a
     * screen teaches somebody that it has two things.
     */
    for (const page of [EINKAUF, VERKAUF]) {
      expect(page).not.toContain("ACTION_PRIMARY");
      // One `<OrderbookNav`, and no second link to the creation route.
      expect(page.match(/<OrderbookNav/g)?.length).toBe(1);
      expect(page.match(/orderbuch\/neu/g)?.length ?? 0).toBeLessThanOrEqual(2);
    }
  });

  it("the tab row survives a narrow screen", () => {
    // Wrapping, not overflowing: the row is the page's widest fixed element.
    expect(NAV).toContain("flex-wrap");
    expect(NAV).toContain("shrink-0");
  });

  it("the visible label is short and the accessible one is a sentence", () => {
    /*
     * A screen reader announcing "plus neu" has been told nothing. The whole
     * sentence rides on `aria-label` and `title`, which is also what a pointer
     * user sees on hover.
     */
    expect(NAV).toContain("title={newLabel}");
    expect(NAV).toContain("aria-label={newLabel}");
    expect(de.business.orderbook.newPurchase).toBe("Neuen Einkauf anlegen");
    expect(de.business.sales.newSale).toBe("Neuen externen Verkauf anlegen");
  });
});

describe("`+ Neu` means whatever the tab beside it means", () => {
  it("Einkauf creates a purchase", () => {
    expect(EINKAUF).toContain('"/business/orderbuch/neu"');
    expect(EINKAUF).toContain("newLabel={copy.newPurchase}");
  });

  it("Verkauf → Extern creates an external sale", () => {
    expect(VERKAUF).toMatch(/scope === "extern"[\s\S]{0,200}verkauf\/neu/);
    expect(VERKAUF).toContain("newLabel={copy.newSale}");
  });

  it("Verkauf → Intern creates nothing at all", () => {
    /*
     * Null, so the header renders no action — not a disabled button, which
     * would advertise a door that is not there. An internal sale exists
     * because an order was paid; `seller_create_sale` refuses the channel.
     */
    expect(VERKAUF).toMatch(/scope === "extern"[\s\S]{0,250}: null;/);
    expect(NAV).toContain("newHref ? (");
    expect(NAV).toContain(": null}");
    expect(CREATE_SALE).toContain("internal sales are created from a paid order, not by hand");
    // And the screen says why, rather than leaving a gap.
    expect(VERKAUF).toContain("copy.internalNoCreate");
    expect(de.business.sales.internalNoCreate).toContain("bezahlten");
  });

  it("the creation form is never reachable for an internal sale", () => {
    /*
     * The hard-coded CHANNELS list became the template list in 0065 — a
     * template carries the channel it writes. The property is unchanged and
     * is asserted where it now lives: no template names `skyisles`, and the
     * form still renders no option for it.
     */
    expect(SALE_TEMPLATES.map((t) => t.channel).sort()).toEqual(["ebay", "manual"]);
    expect(SALE_TEMPLATES.some((t) => t.channel === "skyisles")).toBe(false);
    expect(NEW_SALE).not.toMatch(/value="skyisles"/);
    expect(NEW_SALE).toContain("SALE_TEMPLATES");
  });
});


// ---------------------------------------------------------------------------
// Unvollständig
// ---------------------------------------------------------------------------

describe("`Datum fehlt` became a real classification, not a new label", () => {
  it("the filter is `Unvollständig` and it is one of four", () => {
    // `Offen` joined them in 0066 — a fourth, independent axis, not a
    // replacement for any of these three.
    expect(ORDERBOOK_STATUSES).toEqual(["alle", "offen", "unvollstaendig", "test"]);
    expect(de.business.orderbook.status.incomplete).toBe("Unvollständig");
    expect(de.business.orderbook.status.all).toBe("Alle");
    expect(de.business.orderbook.status.test).toBe("Test");
    expect(de.business.orderbook.status.open).toBe("Offen");
  });

  it("and the predicate genuinely widened — it is not `purchased_at is null` renamed", () => {
    const rule = LEDGER.slice(LEDGER.indexOf("as is_incomplete") - 400,
                              LEDGER.indexOf("as is_incomplete"));
    expect(rule).toContain("p.purchased_at is null");
    // The second disjunct. Without it this would be the old filter in a hat.
    expect(rule).toContain("p.source = 'manual' and v.total_items = 0");
    expect(rule).toContain(" or ");
  });

  it("a missing date still qualifies, which is what keeps the old rows visible", () => {
    // The three historical sales with NULL `sold_at` and the thirteen `#REF!`
    // purchases are the rows this must not drop.
    expect(LEDGER).toContain("p.purchased_at is null");
    expect(SALES).toContain("b.effective_date is null");
  });

  it("supplying the date removes the row from the class, with nobody clearing a flag", () => {
    /*
     * The whole reason this is derived. `seller_set_purchase_date` writes one
     * column; the classification is recomputed on the next read and the row
     * leaves `Unvollständig` by itself.
     */
    expect(columnsOf("purchases")).not.toContain("is_incomplete");
    expect(columnsOf("sales")).not.toContain("is_incomplete");
    expect(code(allMigrations)).not.toMatch(/\bis_incomplete\s+boolean/);
    // It is computed inside the read models, which are `stable` and write
    // nothing.
    expect(LEDGER).toContain("as is_incomplete");
    expect(SALES).toContain("as is_incomplete");
    expect(LEDGER).toContain("stable");
    expect(SALES).toContain("stable");
  });
});

describe("what Unvollständig means, separately for each of the three", () => {
  const EXTERNAL = SALES.slice(SALES.indexOf("else b.effective_date is null"),
                               SALES.indexOf("as is_incomplete"));
  const INTERNAL = SALES.slice(SALES.indexOf("case when b.order_id is not null"),
                               SALES.indexOf("else b.effective_date is null"));

  it("Einkauf: no date, or a hand-made purchase with nothing in it", () => {
    expect(LEDGER).toContain("(p.purchased_at is null\n            or (p.source = 'manual' and v.total_items = 0))");
  });

  it("Verkauf Extern: no date, or a hand-made sale with no items or no money", () => {
    expect(EXTERNAL).toContain("b.effective_date is null");
    expect(EXTERNAL).toContain("b.source = 'manual'");
    expect(EXTERNAL).toContain("b.item_count = 0");
    // 0/0 is the placeholder `seller_create_sale` writes, so it means "the
    // amounts were never entered" rather than "this sale was free".
    expect(EXTERNAL).toContain("coalesce(b.items_subtotal, 0) = 0");
    expect(EXTERNAL).toContain("coalesce(b.shipping_charged, 0) = 0");
    expect(CREATE_SALE).toContain("0, 0, 0");
  });

  it("Verkauf Intern: only a projection that disagrees with commerce", () => {
    /*
     * Commerce owns an internal sale's facts, so the Orderbuch may not call
     * one incomplete for lacking Orderbuch extras. What it MAY report is a
     * sale whose order is not actually paid, has no payment time, or has no
     * lines — three states that should not exist.
     */
    expect(INTERNAL).toContain("b.payment_status is distinct from 'paid'");
    expect(INTERNAL).toContain("b.effective_date is null");
    expect(INTERNAL).toContain("b.item_count = 0");
    // And nothing about fees, payouts, notes or shipping.
    for (const owned of ["reported_payout", "fees_total", "note", "shipped_at", "buyer_ref"]) {
      expect(INTERNAL, owned).not.toContain(owned);
    }
  });

  it("an optional field being empty is never incomplete", () => {
    const rules = [LEDGER.slice(LEDGER.indexOf("(p.purchased_at is null"), LEDGER.indexOf("as is_incomplete")),
                   SALES.slice(SALES.indexOf("(case when b.order_id is not null"), SALES.indexOf("as is_incomplete"))];
    for (const rule of rules) {
      for (const optional of ["note", "buyer_ref", "external_order_ref",
                              "destination_country_code", "currency", "shipped_at"]) {
        expect(rule, optional).not.toContain(optional);
      }
    }
  });

  it("an unpaid marketplace payout is not a gap in the record", () => {
    /*
     * Workflow status is not accounting status. Since ADR-0095 there is no
     * reported payout at all — the figure is derived — so `Unvollständig`
     * could not depend on one even if somebody wanted it to.
     */
    const rule = SALES.slice(SALES.indexOf("(case when b.order_id is not null"),
                             SALES.indexOf("as is_incomplete"));
    expect(rule).not.toContain("reported_payout");
    // The filter and its copy are gone with the workflow.
    expect((de.business.sales as Record<string, unknown>).openFilter).toBeUndefined();
    expect((de.business.sales as Record<string, unknown>).openPayouts).toBeUndefined();
  });

  it("an item awaiting Einbuchen or Ausbuchen is a pending state, not an omission", () => {
    const rules = [LEDGER.slice(LEDGER.indexOf("(p.purchased_at is null"), LEDGER.indexOf("as is_incomplete")),
                   SALES.slice(SALES.indexOf("(case when b.order_id is not null"), SALES.indexOf("as is_incomplete"))];
    for (const rule of rules) {
      for (const stock of ["movement_id", "booked_items", "state =", "returned_at"]) {
        expect(rule, stock).not.toContain(stock);
      }
    }
  });

  it("a suspicious YEAR is not a rule — the 2028 sale is not called incomplete", () => {
    /*
     * The workbook contains one sale dated 2028-06-28. Reading a stored date
     * as wrong because it looks odd would be a guess; `seller_set_sale_date`
     * already refuses implausible dates on the way in, and that is where a
     * validation rule belongs.
     */
    const rule = SALES.slice(SALES.indexOf("(case when b.order_id is not null"),
                             SALES.indexOf("as is_incomplete"));
    expect(rule).not.toContain("2028");
    expect(rule).not.toContain("current_date");
    expect(rule).not.toMatch(/extract\(year/);
    // The header prose explains the 2028 row; no executable statement names it.
    expect(code(SQL)).not.toContain("2028");
  });

  it("a faithfully imported group with no items is complete, not unfinished", () => {
    // An imported row's items are the workbook's: nothing on these screens can
    // add one, so an itemless imported group would sit in a work list for ever
    // with nobody able to finish it. Scoped to `manual` for that reason, not
    // because such a row exists today — on Staging none does.
    expect(LEDGER).toContain("p.source = 'manual' and v.total_items = 0");
    expect(LEDGER).not.toContain("p.source = 'excel_order_2026' and v.total_items = 0");
    const external = SALES.slice(SALES.indexOf("else b.effective_date is null"),
                                 SALES.indexOf("as is_incomplete"));
    expect(external).toContain("b.source = 'manual'");
    expect(external).not.toContain("excel_order_2026");
  });
});


// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("Test is first class, and derived wherever canonical data exists", () => {
  it("a hand-made purchase or external sale carries one boolean, defaulting to false", () => {
    expect(columnsOf("purchases")).toContain("is_test");
    expect(columnsOf("sales")).toContain("is_test");
    expect(SQL).toContain("add column if not exists is_test boolean not null default false");
    // Two tables, two columns, and no tagging framework beside them.
    expect(code(SQL)).not.toMatch(/create table/i);
  });

  it("an internal sale takes its answer from the order's frozen commerce mode", () => {
    /*
     * `orders.commerce_mode` is stamped when the order is placed and refused
     * afterwards by `orders_protect_immutable()` (0021) — the same signal the
     * order screens have used since 0046. Copying it onto `sales` would be a
     * second truth about one order.
     */
    expect(IS_TEST).toContain("when s.order_id is null then s.is_test");
    expect(IS_TEST).toContain("else o.commerce_mode = 'sandbox'");
    expect(IS_TEST).toContain("left join public.orders o on o.id = s.order_id");
  });

  it("and that answer cannot be contradicted by a column on the sale", () => {
    expect(SQL).toContain("check (order_id is null or is_test = false)");
    expect(SET_SALE_TEST).toContain("an internal sale takes its test status from the order");
  });

  it("there is ONE definition, called rather than repeated", () => {
    // The list and the detail document both call it; neither rebuilds the CASE.
    expect(SALES).toContain("public.sale_is_test(s.id)");
    expect(SALE_DOC).toContain("public.sale_is_test(p_id)");
    expect(SALES).not.toContain("commerce_mode = 'sandbox'");
    expect(SALE_DOC).not.toContain("commerce_mode = 'sandbox'");
  });

  it("nothing at runtime reads a note to decide what a record is", () => {
    /*
     * The one place note text decides anything is the one-off backfill at the
     * end of 0063, which runs once and checks four fields at a time. A
     * classification that changes when somebody fixes a typo is not one.
     */
    for (const fn of [LEDGER, SALES, SALE_DOC, IS_TEST, SET_SALE_TEST, SET_PURCHASE_TEST]) {
      expect(fn).not.toMatch(/TEST(KAUF|VERKAUF)/i);
      expect(fn).not.toMatch(/note\s+ilike\s+'%test/i);
    }
  });

  it("the two retained Staging smoke records are marked by identity, not by id alone", () => {
    const backfill = BACKFILL;
    expect(backfill).toContain("p.id = 94");
    expect(backfill).toContain("p.source = 'manual'");
    expect(backfill).toContain("p.import_fingerprint is null");
    expect(backfill).toContain("p.note = 'TESTKAUF 0063-smoke'");

    expect(backfill).toContain("s.id = 312");
    expect(backfill).toContain("s.source = 'manual'");
    expect(backfill).toContain("s.order_id is null");
    expect(backfill).toContain("s.import_fingerprint is null");
    expect(backfill).toContain("s.external_order_ref = 'TESTVERKAUF-0063'");
  });

  it("and the backfill cannot reach imported history in either table", () => {
    const backfill = code(BACKFILL);
    // Both statements require `source = 'manual'` and no fingerprint, which is
    // exactly what every imported row is not.
    expect(backfill.match(/source = 'manual'/g)?.length).toBe(2);
    expect(backfill.match(/import_fingerprint is null/g)?.length).toBe(2);
    expect(backfill).not.toContain("excel_order_2026");
    // It marks. It does not delete, and it writes nothing but the one column.
    expect(backfill).not.toMatch(/delete/i);
    expect(columnsWritten(backfill, "purchases")).toEqual(["is_test"]);
    expect(columnsWritten(backfill, "sales")).toEqual(["is_test"]);
  });

  it("no importer ever sets it, so historical rows are normal business records", () => {
    for (const fn of ["seller_import_purchase_group", "seller_import_sale_group",
                      "seller_import_settlement_adjustment"]) {
      expect(code(latestFunction(fn).body), fn).not.toContain("is_test");
    }
  });
});

describe("the three axes stay independent", () => {
  it("Test is a classification, never a channel", () => {
    // Intern and Extern are still exactly a scope over `order_id`.
    expect(SALES).toContain("p_scope = 'internal' and b.order_id is not null");
    expect(SALES).toContain("p_scope = 'external' and b.order_id is null");
    // And the classification filter never touches the scope.
    const start = SALES.indexOf("where case v_status", SALES.indexOf("matched as ("));
    const classFilter = SALES.slice(start, SALES.indexOf("end\n  )", start));
    expect(classFilter).not.toContain("order_id");
    expect(classFilter).not.toContain("p_scope");
  });

  it("they are two URL parameters, so any combination is reachable", () => {
    expect(salesHref("intern", undefined, undefined, null, "test"))
      .toBe("/business/orderbuch/verkauf?bereich=intern&status=test");
    expect(salesHref("extern", undefined, undefined, null, "unvollstaendig"))
      .toBe("/business/orderbuch/verkauf?status=unvollstaendig");
  });

  it("Test is independent of Unvollständig — a record may be both", () => {
    /*
     * They are two separate expressions over two separate inputs, and neither
     * appears in the other. Sale 312 on Staging is a test sale whose amounts
     * were never entered: test AND incomplete.
     */
    const incomplete = SALES.slice(SALES.indexOf("(case when b.order_id is not null"),
                                   SALES.indexOf("as is_incomplete"));
    expect(incomplete).not.toContain("is_test");
    expect(incomplete).not.toContain("classified_test");
    expect(IS_TEST).not.toContain("is_incomplete");
    // Both travel to the screen, separately, on every row.
    expect(SALES).toContain("'is_test', m.classified_test, 'is_incomplete', m.is_incomplete");
    expect(LEDGER).toContain("'is_test', m.is_test, 'is_incomplete', m.is_incomplete");
  });

  it("and the row shows the marks, independently", () => {
    // `isOpen` joined them in 0066 and is optional, so a caller that does not
    // know about it still renders the other two.
    expect(NAV).toContain("export function RowMarks({ isTest, isIncomplete, isOpen = false }");
    expect(NAV).toContain("if (!isTest && !isIncomplete && !isOpen) return null;");
    for (const ledger of [EINKAUF_LEDGER, SALES_LEDGER]) {
      expect(ledger).toContain("<RowMarks isTest=");
      expect(ledger).toContain("isOpen=");
    }
  });
});


// ---------------------------------------------------------------------------
// What the lists and the totals contain
// ---------------------------------------------------------------------------

describe("the default view is the business ledger", () => {
  it("`normal` is the default, in the database and in the reader", () => {
    expect(LEDGER).toContain("p_status  text    default 'normal'");
    expect(SALES).toContain("p_status  text    default 'normal'");
    expect(read("src/lib/orderbook/queries.ts")).toContain('status: StatusScope = "normal"');
    expect(read("src/lib/orderbook/sales-queries.ts")).toContain('status: StatusScope = "normal"');
  });

  it("and it excludes test records", () => {
    expect(LEDGER).toContain("when 'normal'     then not r.is_test");
    expect(SALES).toContain("when 'normal'     then not r.classified_test");
  });

  it("but never silently — the chip carries the count and a line says where they went", () => {
    expect(NAV).toContain("countFor(counts, s)");
    expect(NAV).toContain("copy.status.hiddenHint(counts.test)");
    expect(de.business.orderbook.status.hiddenHint(1)).toContain("Test");
    expect(de.business.orderbook.status.hiddenHint(3)).toContain("3");
  });

  it("an unknown status in the URL is the default, not an error page", () => {
    expect(parseStatus(undefined)).toBe("alle");
    expect(parseStatus("nonsense")).toBe("alle");
    expect(parseStatus("unvollstaendig")).toBe("unvollstaendig");
    expect(parseStatus("test")).toBe("test");
    // …and the database refuses anything it does not know rather than guessing.
    expect(LEDGER).toContain("unknown orderbook status filter");
    expect(SALES).toContain("unknown orderbook status filter");
  });
});

describe("normal business totals are not polluted by test data", () => {
  it("the summary aggregates exactly the rows returned", () => {
    // One CTE chain: the classification filter is applied before the summary
    // is taken, so excluding a test row excludes its money too.
    expect(LEDGER).toContain("from matched m");
    expect(SALES).toContain("from matched m");
    expect(LEDGER).toContain("when 'normal'     then not r.is_test");
    expect(LEDGER.indexOf("when 'normal'     then not r.is_test"))
      .toBeLessThan(LEDGER.indexOf("'total_cost',     coalesce(sum(m.total_cost), 0)"));
    expect(SALES.indexOf("when 'normal'     then not r.classified_test"))
      .toBeLessThan(SALES.indexOf("'gross',      coalesce(sum("));
  });

  it("and the Test view still shows what the test rows come to", () => {
    // Same query, same summary — there is no second, test-blind aggregate.
    expect(LEDGER).toContain("when 'test'       then r.is_test");
    expect(SALES).toContain("when 'test'       then r.classified_test");
  });

  it("the counts describe the current view, not the whole database", () => {
    // Taken from `searched`: after year, month, scope and search; before the
    // classification filter.
    expect(LEDGER).toContain("from searched r");
    expect(SALES).toContain("from searched r");
    expect(LEDGER.indexOf("searched as (")).toBeGreaterThan(LEDGER.indexOf("filtered as ("));
  });

  it("the year chips still offer a year whose only rows are tests", () => {
    // `any` is not reachable from the URL and exists for exactly this.
    expect(read("src/lib/orderbook/queries.ts")).toContain('fetchLedger(undefined, undefined, undefined, "any")');
    expect(read("src/lib/orderbook/sales-queries.ts")).toContain('"any")');
    expect(LEDGER).toContain("else true");
  });
});


// ---------------------------------------------------------------------------
// Creating and correcting
// ---------------------------------------------------------------------------

describe("creating a record that is a test from the start", () => {
  it("both creation functions take the flag, defaulting to false", () => {
    expect(CREATE_PURCHASE).toContain("p_is_test      boolean default false");
    expect(CREATE_SALE).toContain("p_is_test boolean default false");
    expect(CREATE_PURCHASE).toContain("coalesce(p_is_test, false)");
    expect(CREATE_SALE).toContain("coalesce(p_is_test, false)");
  });

  it("and the old signatures are dropped rather than overloaded", () => {
    // A trailing defaulted argument beside the old signature makes every call
    // ambiguous — reported at call time, not at apply time.
    expect(SQL).toContain("drop function if exists public.seller_create_purchase(date, numeric, text);");
    expect(SQL).toContain("drop function if exists public.seller_create_sale(text, date, text, text, text, text);");
    expect(SQL).toContain("drop function if exists public.seller_orderbook_ledger(integer, integer, text, boolean);");
    expect(SQL).toContain("drop function if exists public.seller_sales(integer, integer, text, boolean, text, boolean);");
  });

  it("both forms offer one unticked checkbox", () => {
    for (const form of [NEW_PURCHASE, NEW_SALE]) {
      expect(form).toContain('type="checkbox"');
      expect(form).toContain("defaultTest = false");
      expect(form).toContain("useState(defaultTest)");
    }
    expect(NEW_PURCHASE).toContain("copy.testFlag");
    expect(NEW_SALE).toContain("create.testFlag");
    expect(de.business.orderbook.testFlag).toBe("Testvorgang");
    expect(de.business.sales.create.testFlag).toBe("Testvorgang");
  });

  it("and creating from inside the Test view arrives with it already ticked", () => {
    expect(EINKAUF).toContain("/business/orderbuch/neu?test=1");
    expect(VERKAUF).toContain("/business/orderbuch/verkauf/neu?test=1");
    expect(read("src/app/(business)/business/orderbuch/neu/page.tsx")).toContain('test === "1"');
    expect(read("src/app/(business)/business/orderbuch/verkauf/neu/page.tsx")).toContain('test === "1"');
  });
});

describe("correcting it afterwards", () => {
  it("a purchase's flag can be set and taken away", () => {
    expect(SET_PURCHASE_TEST).toContain("set is_test    = coalesce(p_is_test, false)");
    expect(PURCHASE_PAGE).toContain('<TestFlag kind="purchase"');
  });

  it("an external sale's can too, under 0062's concurrency token", () => {
    expect(SET_SALE_TEST).toContain("orderbook_guard_stale(p_id, p_expected_updated_at)");
    expect(SALE_PAGE).toContain('<TestFlag kind="sale"');
    expect(SALE_PAGE).toContain("expectedUpdatedAt=");
  });

  it("and the change is audited where 0062's trail applies", () => {
    expect(SET_SALE_TEST).toContain("orderbook_log(p_id, 'sale', p_id, 'update', 'is_test'");
    expect(SET_SALE_TEST).toContain("v_old::text");
  });

  it("an internal sale gets a sentence instead of a control", () => {
    expect(SALE_PAGE).toContain("copy.testFromOrder");
    expect(SALE_PAGE).toMatch(/internal \? \([\s\S]{0,600}<TestFlag kind="sale"/);
    expect(TEST_FLAG).toContain("WHY THERE IS NO TOGGLE ON AN INTERNAL SALE");
  });

  it("changing the classification moves nothing else", () => {
    /*
     * Not the money, not the channel, not the date, not the items, not the
     * provenance — the functions name none of those columns — and nothing
     * about inventory is reachable from here at all.
     */
    for (const fn of [SET_PURCHASE_TEST, SET_SALE_TEST]) {
      for (const forbidden of ["source", "import_fingerprint", "channel", "sold_at",
                               "purchased_at", "total_cost", "items_subtotal",
                               "record_inventory_movement", "shop_inventory",
                               "inventory_movements", "movement_id"]) {
        expect(fn, forbidden).not.toContain(forbidden);
      }
    }
    expect(columnsWritten(SET_PURCHASE_TEST, "purchases")).toEqual(["is_test", "updated_at", "updated_by"]);
    expect(columnsWritten(SET_SALE_TEST, "sales")).toEqual(["is_test", "updated_at", "updated_by"]);
  });
});


// ---------------------------------------------------------------------------
// Security, and the inventory that must not move
// ---------------------------------------------------------------------------

describe("nothing here weakens a boundary", () => {
  it("every new function is seller-gated, definer-owned and search-path pinned", () => {
    for (const [name, body] of Object.entries({
      seller_create_purchase: CREATE_PURCHASE,
      seller_create_sale: CREATE_SALE,
      seller_set_purchase_test: SET_PURCHASE_TEST,
      seller_set_sale_test: SET_SALE_TEST,
      seller_orderbook_ledger: LEDGER,
      seller_sales: SALES,
      seller_sale: SALE_DOC,
    })) {
      expect(body, name).toContain("can_operate_active_seller()");
      expect(body, name).toContain("insufficient_privilege");
      expect(body, name).toContain("security definer");
      expect(body, name).toContain("set search_path = ''");
    }
    // The internal helper asks nobody, because nobody may call it.
    expect(IS_TEST).toContain("set search_path = ''");
    expect(SQL).toContain("revoke all on function public.sale_is_test(bigint) from public, anon, authenticated;");
  });

  it("each re-signed function is revoked from anon and granted only to authenticated", () => {
    for (const fn of ["seller_create_purchase(date, numeric, text, boolean)",
                      "seller_create_sale(text, date, text, text, text, text, boolean)",
                      "seller_set_purchase_test(bigint, boolean)",
                      "seller_set_sale_test(bigint, boolean, timestamptz)",
                      "seller_orderbook_ledger(integer, integer, text, boolean, text)",
                      "seller_sales(integer, integer, text, boolean, text, boolean, text)",
                      "seller_sale(bigint)"]) {
      expect(SQL, fn).toContain(`'${fn}'`);
    }
    expect(SQL).toContain("revoke all on function public.%s from public, anon");
    expect(SQL).toContain("grant execute on function public.%s to authenticated");
  });

  it("no table grant, no policy, no RLS change", () => {
    expect(code(SQL)).not.toMatch(/grant[^;]*on table/i);
    expect(code(SQL)).not.toMatch(/create policy|drop policy|alter policy/i);
    expect(code(SQL)).not.toMatch(/disable row level security/i);
    expect(code(SQL)).not.toMatch(/grant[^;]*to (anon|public)\b/i);
  });

  it("no component reaches a table directly", () => {
    for (const file of [NEW_SALE, NEW_PURCHASE, TEST_FLAG, NAV, EINKAUF, VERKAUF]) {
      expect(file).not.toMatch(/\.from\("(sales|sale_items|purchases|purchase_items|orders)"\)/);
      expect(file).not.toContain("SERVICE_ROLE");
    }
    // The writes go through the seller-gated actions, which go through the RPCs.
    expect(TEST_FLAG).toContain("setPurchaseTest");
    expect(TEST_FLAG).toContain("setSaleTest");
  });
});

describe("this migration moves no stock and rewrites no history", () => {
  it("it never mentions inventory at all", () => {
    for (const forbidden of ["inventory_movements", "shop_inventory",
                             "record_inventory_movement", "apply_inventory_movement"]) {
      expect(code(SQL), forbidden).not.toContain(forbidden);
    }
  });

  it("it deletes nothing and truncates nothing", () => {
    expect(code(SQL)).not.toMatch(/\bdelete\s+from\b/i);
    expect(code(SQL)).not.toMatch(/\btruncate\b/i);
    expect(code(SQL)).not.toMatch(/\bdrop\s+table\b/i);
  });

  it("its only writes are the two seller-gated setters and the two backfill rows", () => {
    /*
     * Four `update` statements in the whole migration and no others: one per
     * setter — each gated, each writing a single boolean and its own audit
     * stamps — and the two one-off corrections at the end.
     */
    const writes = code(SQL).match(/update public\.\w+/g) ?? [];
    expect(writes).toEqual([
      "update public.purchases", "update public.sales",
      "update public.purchases", "update public.sales",
    ]);
    expect(code(BACKFILL).match(/update public\.\w+/g))
      .toEqual(["update public.purchases", "update public.sales"]);
  });

  it("and the ledgers themselves still write nothing", () => {
    for (const body of [LEDGER, SALES, SALE_DOC, IS_TEST]) {
      expect(body).not.toMatch(/insert|update |delete/i);
    }
  });
});


// ---------------------------------------------------------------------------
// The vocabulary itself
// ---------------------------------------------------------------------------

describe("the filter as a URL", () => {
  it("the default stays out of the address", () => {
    expect(ledgerHref()).toBe("/business/orderbuch");
    expect(ledgerHref(undefined, undefined, null, "alle")).toBe("/business/orderbuch");
    expect(salesHref("extern")).toBe("/business/orderbuch/verkauf");
  });

  it("and every other filter survives a change of classification", () => {
    expect(ledgerHref(2026, 7, "Drobot", "test"))
      .toBe("/business/orderbuch?jahr=2026&monat=7&q=Drobot&status=test");
    // `offen=1` is gone with the payout filter (ADR-0095).
    expect(salesHref("intern", 2026, 7, "Drobot", "unvollstaendig"))
      .toBe("/business/orderbuch/verkauf?bereich=intern&jahr=2026&monat=7&q=Drobot&status=unvollstaendig");
  });

  it("the search form carries it too, so a search does not reset the view", () => {
    for (const page of [EINKAUF, VERKAUF]) {
      expect(page).toContain('<input type="hidden" name="status" value={status} />');
    }
  });

  it("the back link from a detail page returns to the same classification", () => {
    expect(EINKAUF).toContain("const here = ledgerHref(year, month, search, status);");
    expect(VERKAUF).toContain("const here = salesHref(scope, year === UNDATED ? \"ohne\" : year, month, search, status);");
  });
});

describe("the counts the chips render", () => {
  it("map to the right class", () => {
    const counts = { normal: 84, incomplete: 14, open: 0, test: 1 };
    expect(countFor(counts, "alle")).toBe(84);
    expect(countFor(counts, "unvollstaendig")).toBe(14);
    expect(countFor(counts, "test")).toBe(1);
  });

  it("read back from the database, with a missing answer meaning zero", () => {
    expect(readCounts({ normal: "84", incomplete: 14, test: 1 }))
      .toEqual({ normal: 84, incomplete: 14, open: 0, test: 1 });
    expect(readCounts(null)).toEqual(EMPTY_COUNTS);
    expect(readCounts({})).toEqual(EMPTY_COUNTS);
  });

  it("and the URL vocabulary maps onto the database's", () => {
    expect(rpcStatus("alle")).toBe("normal");
    expect(rpcStatus("unvollstaendig")).toBe("incomplete");
    expect(rpcStatus("test")).toBe("test");
  });
});
