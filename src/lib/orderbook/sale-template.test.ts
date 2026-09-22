/**
 * The eBay template, and the payout it has to agree with (0065, ADR-0092).
 *
 * WHAT THIS FILE IS DEFENDING
 *
 * 1. THE TEMPLATE IS LAYOUT. If `eBay` ever becomes a data model — a column,
 *    a table, a branch in a query — the Orderbuch has two ways to describe a
 *    sale and they will disagree. Everything a template collects lands in
 *    `sale_fees`, `settlement_adjustments` and the three amounts on `sales`.
 *
 * 2. ONE PAYOUT FORMULA. `plannedPayout` reconstructed 292 workbook sales,
 *    `sale_expected_payout()` computes the same expression in SQL, and the
 *    create form now calls the first of those. A second formula in a React
 *    component is exactly the failure this prevents — the screen would show
 *    one number and the detail page another, and only one could be right.
 *
 * 3. `settled_by` IS THE PAYOUT-DECIDING FIELD. A label eBay billed reduces
 *    the payout; one bought at the post office does not, and both are real
 *    money. Losing that distinction silently changes what every reconciled
 *    sale is worth.
 *
 * 4. CREATING A SALE MOVES NO STOCK, whatever it contains. `Ausbuchen`, one
 *    physical unit at a time, remains the only path to the ledger.
 */
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { de } from "@/lib/i18n/de";
import { code, latestFunction, migrationSource } from "@/test-support/migrations";
import {
  SALE_FEE_TYPES, SALE_TEMPLATES, extraFee, feeFromType, feePlans, initialFees, invalidFees,
  payoutView, saleFeeType, saleFormMoney, saleTemplate, unlabelledFees, type FeeDraft,
} from "./sale-template.ts";
import { parseMoney, parseSignedMoney, plannedPayout, roundMoney } from "./sales-money.ts";
import { saleItemEdits } from "./sales-view.ts";

const SQL = migrationSource("0065_sale_create_with_details.sql");
const CREATE = code(latestFunction("seller_create_sale_with_details").body);
const REMOVE = code(latestFunction("seller_remove_sale_item").body);
const REMAP = code(latestFunction("seller_set_sale_item_sky").body);
const BOOK = code(latestFunction("seller_book_sale_item").body);

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/**
 * A TypeScript source with its prose removed.
 *
 * Needed for the "this does not exist" assertions: the modules below name
 * `ebay_fee` and `plannedPayout` in their headers precisely in order to say
 * that no column and no second formula exist. Asserting on the raw file would
 * make the comment that documents an invariant break it.
 */
const ts = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const NEW_SALE = read("src/components/business/new-sale.tsx");
const SALE_ITEMS = read("src/components/business/sale-items.tsx");
const NEW_SALE_PAGE = read("src/app/(business)/business/orderbuch/verkauf/neu/page.tsx");
const ACTIONS = read("src/lib/orderbook/sales-actions.ts");
const TEMPLATE_SRC = read("src/lib/orderbook/sale-template.ts");

let seq = 0;
const key = () => `k${seq++}`;
const fee = (over: Partial<FeeDraft> = {}): FeeDraft => ({
  key: key(), kind: "marketplace", label: "eBay-Gebühr", amount: "", settledBy: "channel", ...over,
});

/* ===================================================================== */
describe("the template is layout, not a data model", () => {
  it("offers eBay and writes the channel the sale already has", () => {
    expect(saleTemplate("ebay").channel).toBe("ebay");
    expect(saleTemplate("manual").channel).toBe("manual");
    expect(SALE_TEMPLATES.map((t) => t.id)).toEqual(["ebay", "manual"]);
  });

  it("falls back to eBay rather than crashing on an unknown id", () => {
    expect(saleTemplate("etsy").id).toBe("ebay");
    expect(saleTemplate("").id).toBe("ebay");
  });

  it("NAMES NO EBAY STORAGE ANYWHERE", () => {
    for (const source of [ts(TEMPLATE_SRC), ts(NEW_SALE), ts(ACTIONS), code(SQL)]) {
      expect(source).not.toContain("ebay_fee");
      expect(source).not.toContain("ebay_sale");
      expect(source).not.toMatch(/create table[^;]*ebay/i);
    }
    // The migration never mentions the channel at all: it forwards whatever
    // the caller passed, so eBay is not a branch anywhere in SQL.
    expect(code(SQL)).not.toContain("'ebay'");
    /*
     * `"ebay"` does appear in the form — as the default selection and the id
     * it looks up. What must NOT appear is behaviour branching on it: every
     * difference between templates is a field on the template object, so
     * adding a third marketplace is a list entry and not an `if`.
     */
    expect(ts(NEW_SALE)).not.toMatch(/===\s*"ebay"/);
    expect(ts(NEW_SALE)).not.toMatch(/templateId\s*===/);
    expect(ts(NEW_SALE)).toContain("template.showsDiscount");
  });

  it("starts eBay with the two rows every workbook settlement has", () => {
    const rows = initialFees(saleTemplate("ebay"), key);
    // Transaktionsgebühr und Label — beide gewöhnliche Zeilen, beide entfernbar.
    expect(rows.map((r) => r.kind)).toEqual(["payment", "shipping_label"]);
    // The label defaults to channel-settled, which is the normal case.
    expect(rows[1].settledBy).toBe("channel");
    expect(rows.every((r) => r.amount === "")).toBe(true);
  });

  it("starts the plain template with none, so nothing has to be cleared away", () => {
    expect(initialFees(saleTemplate("manual"), key)).toEqual([]);
  });

  it("uses only fee kinds the database accepts", () => {
    const known = ["payment", "marketplace", "shipping_label", "other"];
    for (const t of SALE_TEMPLATES) {
      for (const f of t.defaultFees) expect(known).toContain(f.kind);
    }
    expect(extraFee(key(), "Porto").kind).toBe("other");
  });
});

/* ===================================================================== */
describe("several fees, which is the ordinary case", () => {
  it("collects every filled row", () => {
    const plans = feePlans([
      fee({ amount: "3,42" }),
      fee({ kind: "other", label: "weitere Gebühr", amount: "0,35" }),
    ]);
    expect(plans).toHaveLength(2);
    expect(plans[0]).toMatchObject({ kind: "marketplace", amount: 3.42, settled_by: "channel" });
    expect(plans[1]).toMatchObject({ kind: "other", amount: 0.35, label: "weitere Gebühr" });
  });

  it("drops an empty row rather than storing a fee of nothing", () => {
    expect(feePlans([fee({ amount: "" }), fee({ amount: "   " })])).toEqual([]);
  });

  it("drops a zero, which the database would store as a cost of 0,00 €", () => {
    expect(feePlans([fee({ amount: "0" })])).toEqual([]);
    expect(feePlans([fee({ amount: "0,00" })])).toEqual([]);
  });

  it("reads German decimals", () => {
    expect(feePlans([fee({ amount: "1,05" })])[0].amount).toBe(1.05);
  });

  it("stores the name of the fee type, and nothing where there is no name", () => {
    /*
     * Bis es mehrere Arten je Kategorie gab, war das Etikett reine
     * Bildschirmsprache und wurde nur für `other` gespeichert. Jetzt trägt
     * jede benannte Zeile ihren Namen — sonst wären Anzeige- und Werbegebühr
     * nach dem Speichern nicht mehr zu unterscheiden.
     */
    expect(feePlans([fee({ label: "Anzeigegebühr", amount: "1" })])[0].label)
      .toBe("Anzeigegebühr");
    expect(feePlans([fee({ kind: "other", label: "Porto", amount: "1" })])[0].label).toBe("Porto");
    expect(feePlans([fee({ label: "  ", amount: "1" })])[0].label).toBeUndefined();
  });

  it("names a row that is text rather than a number", () => {
    expect(invalidFees([fee({ amount: "abc" })])).toHaveLength(1);
    expect(invalidFees([fee({ amount: "3,42" })])).toHaveLength(0);
    expect(invalidFees([fee({ amount: "" })])).toHaveLength(0);
  });

  it("names an `other` row with an amount and no label — the CHECK refuses it", () => {
    expect(unlabelledFees([fee({ kind: "other", label: "", amount: "1" })])).toHaveLength(1);
    expect(unlabelledFees([fee({ kind: "other", label: "", amount: "" })])).toHaveLength(0);
    expect(unlabelledFees([fee({ kind: "marketplace", label: "", amount: "1" })])).toHaveLength(0);
  });
});

/* ===================================================================== */
describe("shipping is two different things and the screen keeps them apart", () => {
  it("what the buyer paid RAISES the payout", () => {
    const without = payoutView({ subtotal: 20, shipping: 0, discount: 0, fees: [], adjustments: [] });
    const withShipping = payoutView({ subtotal: 20, shipping: 4.99, discount: 0, fees: [], adjustments: [] });
    expect(withShipping - without).toBeCloseTo(4.99, 2);
  });

  it("a label the CHANNEL billed LOWERS it", () => {
    const view = payoutView({
      subtotal: 20, shipping: 4.99, discount: 0,
      fees: [{ kind: "shipping_label", amount: 3.15, settled_by: "channel" }],
      adjustments: [],
    });
    expect(view).toBe(21.84);
  });

  it("A LABEL PAID AT THE POST OFFICE DOES NOT — it is still real money", () => {
    const view = payoutView({
      subtotal: 20, shipping: 4.99, discount: 0,
      fees: [{ kind: "shipping_label", amount: 3.15, settled_by: "external" }],
      adjustments: [],
    });
    expect(view).toBe(24.99);
  });

  it("which is the whole of the difference between the workbook's two columns", () => {
    const channel = { kind: "shipping_label", amount: 2, settled_by: "channel" };
    const external = { ...channel, settled_by: "external" };
    const base = { subtotal: 10, shipping: 0, discount: 0, adjustments: [] };
    expect(payoutView({ ...base, fees: [channel] })).toBe(8);
    expect(payoutView({ ...base, fees: [external] })).toBe(10);
  });
});

/* ===================================================================== */
describe("the payout, by the workbook's own formula", () => {
  it("THE WORKED EXAMPLE: 20,00 + 4,99 − 3,42 − 3,15 = 18,42", () => {
    const fees = feePlans([
      fee({ kind: "marketplace", label: "eBay-Gebühr", amount: "3,42" }),
      fee({ kind: "shipping_label", label: "Versandkosten (Label)", amount: "3,15" }),
    ]);
    expect(payoutView({ subtotal: 20, shipping: 4.99, discount: 0, fees, adjustments: [] }))
      .toBe(18.42);
  });

  it("and an externally paid label leaves that 18,42 alone", () => {
    const fees = feePlans([
      fee({ kind: "marketplace", label: "eBay-Gebühr", amount: "3,42" }),
      fee({ kind: "shipping_label", amount: "3,15" }),
      fee({ kind: "shipping_label", amount: "0,35", settledBy: "external" }),
    ]);
    expect(payoutView({ subtotal: 20, shipping: 4.99, discount: 0, fees, adjustments: [] })
      ).toBe(18.42);
  });

  it("THERE IS NOTHING TO RECONCILE AGAINST — one number, derived", () => {
    // `payoutView` returns a plain number since ADR-0095: no reported figure,
    // no difference, no `matches`. The reconciliation workflow is gone.
    const view = payoutView({ subtotal: 10, shipping: 0, discount: 0, fees: [], adjustments: [] });
    expect(typeof view).toBe("number");
    expect(view).toBe(10);
  });

  it("a discount lowers the payout", () => {
    expect(payoutView({ subtotal: 20, shipping: 0, discount: 2.5, fees: [], adjustments: [] })
      ).toBe(17.5);
  });

  it("a signed adjustment moves it in both directions — the workbook ADDS `Fee S.`", () => {
    const base = { subtotal: 10, shipping: 0, discount: 0, fees: [] };
    expect(payoutView({ ...base, adjustments: [{ amount: 1.5 }] })).toBe(11.5);
    expect(payoutView({ ...base, adjustments: [{ amount: -1.5 }] })).toBe(8.5);
  });

  it("rounds once, so floating point never reaches the screen", () => {
    // 0.1 + 0.2 is 0.30000000000000004 in IEEE 754. `0,30 €` is what a
    // person is owed, and `payoutView` is the one place that decides so.
    expect(payoutView({ subtotal: 0.1, shipping: 0.2, discount: 0, fees: [], adjustments: [] }))
      .toBe(0.3);
  });

  it("IS THE IMPORTER'S FUNCTION, not a copy of it", () => {
    // Same inputs, same number: `payoutView` only rounds what plannedPayout says.
    const fees = [{ kind: "marketplace", amount: 3.42, settled_by: "channel" }];
    expect(payoutView({ subtotal: 20, shipping: 4.99, discount: 0, fees, adjustments: [] }))
      .toBe(roundMoney(plannedPayout(20, 4.99, 0, fees, [], [])));
    // And the form reaches it through the shared module, never its own maths.
    expect(NEW_SALE).toContain("saleFormMoney");
    // The component never CALLS it — the header mentions it to say so.
    expect(ts(NEW_SALE)).not.toMatch(/plannedPayout\s*\(/);
    expect(ts(TEMPLATE_SRC)).toMatch(/plannedPayout\s*\(/);
  });

  it("NO COMPONENT CARRIES A SECOND FORMULA", () => {
    for (const source of [NEW_SALE, SALE_ITEMS, read("src/components/business/sale-details.tsx")]) {
      expect(source).not.toMatch(/subtotal \+ shipping/);
      expect(source).not.toMatch(/- discount/);
    }
  });

  it("the SQL computes the same expression, and stays the authority once a sale exists", () => {
    const sql = code(latestFunction("sale_expected_payout").body);
    expect(sql).toContain("s.items_subtotal");
    expect(sql).toContain("s.shipping_charged");
    expect(sql).toContain("s.discount_amount");
    expect(sql).toContain("settled_by = 'channel'");
    expect(sql).toContain("settlement_adjustments");
    // 0065 did not touch it.
    expect(SQL).not.toContain("create or replace function public.sale_expected_payout");
  });
});

/* ===================================================================== */
describe("money as it is typed", () => {
  it("an empty field is zero, because most of these are optional", () => {
    expect(parseMoney("")).toBe(0);
    expect(parseSignedMoney("   ")).toBe(0);
  });
  it("German decimals", () => {
    expect(parseMoney("3,42")).toBe(3.42);
    expect(parseSignedMoney("-0,35")).toBe(-0.35);
  });
  it("a fee may not be negative, an adjustment may", () => {
    expect(parseMoney("-1")).toBeNull();
    expect(parseSignedMoney("-1")).toBe(-1);
  });
  it("nonsense is nonsense", () => {
    expect(parseMoney("abc")).toBeNull();
    expect(parseSignedMoney("1,2,3")).toBeNull();
  });
});

/* ===================================================================== */
describe("the form's own fields, as they are typed", () => {
  const typed = (over: Partial<Parameters<typeof saleFormMoney>[0]> = {}) => saleFormMoney({
    subtotal: "", shipping: "", discount: "", fees: [],
    adjustment: "", adjustmentNote: "", ...over,
  });

  it("MAPS EACH BOX TO THE RIGHT AMOUNT — the one thing JSX can get silently wrong", () => {
    const m = typed({ subtotal: "20", shipping: "4,99", discount: "1,50" });
    expect(m.subtotal).toBe(20);
    expect(m.shipping).toBe(4.99);
    expect(m.discount).toBe(1.5);
    expect(m.payout).toBe(23.49);
  });

  it("THE WORKED EXAMPLE, typed exactly as the operator would", () => {
    const m = typed({
      subtotal: "20", shipping: "4,99",
      fees: [
        fee({ kind: "marketplace", label: "eBay-Gebühr", amount: "3,42" }),
        fee({ kind: "shipping_label", label: "Versandkosten (Label)", amount: "3,15" }),
        fee({ kind: "shipping_label", label: "selbst bezahlt", amount: "2,19", settledBy: "external" }),
      ],
      adjustment: "-0,35", adjustmentNote: "Kulanz",
    });
    // 20 + 4,99 − 3,42 − 3,15 − 0,35. The externally paid 2,19 is NOT in it.
    expect(m.payout).toBe(18.07);
    // And the payload carries exactly what was shown.
    expect(m.fees).toHaveLength(3);
    expect(m.adjustments).toEqual([{ amount: -0.35, note: "Kulanz" }]);
  });

  it("THE FORM HAS NO REPORTED-PAYOUT FIELD ANY MORE (ADR-0095)", () => {
    // Neither the input shape nor the output carries one.
    expect(Object.keys(typed())).not.toContain("reported");
    expect(ts(NEW_SALE)).not.toContain("setReported");
    expect(ts(NEW_SALE)).not.toContain("payoutRef");
    expect(ts(NEW_SALE)).not.toMatch(/reportedPayout/);
  });

  it("a zero adjustment is NO adjustment — the CHECK refuses a row worth nothing", () => {
    expect(typed({ adjustment: "" }).adjustments).toEqual([]);
    expect(typed({ adjustment: "0" }).adjustments).toEqual([]);
    expect(typed({ adjustment: "0,00" }).adjustments).toEqual([]);
  });

  it("an adjustment note is carried only when there is one", () => {
    expect(typed({ adjustment: "-1" }).adjustments).toEqual([{ amount: -1 }]);
    expect(typed({ adjustment: "-1", adjustmentNote: "  " }).adjustments).toEqual([{ amount: -1 }]);
  });

  it("keeps the panel usable while a field is half-typed", () => {
    // `4,` is a real partial and values as 4 — the panel must not blank out
    // between the comma and the cents.
    expect(typed({ subtotal: "20", shipping: "4," }).payout).toBe(24);
    // Genuine nonsense values as 0 rather than NaN, and the SUBMIT still
    // refuses it — the display coerces, the save does not.
    expect(typed({ subtotal: "20", shipping: "abc" }).payout).toBe(20);
    expect(Number.isNaN(typed({ subtotal: "abc" }).payout)).toBe(false);
  });

  it("THE PANEL AND THE PAYLOAD ARE ONE OBJECT", () => {
    // Built once in the component and read by both — asserted at the source,
    // because this is the divergence that would show a wrong reconciliation.
    expect(NEW_SALE).toContain("saleFormMoney({");
    expect(NEW_SALE).toContain("fees: money.fees");
    expect(NEW_SALE).toContain("adjustments: money.adjustments");
    expect(NEW_SALE).toContain("formatPrice(money.payout)");
    // No second construction anywhere in the file.
    expect(ts(NEW_SALE)).not.toMatch(/feePlans\s*\(/);
    expect((ts(NEW_SALE).match(/saleFormMoney\(/g) ?? []).length).toBe(1);
  });
});

/* ===================================================================== */
describe("figures on the create form", () => {
  it("uses the shared picker and the shared draft, not a third implementation", () => {
    expect(NEW_SALE).toContain("FigureDraft");
    expect(NEW_SALE).toContain("draftPayload");
    expect(read("src/components/business/figure-draft.tsx")).toContain("FigureSearch");
    expect(NEW_SALE).not.toContain("catalog.filter");
  });

  it("takes the catalog from the one canonical source", () => {
    expect(NEW_SALE_PAGE).toContain("fetchOrderbookCatalog");
    expect(NEW_SALE).not.toContain("supabase");
  });

  it("sends one element per physical unit, so duplicates stay separate rows", () => {
    expect(CREATE).toContain("jsonb_array_elements");
    expect(CREATE).not.toContain("distinct");
    expect(CREATE).not.toContain("quantity");
  });

  it("writes nothing until the button is pressed", () => {
    expect(NEW_SALE).toContain("createSaleWithDetails");
    expect(NEW_SALE).not.toContain("addSaleItem");
  });
});

/* ===================================================================== */
describe("0065 — the migration", () => {
  it("adds three functions and no storage of any kind", () => {
    expect(SQL).toContain("create or replace function public.seller_create_sale_with_details");
    expect(SQL).toContain("create or replace function public.seller_set_sale_item_sky");
    expect(SQL).toContain("create or replace function public.seller_remove_sale_item");
    const body = code(SQL);
    expect(body).not.toContain("create table");
    expect(body).not.toContain("add column");
    expect(body).not.toContain("drop column");
  });

  it("IS ATOMIC BY DELEGATION", () => {
    for (const fn of ["seller_create_sale(", "seller_add_sale_item(", "seller_add_sale_fee(",
                      "seller_add_settlement_adjustment(", "seller_set_sale_payout("]) {
      expect(CREATE).toContain(`public.${fn}`);
    }
    expect(CREATE).not.toContain("commit");
    expect(CREATE).not.toContain("exception when");
  });

  it("validates the shape before it creates anything", () => {
    const beforeCreate = CREATE.slice(0, CREATE.indexOf("public.seller_create_sale("));
    expect(beforeCreate).toContain("jsonb_typeof");
    expect(beforeCreate).toContain("jsonb_array_length");
  });

  it("writes the three amounts directly, so creation is not filed as a correction", () => {
    expect(CREATE).toContain("update public.sales");
    expect(CREATE).toContain("items_subtotal");
    // Not through the audited updater: that would claim the sale was corrected.
    expect(CREATE).not.toContain("seller_update_sale(");
    expect(SQL).toContain("Creation is not a");
  });

  it("but the reported payout IS audited, because it arrives from outside", () => {
    expect(CREATE).toContain("public.seller_set_sale_payout(");
  });

  it("forces an adjustment onto the sale's own channel", () => {
    const loop = CREATE.slice(CREATE.indexOf("p_adjustments"));
    expect(loop).toContain("p_channel");
  });

  it("CREATION MOVES NO STOCK", () => {
    const body = code(SQL);
    expect(body).not.toContain("record_inventory_movement");
    expect(body).not.toContain("shop_inventory");
    expect(body).not.toContain("inventory_movements");
    expect(SQL).toContain("creation moves NO");
  });

  it("and Ausbuchen is still the only thing that does, one unit at a time", () => {
    expect(BOOK).toContain("record_inventory_movement");
    expect(BOOK).toContain("'sale_external'");
    expect(BOOK).toContain("-1");
    // Untouched by 0065.
    expect(SQL).not.toContain("create or replace function public.seller_book_sale_item");
  });

  it("REMOVAL NOW REFUSES THE WORKBOOK, and both stock movements", () => {
    expect(REMOVE).toContain("movement_id is not null");
    expect(REMOVE).toContain("return_movement_id is not null");
    expect(REMOVE).toContain("excel_order_2026");
    expect(REMOVE).toContain("source_row is not null");
    expect(REMOVE).toContain("legacy_stock_flag is not null");
    expect(REMOVE).toContain("legacy_shipped_flag is not null");
  });

  it("the remap refuses everything removal does, plus a returned item", () => {
    expect(REMAP).toContain("movement_id is not null");
    expect(REMAP).toContain("returned_at is not null");
    expect(REMAP).toContain("excel_order_2026");
    expect(REMAP).toContain("order_id is not null");
    // It must not leave an item without an identity.
    expect(REMAP).toContain("a sale item needs a catalog figure");
  });

  it("the remap keeps provenance and writes no price snapshot", () => {
    const update = REMAP.slice(REMAP.indexOf("update public.sale_items"));
    expect(update).toContain("sky_id");
    for (const kept of ["raw_name", "source_row", "legacy_stock_flag", "position",
                        "market_price_snapshot"]) {
      expect(update, kept).not.toContain(kept);
    }
  });

  it("both corrections are audited through the existing trail", () => {
    expect(REMAP).toContain("public.orderbook_log(");
    expect(REMOVE).toContain("public.orderbook_log(");
    expect(REMAP).toContain("'sale_item'");
  });

  it("every function is seller-gated, definer, fixed search_path", () => {
    for (const fn of [CREATE, REMAP, REMOVE]) {
      expect(fn).toContain("security definer");
      expect(fn).toContain("set search_path = ''");
      expect(fn).toContain("public.can_operate_active_seller()");
      expect(fn).toContain("insufficient_privilege");
    }
  });

  it("is revoked from anon and granted only to authenticated", () => {
    expect(SQL).toContain("revoke all on function public.seller_set_sale_item_sky(bigint, text) from public, anon;");
    expect(SQL).toContain("revoke all on function public.seller_remove_sale_item(bigint) from public, anon;");
    expect(SQL).not.toMatch(/grant[^;]*to\s+anon/);
  });

  it("CHANGES NO RLS AND NO TABLE GRANT", () => {
    const body = code(SQL);
    expect(body).not.toContain("create policy");
    expect(body).not.toContain("enable row level security");
    expect(body).not.toMatch(/grant[^;]*on table/);
  });

  it("is the last word on removal, so the hardening is what runs", () => {
    expect(latestFunction("seller_remove_sale_item").file).toBe("0065_sale_create_with_details.sql");
  });
});

/* ===================================================================== */
describe("editing a sale item on the detail page", () => {
  const item = (over = {}) => ({
    movement_id: null as number | null, return_movement_id: null as number | null,
    returned_at: null as string | null, source_row: null as number | null,
    legacy_stock_flag: null as string | null, legacy_shipped_flag: null as string | null,
    ...over,
  });
  const open = { historical: false, internal: false };

  it("an unbooked hand-made line may be removed and remapped", () => {
    expect(saleItemEdits(item(), open)).toEqual({ canRemove: true, canRemap: true });
  });

  it("A BOOKED-OUT LINE MAY BE NEITHER", () => {
    expect(saleItemEdits(item({ movement_id: 552 }), open))
      .toEqual({ canRemove: false, canRemap: false });
  });

  it("nor one that went out and came back", () => {
    expect(saleItemEdits(item({ movement_id: 552, return_movement_id: 553, returned_at: "x" }), open))
      .toEqual({ canRemove: false, canRemap: false });
  });

  it("A HISTORICAL LINE MAY BE NEITHER — provenance is not regenerable", () => {
    expect(saleItemEdits(item(), { historical: true, internal: false }))
      .toEqual({ canRemove: false, canRemap: false });
    expect(saleItemEdits(item({ source_row: 412 }), open))
      .toEqual({ canRemove: false, canRemap: false });
    expect(saleItemEdits(item({ legacy_stock_flag: "x" }), open).canRemove).toBe(false);
    expect(saleItemEdits(item({ legacy_shipped_flag: "x" }), open).canRemove).toBe(false);
  });

  it("an internal sale's line may be neither — commerce owns it", () => {
    expect(saleItemEdits(item(), { historical: false, internal: true }))
      .toEqual({ canRemove: false, canRemap: false });
  });

  it("the screen asks that predicate rather than repeating the rules", () => {
    expect(SALE_ITEMS).toContain("saleItemEdits");
    expect(SALE_ITEMS).toContain("edits.canRemove");
    expect(SALE_ITEMS).toContain("edits.canRemap");
    // And the old hand-rolled condition is gone.
    expect(SALE_ITEMS).not.toContain("!internal && !historical && item.movement_id === null");
  });

  it("Ausbuchen is still offered per item and still waits for the database", () => {
    expect(SALE_ITEMS).toContain("bookSaleItem");
    expect(de.business.sales.book).toBe("Ausbuchen");
    expect(SALE_ITEMS).not.toContain("useOptimistic");
  });
});

/* ===================================================================== */
describe("the German copy", () => {
  it("the layout switch is labelled as the channel it also sets", () => {
    /*
     * It said `Vorlage` and explained underneath that a template only moves
     * labels around. That is true and it is not the operator's problem: what
     * they are choosing is where the thing was sold. The stored value is
     * unchanged — `sales.channel`, via `template.channel`.
     */
    expect(de.business.sales.create.template).toBe("Kanal");
    expect(de.business.sales.create.templateNames.ebay).toBe("eBay");
    expect(de.business.sales.create.templateNames.manual).toBe("Manuell");
    // The explanation of what a template is went with it.
    expect((de.business.sales.create as Record<string, unknown>).templateHint).toBeUndefined();
  });

  it("distinguishes the two shipping meanings in words", () => {
    expect(de.business.sales.create.shippingLabel).toContain("Käufer");
    expect(de.business.sales.create.settledHint).toContain("mindert die Auszahlung");
  });

  it("names ONE payout line — the computed one (ADR-0095)", () => {
    const c = de.business.sales.create as Record<string, unknown>;
    expect(c.expectedPayout).toBe("Auszahlung");
    for (const gone of ["reportedPayout", "payoutDifference", "payoutMatches", "payoutPending"]) {
      expect(c[gone], gone).toBeUndefined();
    }
    /*
     * The three-line formula under the figure is gone with it. The number
     * moves the moment any amount above it moves, and `settledHint` still
     * states the one rule that is not visible: which side of the switch
     * reaches the payout.
     */
    expect(c.payoutHint).toBeUndefined();
    expect(String(de.business.sales.create.settledHint)).toContain("mindert die Auszahlung");
  });

  it("the sentence about stock left the form, not the product", () => {
    /*
     * `Anlegen ist kein Ausbuchen` is still true and still said — on the
     * item list, where `Ausbuchen` is the button being described. Under a
     * submit button it was one more line of prose to scroll past.
     */
    expect(de.business.sales.create.stockHint).toContain("ändert den Bestand nicht");
    expect(NEW_SALE).not.toContain("create.stockHint");
    expect(read("src/components/business/sale-items.tsx")).toContain("create.stockHint");
  });

  it("maps the new refusals to sentences instead of raw SQL", () => {
    expect(ACTIONS).toContain('text.includes("legacy workbook")');
    expect(de.business.sales.errors.historicalItem).toContain("Excel-Historie");
  });
});

/* ===================================================================== */
/**
 * MEHRERE GEBÜHRENARTEN, EINE VERRECHNUNG.
 *
 * Ein Marktplatz rechnet in Posten ab — Transaktion, Anzeige, Werbung,
 * Zahlung —, das Lager und die Auszahlung kennen nur „was der Kanal
 * einbehalten hat". Beides passt in das Modell von 0059, ohne es zu ändern:
 * `kind` bleibt die Verrechnungskategorie, `label` trägt den Namen der Art.
 */
describe("fee types are a name on top of the kinds the database already has", () => {
  it("offers exactly the types the screen lists, each mapped to a stored kind", () => {
    expect(SALE_FEE_TYPES.map((t) => t.id)).toEqual([
      "transaction", "listing", "advertising", "payment", "shipping_label", "other",
    ]);
    // Jede Art landet in einer Kategorie, die die CHECK-Bedingung kennt.
    const known = ["payment", "marketplace", "shipping_label", "other"];
    for (const type of SALE_FEE_TYPES) expect(known, type.id).toContain(type.kind);
    // Und keine erfindet eine neue: die Migration bleibt unnötig.
    const sales = migrationSource("0059_orderbook_sales.sql");
    expect(code(sales)).toContain("sale_fees_kind_known");
    expect(code(sales)).toContain("'payment', 'marketplace', 'shipping_label', 'other'");
  });

  it("keeps two different types inside one kind apart by their label", () => {
    const listing = feeFromType(key(), "listing");
    const advertising = feeFromType(key(), "advertising");
    expect(listing.kind).toBe("marketplace");
    expect(advertising.kind).toBe("marketplace");
    expect(listing.label).toBe("Anzeigegebühr");
    expect(advertising.label).toBe("Werbegebühr");

    const plans = feePlans([{ ...listing, amount: "0,55" }, { ...advertising, amount: "1,20" }]);
    expect(plans).toEqual([
      { kind: "marketplace", amount: 0.55, settled_by: "channel", label: "Anzeigegebühr" },
      { kind: "marketplace", amount: 1.2, settled_by: "channel", label: "Werbegebühr" },
    ]);
  });

  it("falls back to the free row rather than crashing on an unknown type", () => {
    expect(feeFromType("k", "vermittlungsprovision").kind).toBe("other");
    expect(saleFeeType("vermittlungsprovision")).toBeUndefined();
  });

  it("still requires a name for a free row, and stores none when there is none", () => {
    const free = extraFee(key(), "");
    expect(unlabelledFees([{ ...free, amount: "1,00" }])).toHaveLength(1);
    // Ohne Betrag ist auch ohne Namen nichts zu speichern.
    expect(unlabelledFees([free])).toHaveLength(0);
    expect(feePlans([{ ...free, amount: "1,00" }])).toEqual([
      { kind: "other", amount: 1, settled_by: "channel" },
    ]);
  });

  it("adds and removes rows without touching the others", () => {
    let rows: FeeDraft[] = initialFees(saleTemplate("ebay"), (n) => `init${n}`);
    expect(rows).toHaveLength(2);
    rows = [...rows, feeFromType(key(), "listing"), feeFromType(key(), "advertising")];
    expect(rows).toHaveLength(4);
    const dropped = rows[2].key;
    rows = rows.filter((r) => r.key !== dropped);
    expect(rows.map((r) => r.label))
      .toEqual(["Transaktionsgebühr", "Versandkosten (Label)", "Werbegebühr"]);
  });

  it("THE WORKED EXAMPLE: 17,09 + 5,99 − 3,84 − 0,55 − 5,19 = 13,50", () => {
    const fees = feePlans([
      { ...feeFromType(key(), "transaction"), amount: "3,84" },
      { ...feeFromType(key(), "listing"), amount: "0,55" },
      { ...feeFromType(key(), "shipping_label"), amount: "5,19" },
    ]);
    expect(fees).toHaveLength(3);
    expect(payoutView({ subtotal: 17.09, shipping: 5.99, discount: 0, fees, adjustments: [] }))
      .toBe(13.5);
  });

  it("deducts every channel fee, whatever its type — and no external one", () => {
    const fees = feePlans([
      { ...feeFromType(key(), "transaction"), amount: "1,00" },
      { ...feeFromType(key(), "listing"), amount: "1,00" },
      { ...feeFromType(key(), "advertising"), amount: "1,00" },
      { ...feeFromType(key(), "payment"), amount: "1,00" },
      { ...feeFromType(key(), "shipping_label"), amount: "1,00", settledBy: "external" as const },
    ]);
    expect(payoutView({ subtotal: 20, shipping: 0, discount: 0, fees, adjustments: [] })).toBe(16);
  });

  it("leaves the historical rows alone: no label, summed by kind as before", () => {
    /*
     * Die 825 importierten Gebührenzeilen tragen `label = NULL` und eine der
     * vier Kategorien. Nichts an dieser Erweiterung verlangt ein Etikett, und
     * das Detailfenster zeigt für sie weiterhin den Namen der Kategorie.
     */
    const historical = [
      { kind: "payment", amount: 3.84, settled_by: "channel" },
      { kind: "marketplace", amount: 0.55, settled_by: "channel" },
      { kind: "shipping_label", amount: 5.19, settled_by: "channel" },
    ];
    expect(historical.every((f) => !("label" in f))).toBe(true);
    expect(payoutView({ subtotal: 17.09, shipping: 5.99, discount: 0,
                        fees: historical, adjustments: [] })).toBe(13.5);
    expect(read("src/components/business/sale-details.tsx"))
      .toContain("return modal.feeKinds[fee.kind as keyof typeof modal.feeKinds] ?? fee.kind;");
  });
});

/* ===================================================================== */
describe("the eBay template suggests a transaction fee, it does not hard-wire one", () => {
  it("opens with a transaction fee and a label, both ordinary fee rows", () => {
    const rows = initialFees(saleTemplate("ebay"), (n) => `init${n}`);
    expect(rows.map((r) => [r.kind, r.label])).toEqual([
      ["payment", "Transaktionsgebühr"],
      ["shipping_label", "Versandkosten (Label)"],
    ]);
    // Beide sind entfernbar: nichts an ihnen ist besonders.
    expect(rows.filter((r) => r.key !== rows[0].key)).toHaveLength(1);
  });

  it("no longer knows a field called eBay-Gebühr", () => {
    expect(ts(TEMPLATE_SRC)).not.toContain("eBay-Gebühr");
    expect(ts(NEW_SALE)).not.toContain("eBay-Gebühr");
  });

  it("the manual template still starts empty", () => {
    expect(initialFees(saleTemplate("manual"), (n) => `m${n}`)).toEqual([]);
  });

  it("the form offers the types and keeps the free row", () => {
    expect(NEW_SALE).toContain("create.feeAddFee");
    expect(NEW_SALE).toContain("create.feeAdd");
    expect(NEW_SALE).toContain("feeFromType(key(), type.id)");
    expect(NEW_SALE).toContain("SALE_FEE_TYPES.map");
    // Entfernen bleibt für jede Zeile möglich, auch für die vorbelegten.
    expect(NEW_SALE).toContain("setFees((f) => f.filter((x) => x.key !== fee.key))");
  });

  it("names every type in German, once", () => {
    const names = de.business.sales.create.feeTypes;
    for (const type of SALE_FEE_TYPES) {
      expect(names[type.id as keyof typeof names], type.id).toBeTruthy();
    }
    expect(de.business.sales.create.feeAddFee).toBe("+ Gebühr");
  });
});
