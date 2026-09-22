/**
 * Verkauf (ADR-0089).
 *
 * THE TWO THINGS MOST LIKELY TO GO WRONG, AND WHAT THEY WOULD COST
 *
 * 1. An internal sale growing its own copy of an order's amounts. The copy
 *    cannot be kept in step with a refund arriving next month, so the Orderbuch
 *    would quietly start reporting a number commerce disagrees with.
 * 2. A historical import moving stock. Current inventory was synchronised
 *    separately; replaying 1 256 sold rows against it would take 1 176 figures
 *    off a shelf they already left years ago.
 *
 * Both are constraints and triggers in `0059`, not conventions, and both are
 * asserted here against the migration text rather than against a hope.
 */
import { describe, expect, it } from "vitest";

import { allMigrations, code, latestFunction, migrationSource } from "@/test-support/migrations";
import {
  BATTLECAST, OWNER_MAPPINGS, buildSelfUsage, buildTightNameIndex,
  canonicalSaleIdentity, classifySaleItem, moneyToRows, plannedPayout,
  SOURCE_ROW_OVERRIDES,
  saleFingerprint, type SalesPlanDeps,
} from "./sales-import.ts";
import {
  isStandaloneCorrection, parseSalesSheet, salesSerialToIso,
  workbookExpectedPayout, type SalesRow,
} from "./sales-2026.ts";
import { indexCatalog, type CatalogEntry } from "./order-2026.ts";
import { SALE_TEMPLATES } from "./sale-template.ts";
import { SALE_ITEM_COLUMNS } from "@/components/business/sale-indicator";
import { de } from "@/lib/i18n/de";
import {
  adjustmentsTotal, feesTotal, groupFees, labelTotal,
  refundsTotal, type FeeRow,
} from "./sales-money.ts";
import {
  CHANNEL_LABELS, FEE_LABELS, MANUAL_CHANNELS, SETTLEMENT_LABELS, countryLabel,
  legacyOutcome, parseScope, rpcScope, saleItemActions, saleItemClosed,
  saleItemIndicator, saleItemStatus,
  safeSalesBackHref, saleStockStatus, salesHref, sortSales,
} from "./sales-view.ts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SQL = migrationSource("0059_orderbook_sales.sql");
const BACKFILL = migrationSource("0060_orderbook_sales_backfill.sql");
const PAYOUT = code(latestFunction("sale_expected_payout").body);
const BOOK = code(latestFunction("seller_book_sale_item").body);
const RESTOCK = code(latestFunction("seller_restock_sale_item").body);
const REGISTER = code(latestFunction("orders_register_sale").body);
const IMPORT = code(latestFunction("seller_import_sale_group").body);

const CATALOG: CatalogEntry[] = [
  { skyId: "SKY-0239", name: "Wash Buckler", series: "SF" },
  { skyId: "SKY-0240", name: "Wash Buckler (Dark)", series: "SF" },
  { skyId: "SKY-0203", name: "Blast Zone", series: "SF" },
  // The three the owner decided, each with the rival it had to be chosen over.
  { skyId: "SKY-0419", name: "Kaos", series: "TT" },
  { skyId: "SKY-0563", name: "Kaos", series: "IM" },
  { skyId: "SKY-0336", name: "Tuff Luck", series: "TT" },
  { skyId: "SKY-0337", name: "Tuff Luck (Clear Crystal)", series: "TT" },
  { skyId: "SKY-0115", name: "Legendary Bouncer", series: "G" },
  // One figure is NAMED `Free Ranger`; the Legendary is a different name.
  { skyId: "SKY-0212", name: "Free Ranger", series: "SF" },
  { skyId: "SKY-0215", name: "Free Ranger (Legendary)", series: "SF" },
  // Three `Ignitor`s across two games, which is why nothing resolves one.
  { skyId: "SKY-0045", name: "Ignitor", series: "SA" },
  { skyId: "SKY-0167", name: "Ignitor", series: "G" },
  { skyId: "SKY-0168", name: "Legendary Ignitor", series: "G" },
  // Both variants of the two names the owner ruled on row by row.
  { skyId: "SKY-0015", name: "Chop Chop", series: "SA" },
  { skyId: "SKY-0149", name: "Chop Chop", series: "G" },
  { skyId: "SKY-0059", name: "Stealth Elf", series: "SA" },
  { skyId: "SKY-0178", name: "Stealth Elf", series: "G" },
];
const STOCK: Record<string, string> = {
  "SF|48": "Wash Buckler", "SF|12": "Blast Zone", "SF|13": "Blash Zone - OBERTEIL",
  "ZB|8": "0000502 (G)", "DI A|84": "2.0 -Thor",
  // The two names the workbook really does carry in both games.
  "SA|19": "Chop Chop", "G|47": "Chop Chop",
  "SA|63": "Stealth Elf", "G|76": "Stealth Elf",
  "SA|49": "Ignitor",
};
const row = (over: Partial<SalesRow> = {}): SalesRow =>
  ({ row: 5, k: "", stockFlag: "x", shippedFlag: "x", artikel: "Blast Zone",
     artikelFormula: "", marketFormula: "SF!I12", marketValue: "0.99",
     money: {}, buyer: "", ...over });
const deps = (over: Partial<SalesPlanDeps> = {}): SalesPlanDeps => ({
  stockName: (s, r) => STOCK[`${s}|${r}`] ?? null,
  bySheetName: indexCatalog(CATALOG),
  savedMappings: new Map(),
  selfUsage: new Map(),
  byTightName: buildTightNameIndex(CATALOG),
  disneyNames: new Set<string>(["20thor"]),
  imported: new Set<string>(),
  factor: 0.376347,
  ...over,
});

describe("an internal sale never copies what commerce owns", () => {
  it("the constraint says which shape a sale has", () => {
    expect(SQL).toContain("check ((channel = 'skyisles') = (order_id is not null))");
  });

  it("an internal sale is forbidden to store its own amounts", () => {
    /*
     * The heart of it. Without this the table would ACCEPT a copy, and the
     * first refund would make two numbers disagree with nobody watching.
     */
    expect(SQL).toContain("sales_internal_owns_no_amounts");
    expect(SQL).toContain("(items_subtotal is null and shipping_charged is null and discount_amount is null)");
  });

  it("an external sale must have a subtotal of its own", () => {
    expect(SQL).toContain("check (order_id is not null or items_subtotal is not null)");
  });

  it("the payout reads the ORDER for an internal sale and the sale for an external one", () => {
    expect(PAYOUT).toContain("when s.order_id is not null then");
    expect(PAYOUT).toContain("o.items_subtotal");
    expect(PAYOUT).toContain("public.order_refunds");
    expect(PAYOUT).toContain("s.items_subtotal");
    expect(PAYOUT).toContain("public.sale_refunds");
  });

  it("and Orderbuch refuses to write commerce's facts", () => {
    const update = code(latestFunction("seller_update_sale").body);
    expect(update).toContain("these belong to the order, not to the Orderbuch");
    expect(code(latestFunction("seller_add_sale_refund").body))
      .toContain("belong to commerce");
    expect(code(latestFunction("seller_add_sale_item").body))
      .toContain("takes its items from the order");
  });
});

describe("internal registration happens exactly once", () => {
  it("is a trigger on the order, not a webhook branch", () => {
    /*
     * `payment_status` is set from more than one place — the webhook and the
     * late-payment recovery in 0043 — and a UI-driven registration would mean
     * the sale exists only once somebody looked at a screen.
     */
    expect(SQL).toContain("after insert or update of payment_status on public.orders");
    expect(REGISTER).toContain("if new.payment_status <> 'paid'");
  });

  it("does nothing when the order was already paid", () => {
    expect(REGISTER).toContain("old.payment_status = 'paid'");
  });

  it("loses a race instead of winning it twice", () => {
    // A unique index plus `on conflict do nothing` — not SELECT-then-INSERT,
    // which is the same bug one layer up.
    expect(SQL).toContain("create unique index if not exists sales_order_uniq");
    expect(REGISTER).toContain("on conflict (order_id)");
    expect(REGISTER).toContain("do nothing");
  });

  it("creates no inventory movement", () => {
    for (const forbidden of ["record_inventory_movement", "apply_inventory_movement", "shop_inventory"]) {
      expect(REGISTER, forbidden).not.toContain(forbidden);
    }
  });

  it("and 0060 backfills the orders that were paid before the trigger existed", () => {
    expect(BACKFILL).toContain("on conflict (order_id)");
    expect(code(BACKFILL)).not.toMatch(/record_inventory_movement|shop_inventory|update public\.orders/i);
  });
});

describe("history never moves stock", () => {
  it("a trigger refuses a movement on an imported row", () => {
    // Not a convention in the importer: an invariant the database holds even
    // against service_role.
    expect(SQL).toContain("sale_items_no_historical_movement");
    expect(SQL).toContain("a historical sale item cannot own an inventory movement");
    expect(SQL).toContain("before insert or update on public.sale_items");
  });

  it("the importer writes no movement and no market snapshot", () => {
    for (const forbidden of ["record_inventory_movement", "movement_id", "market_price_snapshot"]) {
      expect(IMPORT, forbidden).not.toContain(forbidden);
    }
  });

  it("Ausbuchen and Wiedereinlagern both refuse a historical sale", () => {
    expect(BOOK).toContain("historical sales never move stock");
    expect(RESTOCK).toContain("historical sales never move stock");
  });

  it("and the legacy markers are text, not instructions", () => {
    expect(IMPORT).toContain("legacy_stock_flag");
    expect(IMPORT).toContain("legacy_shipped_flag");
  });
});

describe("Ausbuchen", () => {
  it("uses the canonical writer and the existing reason", () => {
    expect(BOOK).toContain("public.record_inventory_movement(");
    expect(BOOK).toContain("'sale_external'");
    expect(BOOK).toContain("-1");
  });

  it("is idempotent through the movement link", () => {
    expect(BOOK).toContain("if v_item.movement_id is not null then return v_item.movement_id; end if;");
    expect(SQL).toContain("create unique index if not exists sale_items_movement_uniq");
  });

  it("leaves reservation-awareness to the one place that already has it", () => {
    /*
     * `apply_inventory_movement` guards `quantity + delta >= reserved` inside
     * the UPDATE's WHERE clause, so there is no window between reading and
     * writing. A second check here would be a weaker copy of a rule that holds.
     */
    expect(BOOK).not.toContain("available_quantity");
    expect(BOOK).not.toContain("reserved");
  });

  it("freezes the market price at the moment the object leaves", () => {
    expect(BOOK).toContain("market_price_snapshot = v_price");
  });

  it("freezes ONE Buy-In factor per sale, not one per item", () => {
    // `coalesce` keeps the first: booking item by item must not give two
    // figures of one parcel two different economics.
    expect(BOOK).toContain("coalesce(buy_in_factor_snapshot, public.orderbook_global_factor())");
  });

  it("refuses an item with no catalog figure", () => {
    expect(BOOK).toContain("not a catalog figure and has no stock position");
  });

  it("and reversal is a compensating movement, never a deletion", () => {
    const unbook = code(latestFunction("seller_unbook_sale_item").body);
    expect(unbook).toContain("'correction'");
    expect(unbook).not.toContain("delete from public.inventory_movements");
  });
});

describe("Retoure and restock are two decisions", () => {
  it("marking a return moves no stock", () => {
    const ret = code(latestFunction("seller_return_sale_item").body);
    expect(ret).not.toContain("record_inventory_movement");
  });

  it("restocking is explicit, and needs the return first", () => {
    expect(RESTOCK).toContain("mark the item as returned before putting it back");
    expect(RESTOCK).toContain("'return'");
    expect(RESTOCK).toContain("1,");
  });

  it("is idempotent", () => {
    expect(RESTOCK).toContain("if v_item.return_movement_id is not null then return v_item.return_movement_id");
  });

  it("and the constraints say what is possible", () => {
    expect(SQL).toContain("check (return_movement_id is null or returned_at is not null)");
    expect(SQL).toContain("check (return_movement_id is null or movement_id is not null)");
  });

  it("a refund is financial and implies none of it", () => {
    /*
     * The workbook settles this: 41 refunded orders, 6 with returned goods.
     * `sale_refunds` has no column that could touch an item.
     */
    expect(SQL).toContain("A financial event with no physical meaning");
    const refund = code(latestFunction("seller_add_sale_refund").body);
    expect(refund).not.toContain("returned_at");
    expect(refund).not.toContain("record_inventory_movement");
  });
});

describe("fees are rows with a settlement, not columns", () => {
  it("four kinds and two settlements", () => {
    expect(SQL).toContain("check (kind in ('payment', 'marketplace', 'shipping_label', 'other'))");
    expect(SQL).toContain("check (settled_by in ('channel', 'external'))");
  });

  it("`other` has to say what it is", () => {
    expect(SQL).toContain("sale_fees_other_has_label");
  });

  it("amounts are positive magnitudes and a credit is refused", () => {
    expect(SQL).toContain("check (amount >= 0 and amount <= 1000000)");
    expect(code(latestFunction("seller_add_sale_fee").body))
      .toContain("a fee is a positive amount; use a settlement adjustment for a credit");
  });

  it("only channel-settled fees reduce the payout", () => {
    expect(PAYOUT).toContain("f.settled_by = 'channel'");
  });

  it("which is what collapses `lbl eBay` and `lbl ext` into one kind", () => {
    const { fees } = moneyToRows({ X: 3.35, AA: 2.12, Y: 5.49, Z: 8.5, U: 0, V: 0, W: 0, AD: 0, AB: 0 });
    expect(fees).toEqual([
      { kind: "payment", amount: 3.35, settled_by: "channel" },
      { kind: "marketplace", amount: 2.12, settled_by: "channel" },
      { kind: "shipping_label", amount: 5.49, settled_by: "channel" },
      { kind: "shipping_label", amount: 8.5, settled_by: "external" },
    ]);
  });
});

describe("settlement adjustments — the signed exception", () => {
  it("`Fee S.` becomes a credit, not a negative fee", () => {
    const { adjustments, fees } = moneyToRows({ AB: 0.42, X: 0.68, U: 0, V: 0, W: 0, AA: 0, Y: 0, Z: 0, AD: 0 });
    expect(adjustments).toEqual([{ amount: 0.42, reason: "gebuehrengutschrift", note: "Order 2026, Spalte `Fee S.`" }]);
    expect(fees.some((f) => f.amount < 0)).toBe(false);
  });

  it("a standalone adjustment needs no sale and is excluded from every sale's payout", () => {
    /*
     * `Korrektur >` has Summe 0,00 and −5,19 € of shipping label with nothing
     * sold behind it. Its buyer has three real orders and the workbook links it
     * to none — so the alternative was a fake zero-item sale.
     */
    expect(SQL).toContain("sale_id bigint,\n  channel text not null");
    expect(SQL).toContain("settlement_adjustments_standalone_identified");
    expect(PAYOUT).toContain("where a.sale_id = s.id");
  });

  it("and it is signed, unlike everything else", () => {
    expect(SQL).toContain("amount numeric(10,2) not null,   -- SIGNED");
    expect(SQL).toContain("settlement_adjustments_amount_not_zero");
  });
});

describe("expected payout", () => {
  it("is the formula the workbook used, in normalized form", () => {
    const m = { U: 17.66, V: 5.49, W: 0.88, X: 3.35, AA: 2.12, Y: 5.49, Z: 0, AB: 0, AD: 0 };
    const { fees, refunds, adjustments } = moneyToRows(m);
    expect(plannedPayout(m.U, m.V, m.W, fees, refunds, adjustments))
      .toBeCloseTo(workbookExpectedPayout(m), 10);
  });

  it("excludes an externally paid label — it never passed through the channel", () => {
    const m = { U: 21.91, V: 12.99, W: 0, X: 1.74, AA: 4.16, Y: 0, Z: 8.5, AB: 0, AD: 0 };
    const { fees, refunds, adjustments } = moneyToRows(m);
    expect(plannedPayout(m.U, m.V, m.W, fees, refunds, adjustments)).toBeCloseTo(29.0, 2);
  });

  it("reproduces the `Fee S.` order exactly", () => {
    const m = { U: 1.95, V: 4.99, W: 0, X: 0.68, AA: 0.07, Y: 0, Z: 0, AB: 0.42, AD: 4.99 };
    const { fees, refunds, adjustments } = moneyToRows(m);
    expect(plannedPayout(m.U, m.V, m.W, fees, refunds, adjustments)).toBeCloseTo(1.62, 2);
  });

  it("is derived, never stored", () => {
    expect(SQL).not.toMatch(/expected_payout\s+numeric/);
  });

  it("reported payout is nullable and never seeded from our own arithmetic", () => {
    expect(SQL).toContain("reported_payout_amount numeric(10,2)");
    expect(IMPORT).not.toContain("reported_payout");
  });
});

describe("historical identity", () => {
  it("the P reference wins", () => {
    const item = classifySaleItem(row(), 1, deps());
    expect(item.skyId).toBe("SKY-0203");
    expect(item.evidence).toBe("formula");
  });

  it("all 17 washbuckler rows are the normal variant, by owner decision", () => {
    /*
     * Ambiguous on the evidence — the catalog holds Wash Buckler AND
     * Wash Buckler (Dark), and none of the 17 rows carries a reference. So it
     * is a named decision, not a fuzzy match dressed as deduction.
     */
    expect(OWNER_MAPPINGS.get("washbuckler")).toBe("SKY-0239");
    const item = classifySaleItem(row({ artikel: "washbuckler", marketFormula: "" }), 1, deps());
    expect(item.skyId).toBe("SKY-0239");
    expect(item.skyId).not.toBe("SKY-0240");
    expect(item.evidence).toBe("owner");
  });

  it("Battlecast stays a real purchase with no invented figure", () => {
    for (const name of ["Battlecast Booster Pack 1", "battlecast battle pack 2"]) {
      const item = classifySaleItem(row({ artikel: name, marketFormula: "" }), 1, deps());
      expect(item.skyId, name).toBeNull();
      expect(item.classification, name).toBe("uncategorized");
      expect(item.evidence, name).toBe("battlecast");
    }
    expect(BATTLECAST.test("blast zone")).toBe(false);
  });

  it("the workbook resolves its own shorthand, and only when it is consistent", () => {
    const rows = [
      row({ row: 10, artikel: "Blast Zone", marketFormula: "SF!I12" }),
      row({ row: 11, artikel: "Blast Zone", marketFormula: "SF!I12" }),
      row({ row: 12, artikel: "Mixed", marketFormula: "SF!I12" }),
      row({ row: 13, artikel: "Mixed", marketFormula: "SF!I48" }),
    ];
    const usage = buildSelfUsage(rows, deps().stockName);
    expect(usage.get("blast zone")).toEqual({ sheet: "SF", name: "Blast Zone" });
    // Two different targets for one name is not evidence.
    expect(usage.has("mixed")).toBe(false);
  });

  it("a ZB or DI A destination is a non-figure, never a figure", () => {
    for (const [name, formula] of [["0000502 (G)", "ZB!I8"], ["2.0 -Thor", "'DI A'!I84"]] as const) {
      const item = classifySaleItem(row({ artikel: name, marketFormula: formula }), 1, deps());
      expect(item.skyId, name).toBeNull();
      expect(item.classification, name).toBe("uncategorized");
    }
  });

  it("the three ambiguous names the owner ruled on, and the rivals he ruled out", () => {
    /*
     * None of these is deducible. `Kaos` is two different figures with the
     * same name; `Tuff Lu k` is a typo whose two repairs are two different
     * products; `Legendary Bouner` needs a letter added before it is a catalog
     * name at all — and adding letters is not something a rule may do.
     *
     * So each one is recorded as a decision with the owner's name on it, and
     * the test pins the rejected candidate as hard as the chosen one.
     */
    for (const [raw, chosen, rejected] of [
      ["Kaos", "SKY-0563", "SKY-0419"],
      ["Tuff Lu k", "SKY-0336", "SKY-0337"],
      ["Legendary Bouner", "SKY-0115", null],
    ] as const) {
      const item = classifySaleItem(row({ artikel: raw, marketFormula: "" }), 1, deps());
      expect(item.skyId, raw).toBe(chosen);
      expect(item.evidence, raw).toBe("owner");
      if (rejected) expect(item.skyId, raw).not.toBe(rejected);
    }
  });

  it("the four rows nobody can decide stay undecided", () => {
    /*
     * Two `Chop Chop`, one `Stealth Elf`, one `Ignitior` — each with no
     * formula, no cached value and more than one candidate. Every tiebreak
     * available here is a guess wearing a rule's clothes: closest spelling,
     * cheapest price, first candidate, the tendency of the other rows. The
     * importer leaves them for the operator instead.
     */
    for (const name of ["Chop Chop", "Stealth Elf", "Ignitior"]) {
      expect(OWNER_MAPPINGS.has(name.toLowerCase()), name).toBe(false);
    }
    const item = classifySaleItem(row({ artikel: "Ignitor", marketFormula: "" }), 1, deps());
    expect(item.skyId).toBeNull();
    expect(item.classification).toBe("unmatched");
  });

  it("a reference that points at no row at all is not an answer", () => {
    /*
     * One row in 1 256 carries `SC!I119`, and the SuperChargers sheet stops at
     * row 82. A dead link is absence of evidence, so it must not outrank the
     * evidence that IS there — the owner's own twenty-one other `Free Ranger`
     * references, all naming the same stock row, which step 6 reads.
     *
     * The regression this pins: treating any non-empty formula as a verdict,
     * which returned `unmatched` and never reached step 6.
     */
    const usage = new Map([["free ranger", { sheet: "SF", name: "Free Ranger" }]]);
    const bySheetName = indexCatalog(CATALOG);
    const item = classifySaleItem(
      row({ artikel: "Free Ranger", marketFormula: "SC!I119", marketValue: "0" }),
      1, deps({ selfUsage: usage, bySheetName }),
    );
    expect(item.skyId).toBe("SKY-0212");
    // The preview has to be able to say WHERE it came from.
    expect(item.evidence).toBe("self");
    expect(item.note).toContain("SF");
  });

  it("but a reference that DOES resolve still outranks every weaker signal", () => {
    /*
     * The fall-through above widens nothing else. `SF!I48` resolves to
     * `Wash Buckler`, and it keeps winning over a self-usage entry and over a
     * unique catalog name that both say something different.
     */
    const item = classifySaleItem(
      row({ artikel: "Free Ranger", marketFormula: "SF!I48" }), 1,
      deps({ selfUsage: new Map([["free ranger", { sheet: "SF", name: "Free Ranger" }]]) }),
    );
    expect(item.skyId).toBe("SKY-0239");
    expect(item.evidence).toBe("formula");
  });

  it("an owner decision about one row beats even a valid reference", () => {
    /*
     * The five rows the owner ruled on individually. Row 1368 is the one that
     * forces the precedence: `ignitor` is referenced as `SA!I49` on eighteen
     * rows, so self-usage had it as SKY-0045 — a sound general inference that
     * happens to be wrong about the parcel the owner actually packed.
     */
    for (const [sourceRow, raw, sky] of [
      [1368, "Ignitor", "SKY-0167"],
      [1369, "Ignitior", "SKY-0167"],
      [1510, "Stealth Elf", "SKY-0059"],
      [1513, "Chop Chop", "SKY-0015"],
      [1517, "Chop Chop", "SKY-0015"],
    ] as const) {
      expect(SOURCE_ROW_OVERRIDES.get(`Order 2026|${sourceRow}`), String(sourceRow)).toBe(sky);
      const item = classifySaleItem(
        // A reference is supplied deliberately: the override must win anyway.
        row({ row: sourceRow, artikel: raw, marketFormula: "SA!I19" }), 1,
        deps({ selfUsage: new Map([["ignitor", { sheet: "SA", name: "Ignitor" }]]) }),
      );
      expect(item.skyId, String(sourceRow)).toBe(sky);
      expect(item.evidence, String(sourceRow)).toBe("override");
      expect(item.note, String(sourceRow)).toContain(String(sourceRow));
    }
  });

  it("an override reaches its own row and nothing else", () => {
    /*
     * The whole reason the key is a row and not a name. `Chop Chop` is sold as
     * both variants and the workbook says which through the reference; if the
     * owner's ruling on rows 1513/1517 leaked into a name mapping it would
     * silently rewrite the eighteen SA rows and the one Giants row alike.
     */
    const g = deps();
    const sa = classifySaleItem(row({ row: 22, artikel: "Chop Chop", marketFormula: "SA!I19" }), 1, g);
    expect(sa.skyId).toBe("SKY-0015");
    expect(sa.evidence).toBe("formula");

    const giants = classifySaleItem(row({ row: 999, artikel: "Chop Chop", marketFormula: "G!I47" }), 1, g);
    expect(giants.skyId).toBe("SKY-0149");
    expect(giants.evidence).toBe("formula");

    const elfSa = classifySaleItem(row({ row: 21, artikel: "Stealth Elf", marketFormula: "SA!I63" }), 1, g);
    expect(elfSa.skyId).toBe("SKY-0059");
    const elfG = classifySaleItem(row({ row: 998, artikel: "Stealth Elf", marketFormula: "G!I76" }), 1, g);
    expect(elfG.skyId).toBe("SKY-0178");

    // And no other Ignitor row is dragged to Giants by rows 1368/1369.
    const otherIgnitor = classifySaleItem(
      row({ row: 34, artikel: "Ignitor", marketFormula: "SA!I49" }), 1, g);
    expect(otherIgnitor.skyId).toBe("SKY-0045");
    const byName = classifySaleItem(
      row({ row: 1345, artikel: "Ignitor", marketFormula: "" }), 1,
      deps({ selfUsage: new Map([["ignitor", { sheet: "SA", name: "Ignitor" }]]) }));
    expect(byName.skyId).toBe("SKY-0045");
  });

  it("every override names a real historical row, never a bare name", () => {
    for (const key of SOURCE_ROW_OVERRIDES.keys()) {
      expect(key, key).toMatch(/^Order 2026\|\d+$/);
    }
    expect(SOURCE_ROW_OVERRIDES.size).toBe(5);
  });

  it("a swap half never becomes the whole character", () => {
    const item = classifySaleItem(row({ artikel: "Blastzone - OBERTEIL", marketFormula: "SF!I13" }), 1, deps());
    expect(item.skyId).toBeNull();
  });
});

describe("grouping, dates and fingerprints", () => {
  it("a serial becomes a date and a typo does not", () => {
    expect(salesSerialToIso("46387")).toBe("2026-12-31");
    for (const bad of ["18", "16.04.206", "Korrektur >", ""]) {
      expect(salesSerialToIso(bad), bad).toBeNull();
    }
  });

  it("the standalone correction is recognised as not a sale", () => {
    expect(isStandaloneCorrection({ money: { U: 0, V: 0, AE: -5.19 } } as never)).toBe(true);
    expect(isStandaloneCorrection({ money: { U: 6.35, V: 10.74, AE: 0 } } as never)).toBe(false);
  });

  it("the fingerprint keys on the header row, because date+buyer collides", () => {
    // 18 collisions across the 297 orders — (date, buyer) is not identity.
    const identity = canonicalSaleIdentity(
      { headerRow: 37, date: "2026-01-04", buyer: "x", money: { U: 1, AE: 2 } } as never, []);
    expect(identity).toContain("37");
    expect(identity).toContain("orderbuch-sales-1");
  });

  it("two same-day orders from one buyer get different fingerprints", async () => {
    const a = await saleFingerprint({ headerRow: 37, date: "2026-01-04", buyer: "x", money: { U: 1, AE: 2 } } as never, []);
    const b = await saleFingerprint({ headerRow: 43, date: "2026-01-04", buyer: "x", money: { U: 1, AE: 2 } } as never, []);
    expect(a).not.toBe(b);
  });

  it("the parser survives a self-closing cell", () => {
    const rows = parseSalesSheet(
      `<sheetData><row r="6"><c r="K6"/><c r="L6" t="s"><v>0</v></c><c r="M6" t="s"><v>0</v></c>` +
      `<c r="O6" t="s"><v>1</v></c><c r="P6"><f>SF!I12</f><v>0.99</v></c></row></sheetData>`,
      ["x", "Blast Zone"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ stockFlag: "x", shippedFlag: "x", artikel: "Blast Zone", marketFormula: "SF!I12" });
  });

  it("and a repeated header block is not a sale row", () => {
    const rows = parseSalesSheet(
      `<sheetData><row r="9"><c r="K9" t="s"><v>0</v></c><c r="O9" t="s"><v>1</v></c></row></sheetData>`,
      ["Datum", "Artikel"]);
    expect(rows).toHaveLength(0);
  });
});

describe("security posture matches the rest of the Orderbuch", () => {
  it("every table is RLS-enabled and revoked from every client role", () => {
    for (const t of ["sales", "sale_items", "sale_fees", "sale_refunds", "settlement_adjustments"]) {
      expect(SQL, t).toContain(`alter table public.${t} enable row level security`);
      expect(SQL, t).toContain(`revoke all on table public.${t} from public, anon, authenticated`);
    }
  });

  it("every seller function asks the canonical predicate", () => {
    for (const fn of ["seller_sales", "seller_sale", "seller_create_sale", "seller_book_sale_item",
                      "seller_restock_sale_item", "seller_import_sale_group", "seller_set_sale_payout"]) {
      expect(code(latestFunction(fn).body), fn).toContain("can_operate_active_seller()");
    }
  });

  it("and no seller_id appears anywhere — ADR-0021 still holds", () => {
    expect(code(SQL)).not.toContain("seller_id");
  });

  it("the file adds no policy and touches no existing table's data", () => {
    expect(code(SQL)).not.toMatch(/create policy|alter policy/i);
    expect(code(SQL)).not.toMatch(/delete from public\.(orders|order_lines|shop_inventory|inventory_movements)/i);
  });
});

/**
 * The Verkauf screens' data layer.
 *
 * Everything a component decides that a screenshot would not catch: which
 * button may appear, what a missing payout means, how a filter becomes a URL.
 * The Einkauf ledger shipped once with the whole desktop grid replaced and
 * every behavioural test still green — this block is the lesson.
 */
describe("the payout is derived and nothing else (ADR-0095)", () => {
  it("the reconciliation helpers are gone", async () => {
    // `payoutState`, `payoutDifference`, `payoutCell` and `payoutDelta` all
    // existed to compare a typed-in figure against the computed one. There is
    // no typed-in figure any more, so there is nothing to compare.
    const view = await import("./sales-view.ts") as Record<string, unknown>;
    const money = await import("./sales-money.ts") as Record<string, unknown>;
    for (const gone of ["payoutState", "payoutDifference"]) expect(view[gone], gone).toBeUndefined();
    for (const gone of ["payoutCell", "payoutDelta"]) expect(money[gone], gone).toBeUndefined();
  });

  it("but the FORMULA is untouched", () => {
    // Still the workbook's own expression, still the importer's function.
    expect(plannedPayout(20, 4.99, 0,
      [{ kind: "marketplace", amount: 3.42, settled_by: "channel" }], [], [])).toBeCloseTo(21.57, 2);
    // And an externally settled label still does not reduce it.
    expect(plannedPayout(20, 0, 0,
      [{ kind: "shipping_label", amount: 2, settled_by: "external" }], [], [])).toBe(20);
    expect(plannedPayout(20, 0, 0,
      [{ kind: "shipping_label", amount: 2, settled_by: "channel" }], [], [])).toBe(18);
  });

  it("and the SQL that owns it is untouched too", () => {
    const sql = code(latestFunction("sale_expected_payout").body);
    expect(sql).toContain("settled_by = 'channel'");
    expect(sql).toContain("settlement_adjustments");
    expect(latestFunction("sale_expected_payout").file).toBe("0059_orderbook_sales.sql");
  });
});

describe("one position, one status, one action (0074/0075)", () => {
  const item = (over: Record<string, unknown> = {}) => ({
    movement_id: null, returned_at: null, return_movement_id: null,
    settled_at: null, not_shipped_at: null, return_announced_at: null,
    sky_id: "SKY-0203", legacy_stock_flag: null, ...over,
  } as never);
  const ctx = (over: Partial<{ frozen: boolean; cancelled: boolean; shipped: boolean }> = {}) =>
    ({ frozen: false, cancelled: false, shipped: true, ...over });

  it("walks a figure through the whole life it can have", () => {
    /*
     * The physical story, one step at a time. Each step is one fact the
     * database records, and each shows exactly one status.
     */
    // Offen heißt seit 0090 nicht mehr „keine Aktion": ein Klick verschickt
    // die Position und datiert den Versand des Verkaufs.
    expect(saleItemActions(item(), ctx({ shipped: false })))
      .toMatchObject({ status: "open", primary: "ship" });
    expect(saleItemActions(item(), ctx()))
      .toMatchObject({ status: "shipped", primary: "book" });
    expect(saleItemActions(item({ movement_id: 5 }), ctx()))
      .toMatchObject({ status: "outbooked", primary: "announce_return" });
    expect(saleItemActions(item({ movement_id: 5, return_announced_at: "t" }), ctx()))
      .toMatchObject({ status: "return_announced", primary: "mark_returned" });
    expect(saleItemActions(item({ movement_id: 5, returned_at: "t" }), ctx()))
      .toMatchObject({ status: "returned", primary: "restock" });
    expect(saleItemActions(item({ movement_id: 5, returned_at: "t", return_movement_id: 6 }), ctx()))
      .toMatchObject({ status: "restocked", primary: null });
  });

  it("never shows two states at once", () => {
    /*
     * The bug this replaced: `Bestand` said `Ausgebucht` and `Retoure` said
     * `Wieder eingelagert` in the same row, and the reader had to work out
     * which was true now.
     */
    const restocked = item({ movement_id: 5, returned_at: "t", return_movement_id: 6 });
    expect(saleItemActions(restocked, ctx()).status).toBe("restocked");
    expect(saleItemActions(restocked, ctx()).status).not.toBe("outbooked");
  });

  it("offers `Nicht verschickt` while the piece is still on the shelf, and not after", () => {
    expect(saleItemActions(item(), ctx({ shipped: false })).canNotShip).toBe(true);
    expect(saleItemActions(item(), ctx()).canNotShip).toBe(true);
    expect(saleItemActions(item({ movement_id: 5 }), ctx()).canNotShip).toBe(false);
    // And it is its own ending, distinct from `Erledigt`.
    expect(saleItemActions(item({ not_shipped_at: "t" }), ctx()))
      .toMatchObject({ status: "not_shipped", primary: "unmark_not_shipped" });
  });

  it("keeps the settle lock exactly where 0073 put it", () => {
    // A shelf-bound figure books; it is never closed without a movement.
    expect(saleItemActions(item(), ctx())).toMatchObject({ primary: "book" });
    expect(saleItemActions(item(), ctx()).primary).not.toBe("settle");
    // No catalog row, or the workbook's not-from-stock marker: closed.
    expect(saleItemActions(item({ sky_id: null }), ctx())).toMatchObject({ primary: "settle" });
    expect(saleItemActions(item({ legacy_stock_flag: "-" }), ctx()))
      .toMatchObject({ primary: "settle" });
    // And neither of those may be marked `Nicht verschickt` instead —
    // there is no shelf for them to have stayed on.
    expect(saleItemActions(item({ sky_id: null }), ctx()).canNotShip).toBe(false);
  });

  it("a frozen or cancelled order offers nothing at all", () => {
    for (const c of [ctx({ frozen: true }), ctx({ cancelled: true })]) {
      expect(saleItemActions(item(), c)).toMatchObject({ primary: null, canNotShip: false });
      expect(saleItemActions(item({ sky_id: null }), c).primary).toBeNull();
    }
  });

  it("agrees with the database about what counts as finished", () => {
    // Mirrors `sale_item_is_closed()` in 0075, case for case.
    expect(saleItemClosed(item())).toBe(false);
    expect(saleItemClosed(item({ movement_id: 5 }))).toBe(true);
    expect(saleItemClosed(item({ movement_id: 5, return_announced_at: "t" }))).toBe(false);
    expect(saleItemClosed(item({ movement_id: 5, returned_at: "t" }))).toBe(false);
    expect(saleItemClosed(item({ movement_id: 5, returned_at: "t", return_movement_id: 6 }))).toBe(true);
    expect(saleItemClosed(item({ settled_at: "t" }))).toBe(true);
    expect(saleItemClosed(item({ not_shipped_at: "t" }))).toBe(true);
  });
});

describe("what the stock column says about a whole sale (0072)", () => {
  const sale = (over: Partial<Parameters<typeof saleStockStatus>[0]> = {}) => ({
    source: "manual", cancelledAt: null, stockReleasedAt: null, orderId: null,
    itemCount: 3, outbookedCount: 0, settledCount: 0, ...over,
  });

  it("the tick belongs to real movements and to nothing else", () => {
    expect(saleStockStatus(sale({ outbookedCount: 3 }))).toBe("outbooked");
  });

  it("finished partly by settling is `Abgeschlossen`, never `Ausgebucht`", () => {
    /*
     * Nothing outstanding, but one piece never left figure inventory. Two
     * different sentences, and the tick is only the first one.
     */
    const s = sale({ outbookedCount: 2, settledCount: 1 });
    expect(saleStockStatus(s)).toBe("closed");
    expect(saleStockStatus(s)).not.toBe("outbooked");
    // All three closed the same way, and that way is not a booking.
    expect(saleStockStatus(sale({ settledCount: 3 }))).toBe("closed");
  });

  it("partly and not at all are distinguished", () => {
    expect(saleStockStatus(sale({ outbookedCount: 1 }))).toBe("partial");
    expect(saleStockStatus(sale({ settledCount: 1 }))).toBe("partial");
    expect(saleStockStatus(sale())).toBe("open");
  });

  it("a cancelled order outranks everything", () => {
    expect(saleStockStatus(sale({ cancelledAt: "2026-08-31", outbookedCount: 3 })))
      .toBe("cancelled");
  });

  it("a workbook sale is frozen until 0071 releases it, then it is ordinary", () => {
    expect(saleStockStatus(sale({ source: "excel_order_2026" }))).toBe("frozen");
    expect(saleStockStatus(sale({ source: "excel_order_2026", stockReleasedAt: "2026-09-20" })))
      .toBe("open");
  });

  it("an order's lines belong to commerce", () => {
    expect(saleStockStatus(sale({ orderId: 7 }))).toBe("frozen");
  });

  it("settled is never counted as outbooked", () => {
    // Stated over the whole space: `outbooked` requires outbookedCount to
    // equal itemCount on its own, with settled nowhere in the sum.
    for (const settled of [0, 1, 2, 3]) {
      const s = sale({ outbookedCount: 3 - settled, settledCount: settled, itemCount: 3 });
      expect(saleStockStatus(s) === "outbooked", `settled=${settled}`).toBe(settled === 0);
    }
  });
});

describe("scope, filters and URLs", () => {
  it("Extern is the default — it is the tab with work in it", () => {
    expect(parseScope(undefined)).toBe("extern");
    expect(parseScope("intern")).toBe("intern");
    expect(parseScope("nonsense")).toBe("extern");
  });

  it("maps to the name the database uses", () => {
    expect(rpcScope("intern")).toBe("internal");
    expect(rpcScope("extern")).toBe("external");
  });

  it("builds URLs without redundant parameters", () => {
    expect(salesHref("extern")).toBe("/business/orderbuch/verkauf");
    expect(salesHref("intern", 2026, 7, "Drobot"))
      .toBe("/business/orderbuch/verkauf?bereich=intern&jahr=2026&monat=7&q=Drobot");
  });

  it("drops the month under `Ohne Datum` — there is no date to be in a month of", () => {
    expect(salesHref("extern", "ohne", 7)).toBe("/business/orderbuch/verkauf?jahr=ohne");
  });

  it("refuses a back link that points anywhere else", () => {
    expect(safeSalesBackHref("/business/orderbuch/verkauf?bereich=intern"))
      .toBe("/business/orderbuch/verkauf?bereich=intern");
    for (const hostile of ["https://evil.example", "//evil.example", "/admin",
                           "/business/orderbuch/verkaufXXX/../../admin"]) {
      expect(safeSalesBackHref(hostile), hostile).toBe("/business/orderbuch/verkauf");
    }
  });

  it("sorts newest first with undated last", () => {
    expect(sortSales([{ id: 1, soldAt: null }, { id: 2, soldAt: "2026-01-01" },
                      { id: 3, soldAt: null }, { id: 4, soldAt: "2026-08-01" }])
      .map((s) => s.id)).toEqual([4, 2, 3, 1]);
  });
});

describe("the vocabulary", () => {
  it("names channels the way a person does", () => {
    expect(CHANNEL_LABELS.ebay).toBe("eBay");
    expect(CHANNEL_LABELS.skyisles).toBe("SkyIsles");
  });

  it("offers only the channels the owner may create by hand", () => {
    // `skyisles` is never one: an internal sale exists because an order was paid.
    expect(MANUAL_CHANNELS).not.toContain("skyisles");
    expect(MANUAL_CHANNELS).toEqual(["ebay", "manual"]);
  });

  it("names fees and settlements in German, never by legacy column", () => {
    expect(FEE_LABELS.shipping_label).toBe("Versandlabel");
    expect(SETTLEMENT_LABELS.channel).toBe("Über Verkaufskanal");
    expect(SETTLEMENT_LABELS.external).toBe("Extern bezahlt");
    for (const label of Object.values(FEE_LABELS)) {
      expect(label.toLowerCase()).not.toContain("ebay");
      expect(label.toLowerCase()).not.toContain("lbl");
    }
  });

  it("shows a country as a country", () => {
    expect(countryLabel("DE")).toBe("Deutschland");
    expect(countryLabel(null)).toBe("—");
  });
});

describe("the ledger renders as a table", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const CSS = read("src/app/globals.css");
  const LEDGER = read("src/components/business/sales-ledger.tsx");
  const EINKAUF = read("src/components/business/orderbook-ledger.tsx");
  const PRIMITIVES = read("src/components/business/ledger-table.tsx");
  const PAGE = read("src/app/(business)/business/orderbuch/verkauf/page.tsx");
  const components = CSS.slice(CSS.indexOf("@layer components {"));

  /** A `"a b c"` constant in the ledger → one entry per track. */
  const constTracks = (name: string): string[] => {
    const m = new RegExp(`const ${name} =([^;]*);`).exec(LEDGER);
    if (!m) return [];
    const joined = [...m[1].matchAll(/"([^"]*)"/g)].map((q) => q[1]).join("");
    return joined.replace(/\s+/g, " ").trim().split(/ (?![^(]*\))/).filter(Boolean);
  };
  /** The narrowest a track can be, in rem. `minmax(a,b)` is `a`. */
  const minRem = (track: string): number => {
    const mm = /^minmax\(\s*([\d.]+)rem/.exec(track);
    if (mm) return Number(mm[1]);
    const fixed = /^([\d.]+)rem$/.exec(track);
    return fixed ? Number(fixed[1]) : 0;
  };
  /** The <span> cells a JSX block opens. These cells never nest. */
  /**
   * One grid cell per DIRECT child, and a cell is not always a `<span>`.
   *
   * Two things this has had to learn. Verkauf\'s indicator column is a
   * `<SaleIndicator/>`, so counting only spans made a seven-cell row look
   * like six. And a cell may contain a span of its own — the held-for-
   * reconciliation note lives inside the action cell — so counting every
   * span made the same row look like eight. Depth is the only honest answer.
   */
  const cells = (block: string): number => {
    let depth = 0;
    let count = 0;
    for (const m of block.matchAll(/<(\/?)(span|SaleIndicator)\b[^>]*?(\/?)>/g)) {
      const [, closing, , selfClosing] = m;
      if (closing) { depth -= 1; continue; }
      if (depth === 0) count += 1;
      if (!selfClosing) depth += 1;
    }
    return count;
  };
  /** The children of one JSX element, by its opening tag. */
  const inside = (source: string, open: string, close: string): string => {
    const i = source.indexOf(open);
    return i < 0 ? "" : source.slice(i, source.indexOf(close, i));
  };

  it("Verkauf and Einkauf render through the same ledger primitives", () => {
    /*
     * THE POINT OF THE REFACTOR. Neither ledger writes a table any more; both
     * hand cells to `ledger-table.tsx`, which puts them on `.ob-row` and
     * `.ob-item`. There is one answer to "how does a row get its columns".
     */
    for (const primitive of ["LedgerTable", "LedgerHead", "LedgerRow", "LedgerItemHead", "LedgerItemRow"]) {
      expect(LEDGER, primitive).toContain(`<${primitive}`);
      expect(EINKAUF, primitive).toContain(`<${primitive}`);
    }
    // And neither writes a row class of its own.
    expect(LEDGER).not.toMatch(/className="ob-(row|item)/);
    expect(EINKAUF).not.toMatch(/className="ob-(row|item)/);
    expect(PRIMITIVES).toContain('className="ob-row relative');
  });

  it("no second Verkauf layout system survives anywhere", () => {
    /*
     * `.ob-sale`, `.ob-sale-head`, `.ob-sale-table`, `.ob-ledger-sale` and
     * `--sale-columns` were a parallel table that mirrored `.ob-row` and still
     * rendered differently in the owner's browser. Nothing may recreate one.
     */
    for (const dead of [".ob-sale", ".ob-sale-item", ".ob-sale-head",
                        ".ob-sale-table", ".ob-ledger-sale", "--sale-columns",
                        "--sale-item-columns"]) {
      // A rule, not a word in a comment explaining why it is gone.
      expect(components.replace(/\/\*[\s\S]*?\*\//g, ""), dead).not.toContain(dead);
    }
    const noComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(noComments(LEDGER)).not.toMatch(/ob-sale/);
  });

  it("the collapsed sale has exactly eleven cells, in header and in row alike", () => {
    /*
     * If the markup and the track list disagree the extra cells wrap onto a
     * second line — the failure the owner photographed twice.
     */
    // Eleven since 0072: `Lager` joined the row, between Auszahlung and
    // Details, because a sale now has a stock state worth a word.
    const columns = constTracks("SALE_COLUMNS");
    expect(columns).toHaveLength(11);
    expect(cells(inside(LEDGER, "<LedgerHead>", "</LedgerHead>"))).toBe(11);
    // The row's last cell wraps the Details button, so it is a cell like the
    // others and the counts still have to agree.
    expect(cells(inside(LEDGER, "<LedgerRow ", "</LedgerRow>"))).toBe(11);
  });

  it("Intern and Extern are one table, with no scope-dependent cell left", () => {
    /*
     * The financial row is the same for both: what used to differ — the
     * order number, the channel — moved into the Details overlay, so the
     * ledger no longer branches on scope at all.
     */
    expect(LEDGER).not.toContain('scope === "intern"');
    expect(LEDGER).not.toContain("SaleScope");
    expect((LEDGER.match(/<LedgerHead>/g) ?? [])).toHaveLength(1);
    expect((LEDGER.match(/<LedgerRow /g) ?? [])).toHaveLength(1);
  });

  it("the expanded item table has one cell per item track, on both row kinds", () => {
    /*
     * SEVEN: the six an expanded purchase has, with a narrow status dot in
     * front — `● · # · Serie · Figur · Marktwert · Status · Aktion`.
     *
     * It was four for a while. `#` and `Serie` lived in the figure cell's
     * `title`, which a phone cannot open, and `Figur` was `minmax(9rem, 1fr)`
     * inside a 71rem ledger — so it took every bit of slack and pushed status
     * and action out of view. What was left on screen was a row of blanks
     * with a button at the end.
     *
     * `Bestand` and `Retoure` stay merged into one status; that part of 0075
     * was right and is unchanged.
     */
    expect(cells(inside(LEDGER, "<LedgerItemHead>", "</LedgerItemHead>"))).toBe(7);
    // Two kinds of item row — an order line and a sale item — and both must
    // match, or an internal sale's columns slide under an external one's.
    const rows = [...LEDGER.matchAll(/<LedgerItemRow key=/g)].map((m) =>
      LEDGER.slice(m.index, LEDGER.indexOf("</LedgerItemRow>", m.index)));
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(cells(row)).toBe(7);
  });

  /**
   * ONE list for both sale screens, and it is not written twice.
   *
   * Verkauf legitimately has a column Einkauf does not, so it overrides —
   * that is what `--ob-item-columns` exists for. What must not come back is
   * the ledger and the detail screen each inventing their own, which is how
   * the four-column variant and the six-column one ended up side by side.
   */
  it("both sale screens take their seven tracks from one constant", () => {
    const detail = read("src/components/business/sale-items.tsx");
    const indicator = read("src/components/business/sale-indicator.tsx");

    const tracks = /export const SALE_ITEM_COLUMNS =\s*\n?\s*"([^"]*)"/.exec(indicator);
    expect(tracks, "the list is declared once, next to the indicator").not.toBeNull();
    expect(tracks![1].trim().split(/ (?![^(]*\))/)).toHaveLength(7);
    // Narrow enough to be a signal and not a word.
    expect(tracks![1].trim().split(" ")[0]).toBe("1.25rem");

    for (const [name, source] of [["Verkaufsbuch", LEDGER],
                                  ["Verkauf-Detail", detail]] as const) {
      expect(source, name).toContain("itemColumns={SALE_ITEM_COLUMNS}");
      expect(source, name).toContain('from "./sale-indicator"');
      // Neither screen declares a list of its own.
      expect(source, name).not.toMatch(/const (SALE_)?ITEM_COLUMNS\s*=/);
    }
    // And Einkauf overrides nothing, so its six tracks are untouched.
    expect(EINKAUF).not.toContain("itemColumns=");
  });

  it("Einkauf keeps six item cells, so the shared rule still fits it", () => {
    const head = inside(EINKAUF, "<LedgerItemHead>", "</LedgerItemHead>");
    expect(cells(head)).toBe(6);
    expect(cells(inside(EINKAUF, "<LedgerItemRow>", "</LedgerItemRow>"))).toBe(6);
    expect(cells(inside(EINKAUF, "<LedgerHead>", "</LedgerHead>"))).toBe(7);
    expect(cells(inside(EINKAUF, "<LedgerRow ", "</LedgerRow>"))).toBe(7);
  });

  it("the column lists travel in the HTML, not in a stylesheet rule", () => {
    /*
     * The one Verkauf-specific thing left is a value, and it is delivered as
     * an inline custom property with the markup. There is no Verkauf CSS rule
     * that can arrive late, go stale, or be scanned away.
     */
    expect(PRIMITIVES).toContain('"--ob-columns": columns');
    expect(PRIMITIVES).toContain('"--ob-item-columns": itemColumns');
    expect(LEDGER).toContain("columns={SALE_COLUMNS}");
    expect(LEDGER).toContain("itemColumns={SALE_ITEM_COLUMNS}");
    // Einkauf passes no column list and renders from the rule's own
    // fallback — but it does pass a width, because a ledger without a floor
    // is a ledger whose columns can be crushed.
    expect(EINKAUF).toContain("<LedgerTable minWidth={PURCHASE_MIN_WIDTH}>");
    expect(EINKAUF).not.toContain("columns={");
    expect(components).toMatch(/grid-template-columns: var\(--ob-columns,/);
    expect(components).toMatch(/grid-template-columns: var\(--ob-item-columns,/);
  });

  it("the desktop table cannot be crushed — it scrolls sideways instead", () => {
    /*
     * `min-width` is not a guess: it must cover every track at its narrowest,
     * plus the gaps between them, plus the row's own padding.
     */
    const declared = /const SALE_MIN_WIDTH = "([\d.]+)rem"/.exec(LEDGER);
    expect(declared).not.toBeNull();
    const tracks = constTracks("SALE_COLUMNS");
    const needed = tracks.reduce((sum, t) => sum + minRem(t), 0)
      + 0.75 * (tracks.length - 1) + 0.75 * 2;
    expect(needed).toBeGreaterThan(0);
    expect(Number(declared![1])).toBeGreaterThanOrEqual(needed);
    // Applied at EVERY width now, and it is the ledger that scrolls.
    expect(components.slice(0, components.indexOf("@media (min-width: 48rem)")))
      .toMatch(/\.ob-min \{ min-width: var\(--ob-min-width, 0\); \}/);
    expect(components).toContain(".ob-scroll");
    expect(PRIMITIVES).toContain('<div className="ob-min">');
  });

  it("mobile gets the same ten columns Einkauf's seven are treated to", () => {
    /*
     * Both ledgers used to collapse to `1fr auto` below 48rem: two lines a
     * row, no header, eight values crushed onto the second. Ten columns are
     * not readable that way and neither were seven.
     *
     * So the property is read at every width and the table scrolls sideways
     * under its floor. Whatever Verkauf passes reaches a phone intact —
     * which is the point, not a leak.
     */
    const mobile = components.slice(0, components.indexOf("@media (min-width: 48rem)"))
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(/grid-template-columns:\s*1fr auto;/.test(mobile)).toBe(false);
    expect(mobile).toContain("--ob-columns");
    expect(mobile).toContain("--ob-item-columns");
    // Still no width-conditional column list, in either direction.
    expect(components).not.toMatch(/@media[^{]*max-width[^{]*\{[^}]*ob-(row|item)/);
    expect(components.slice(components.indexOf("@media (min-width: 48rem)")))
      .not.toContain("grid-template-columns");
  });

  it("money cells never wrap", () => {
    expect(components).toMatch(/\.ob-money \{ white-space: nowrap; \}/);
    const row = inside(LEDGER, "<LedgerRow ", "</LedgerRow>");
    // Summe, Versand, Rabatt and Refund each carry it directly.
    expect((row.match(/ob-money/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(LEDGER).toMatch(/function Payout[\s\S]*?ob-money/);
  });

  it("one payout column in the ledger, and one line in the overlay", () => {
    const head = inside(LEDGER, "<LedgerHead>", "</LedgerHead>");
    expect(head).toContain("copy.columns.payout");
    expect(head).not.toContain("copy.columns.expected");
    expect(head).not.toContain("copy.columns.difference");
    /*
     * Since ADR-0095 the overlay shows the SAME single figure, not a split
     * into Erwartet / Gemeldet / Differenz — there is only one payout now.
     */
    const DETAILS = read("src/components/business/sale-details.tsx");
    expect(DETAILS).toContain("copy.summary.expected");
    for (const gone of ["copy.reported", "copy.difference", "copy.payoutOpen"]) {
      expect(DETAILS, gone).not.toContain(gone);
    }
  });

  it("expanded content is a sibling of the row, so it spans the full width", () => {
    // A child of the row would be an eleventh grid item in the chevron column.
    const li = LEDGER.slice(LEDGER.indexOf("<li key={sale.id}>"));
    expect(li.indexOf("<LedgerExpansion")).toBeGreaterThan(li.indexOf("</LedgerRow>"));
    expect(PRIMITIVES).toMatch(/function LedgerExpansion/);
  });

  it("the grid is never on a <button>", () => {
    expect(PRIMITIVES).not.toMatch(/<button[^>]*className="ob-/);
    expect(PRIMITIVES).toContain('className="absolute inset-0 z-10 h-full w-full');
  });

  it("item labels are German copy, not strings baked into the JSX", () => {
    // ADR-0019: UI text lives in `de.ts`.
    const head = inside(LEDGER, "<LedgerItemHead>", "</LedgerItemHead>");
    for (const word of ["Serie", "Artikel", "Marktwert", "Status", "Aktion"]) {
      expect(head, word).not.toContain(`>${word}<`);
    }
    expect(head).toContain("copy.itemColumns.figure");
    expect(head).toContain("copy.itemColumns.status");
  });

  it("never mutates optimistically", () => {
    expect(LEDGER).not.toContain("useOptimistic");
    expect(LEDGER).toContain("if (!result.ok)");
  });

  it("and every write goes through a seller-gated action", () => {
    for (const forbidden of ["from(\"sales\")", "SERVICE_ROLE", "createServiceClient", ".insert("]) {
      expect(LEDGER, forbidden).not.toContain(forbidden);
      expect(PAGE, forbidden).not.toContain(forbidden);
    }
  });

  it("the Einkauf tab now links to Verkauf instead of saying `später`", () => {
    /*
     * Since 0063 both halves render the SAME header component, so the link
     * lives there rather than being written out twice. That is the point of
     * the component: one answer to "what does the Orderbuch's top row look
     * like", not two that drift.
     */
    const einkauf = read("src/app/(business)/business/orderbuch/page.tsx");
    const nav = read("src/components/business/orderbook-nav.tsx");
    expect(einkauf).toContain('<OrderbookNav active="purchase"');
    expect(nav).toContain('href="/business/orderbuch/verkauf"');
    expect(einkauf).not.toContain("copy.saleSoon");
  });
});

describe("the Excel financial row", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const LEDGER = read("src/components/business/sales-ledger.tsx");
  const DETAILS = read("src/components/business/sale-details.tsx");

  /* One eBay order as the workbook records it, in the normalized model. */
  const FEES: FeeRow[] = [
    { id: 1, kind: "payment",        label: null,      amount: 2.34, settled_by: "channel" },
    { id: 2, kind: "marketplace",    label: null,      amount: 0.43, settled_by: "channel" },
    { id: 3, kind: "other",          label: "Werbung", amount: 0.20, settled_by: "channel" },
    { id: 4, kind: "shipping_label", label: null,      amount: 5.19, settled_by: "channel" },
    { id: 5, kind: "shipping_label", label: null,      amount: 5.79, settled_by: "external" },
  ];

  it("Fees is every cost that is not a shipping label", () => {
    // X `Fee Trans` + AA `Fee eBay` + any custom charge. Never Y or Z.
    expect(feesTotal(FEES)).toBeCloseTo(2.97, 10);
    expect(feesTotal(FEES.filter((f) => f.kind === "shipping_label"))).toBe(0);
  });

  it("Label is every shipping label, whoever settled it", () => {
    /*
     * `lbl eBay` (Y) and `lbl ext` (Z) are both label cost. Settlement decides
     * whether the channel withheld it, which is a PAYOUT rule — the owner's
     * `Label` column is what the labels cost.
     */
    expect(labelTotal(FEES)).toBeCloseTo(10.98, 10);
    expect(labelTotal(FEES.filter((f) => f.settled_by === "channel"))).toBeCloseTo(5.19, 10);
    expect(labelTotal(FEES.filter((f) => f.settled_by === "external"))).toBeCloseTo(5.79, 10);
  });

  it("and the two never double-count a label", () => {
    const every = FEES.reduce((sum, f) => sum + f.amount, 0);
    expect(feesTotal(FEES) + labelTotal(FEES)).toBeCloseTo(every, 10);
  });

  it("settlement still changes the payout, exactly as the workbook computes it", () => {
    /*
     * `U + V − W − AD − (X + AA + Y) + AB`: the externally paid label Z is
     * absent from it. So moving a label from `channel` to `external` raises
     * the expected payout by its amount while `Label` on screen is unchanged.
     */
    const m = { U: 34.99, V: 4.99, W: 0, X: 2.34, AA: 0.43, Y: 5.19, Z: 5.79, AB: 0, AD: 0 };
    const { fees, refunds, adjustments } = moneyToRows(m);
    const asIs = plannedPayout(m.U, m.V, m.W, fees, refunds, adjustments);
    expect(asIs).toBeCloseTo(workbookExpectedPayout(m), 10);

    const allExternal = fees.map((f) =>
      f.kind === "shipping_label" ? { ...f, settled_by: "external" } : f);
    expect(plannedPayout(m.U, m.V, m.W, allExternal, refunds, adjustments))
      .toBeCloseTo(asIs + m.Y, 10);
    // Display total is untouched by that move.
    expect(labelTotal(allExternal as FeeRow[])).toBeCloseTo(labelTotal(fees as FeeRow[]), 10);
  });

  it("refunds and adjustments aggregate, and adjustments keep their sign", () => {
    const refunds = [
      { id: 1, amount: 3, occurred_at: "2026-09-12", reason: "versandkorrektur" },
      { id: 2, amount: 5, occurred_at: "2026-09-15", reason: "retoure" },
    ];
    expect(refundsTotal(refunds)).toBe(8);
    expect(adjustmentsTotal([
      { id: 1, amount: 1.38, reason: "gebuehrengutschrift", occurred_at: null },
      { id: 2, amount: -0.38, reason: null, occurred_at: null },
    ])).toBeCloseTo(1, 10);
    expect(refundsTotal([])).toBe(0);
  });

  it("Auszahlung is the computed figure, with nothing to prefer it over", () => {
    // One cell, one number, no `offen` state (ADR-0095).
    expect(LEDGER).toContain("formatPrice(sale.expectedPayout)");
    expect(LEDGER).not.toContain("reportedPayout");
    expect(LEDGER).not.toContain("payoutCell");
    // A sale with no computable payout still reads as a dash, never 0,00 €.
    expect(LEDGER).toContain("sale.expectedPayout === null");
  });

  it("the ledger row shows the workbook's own ten headings", () => {
    const head = LEDGER.slice(LEDGER.indexOf("<LedgerHead>"), LEDGER.indexOf("</LedgerHead>"));
    for (const key of ["date", "country", "sum", "shipping", "discount", "fees",
                       "label", "refund", "payout", "details"]) {
      expect(head, key).toContain(`copy.columns.${key}`);
    }
    // `Order 2026!T4` is literally `EU`, and it holds a country code.
    expect(de.business.sales.columns.country).toBe("EU");
    expect(de.business.sales.columns.sum).toBe("Summe");
    expect(de.business.sales.columns.shipping).toBe("Versand");
    expect(de.business.sales.columns.discount).toBe("Rabatt");
    expect(de.business.sales.columns.refund).toBe("Refund");
    expect(de.business.sales.columns.payout).toBe("Auszahlung");
  });

  it("channel and shipping state left the ledger row for the overlay", () => {
    const row = LEDGER.slice(LEDGER.indexOf("<LedgerRow "), LEDGER.indexOf("</LedgerRow>"));
    expect(row).not.toContain("CHANNEL_LABELS");
    expect(row).not.toContain("copy.shipped");
    expect(DETAILS).toContain("CHANNEL_LABELS");
    expect(DETAILS).toContain("copy.shipped");
  });

  it("Details is a button of its own and does not toggle the item list", () => {
    /*
     * The row carries a transparent overlay button. A Details control sitting
     * under it would open the breakdown AND collapse the items; above it and
     * stopping propagation, it does only its own job.
     */
    const row = LEDGER.slice(LEDGER.indexOf("<LedgerRow "), LEDGER.indexOf("</LedgerRow>"));
    expect(row).toMatch(/onClick=\{\(event\) => \{ event\.stopPropagation\(\); onDetails\(sale\.id\); \}\}/);
    /*
     * AND IT HAS TO OUTRANK THE OVERLAY, NOT MERELY CARRY A Z-INDEX.
     *
     * This test used to assert `relative z-10`, and it kept passing when
     * the overlay was given `z-10` too — at equal z-index the later element
     * wins, so the overlay swallowed the click and `Details` expanded the
     * item list instead of opening the dialog. The number alone proves
     * nothing; the comparison does.
     */
    const primitives = read("src/components/business/ledger-table.tsx");
    const overlay = /absolute inset-0 z-(\d+)/.exec(primitives);
    const details = /relative z-(\d+) text-center/.exec(row);
    expect(overlay, "overlay z-index").not.toBeNull();
    expect(details, "details z-index").not.toBeNull();
    expect(Number(details![1]), "Details must sit above the row overlay")
      .toBeGreaterThan(Number(overlay![1]));
    // Two separate pieces of state: one for items, one for the dialog.
    expect(LEDGER).toContain("const [showing, setShowing]");
    expect(LEDGER).toMatch(/const onDetails = \(id: number\) => \{ setShowing\(id\); load\(id\); \};/);
    // …and the chevron still toggles the items.
    expect(LEDGER).toMatch(/onToggle=\{\(\) => toggle\(sale\.id\)\}/);
  });

  it("the items stay under the sale, not inside the dialog", () => {
    const expansion = LEDGER.slice(LEDGER.indexOf("<LedgerExpansion"));
    expect(expansion).toContain("<SaleDetail");
    expect(DETAILS).not.toContain("LedgerItemRow");
    expect(DETAILS).not.toContain("bookSaleItem");
  });

  it("the expansion no longer carries the financial breakdown", () => {
    // It moved wholesale into the overlay; two copies would be two truths.
    const detail = LEDGER.slice(LEDGER.indexOf("function SaleDetail"));
    expect(detail).not.toContain("copy.expected");
    expect(detail).not.toContain("setSalePayout");
    expect(detail).not.toContain("detail.expected_payout");
    expect(LEDGER).not.toContain("setSalePayout");
  });

  it("the overlay shows every fee, every label and every refund", () => {
    for (const marker of ["modal.charges", "modal.labels", "modal.refunds",
                          "modal.adjustments", "modal.payout"]) {
      expect(DETAILS, marker).toContain(marker);
    }
    // Lists, not a single total: a sale may carry several of each.
    expect(DETAILS).toMatch(/charges\.map\(/);
    expect(DETAILS).toMatch(/labels\.map\(/);
    expect(DETAILS).toMatch(/refunds\.map\(/);
    expect(DETAILS).toMatch(/adjustments\.map\(/);
    expect(groupFees(FEES).charges).toHaveLength(3);
    expect(groupFees(FEES).labels).toHaveLength(2);
  });

  it("a fee keeps the owner's own label when it has one", () => {
    expect(groupFees(FEES).charges[2].label).toBe("Werbung");
    expect(DETAILS).toMatch(/const custom = fee\.label\?\.trim\(\);/);
    expect(de.business.sales.detailsModal.feeKinds.payment).toBe("Transaktionsgebühr");
    expect(de.business.sales.detailsModal.feeKinds.marketplace).toBe("Marktplatzgebühr");
  });

  it("settlement reads as words, never as an enum", () => {
    expect(de.business.sales.detailsModal.settledChannel).toBe("Über Kanal");
    expect(de.business.sales.detailsModal.settledExternal).toBe("Extern bezahlt");
    expect(DETAILS).toMatch(/settledBy === "external" \? modal\.settledExternal : modal\.settledChannel/);
    // The raw values never reach the screen.
    expect(DETAILS).not.toMatch(/>\{?\s*"?channel"?\s*\}?</);
  });

  it("THERE IS NO REPORTED PAYOUT ANY MORE (ADR-0095)", () => {
    for (const gone of ["reportedPayout", "setSalePayout", "payoutRef", "setReported"]) {
      expect(DETAILS, gone).not.toContain(gone);
    }
    expect((de.business.sales as Record<string, unknown>).payoutOpen).toBeUndefined();
    // The three columns stay in the database; nothing deletes history.
    expect(allMigrations).toContain("reported_payout_amount");
  });

  it("the overlay never recomputes the payout", () => {
    // It prints `sale_expected_payout()`'s answer; it does not derive one.
    expect(DETAILS).toContain("loaded.expected_payout");
    expect(DETAILS).not.toContain("plannedPayout");
    expect(DETAILS).not.toMatch(/itemsSubtotal \+/);
  });

  it("an internal sale is read-only where commerce owns the fact", () => {
    // No payout editor on a SkyIsles order; commerce owns that money.
    expect(DETAILS).toMatch(/const internal = sale\.orderId !== null;/);
    expect(DETAILS).toMatch(/\{internal \? null : \(/);
    expect(DETAILS).toContain("copy.commerceOwned");
  });

  it("the overlay reuses the one modal primitive", () => {
    // Escape, focus trap, scroll lock and the portal are solved already.
    expect(DETAILS).toContain('from "@/components/ui/modal"');
    expect(DETAILS).toContain("<Modal open={open}");
    expect(DETAILS).toContain("labelledBy={headingId}");
    const MODAL = read("src/components/ui/modal.tsx");
    expect(MODAL).toContain('aria-modal="true"');
    expect(MODAL).toContain('event.key === "Escape"');
  });
});

describe("the historical apply gate", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const TOOL = read("tools/import-sales.mts");
  const SQL = migrationSource("0059_orderbook_sales.sql");

  it("preview is still the default and writes nothing", () => {
    expect(TOOL).toMatch(/if \(!flag\("apply"\)\) \{[\s\S]*?Preview only\. Nothing was written/);
  });

  it("--apply alone is refused; the environment must be named out loud", () => {
    /*
     * `--apply` is one word away from `--preview` in a shell history, and this
     * one writes historical sales. The second flag cannot be reached by editing
     * the end of the previous command — and it is the flag of the environment
     * actually chosen, so a staging confirmation never authorises production.
     */
    expect(TOOL).toContain('? "confirm-production" : "confirm-staging"');
    expect(TOOL).toMatch(/if \(!flag\(confirmation\)\) \{/);
    expect(TOOL).toContain("Apply requires --${confirmation} as well as --apply");
    // And the refusal exits non-zero rather than falling through to a write.
    const guard = TOOL.slice(TOOL.indexOf("if (!flag(confirmation))"),
                             TOOL.indexOf("await apply(client"));
    expect(guard).toContain("process.exit(1)");
    expect(TOOL.indexOf("flag(confirmation)")).toBeLessThan(TOOL.indexOf("await apply(client"));
  });

  it("the target is proven to be the chosen environment before anything is written", () => {
    // Die Umgebung wird gewählt, nie geerbt — und danach durch denselben
    // Identitätsvergleich bestätigt, den es vorher schon gab.
    expect(TOOL).toMatch(/const choice = chooseEnvironment\(process\.argv\.slice\(2\)\);/);
    expect(TOOL).toMatch(/requireProduction\("orderbook:sales-import"\)/);
    expect(TOOL).toMatch(/requireStaging\("orderbook:sales-import"\)/);
    // Reihenfolge innerhalb von main(), nicht in der Importzeile.
    const main = TOOL.slice(TOOL.indexOf("async function main("));
    expect(main.indexOf("chooseEnvironment(")).toBeLessThan(main.indexOf("requireStaging("));
    expect(main.indexOf("requireStaging(")).toBeLessThan(main.indexOf("await apply(client"));
  });

  it("a preview that fails any invariant refuses the whole run", () => {
    // Read from the plan being applied, not from a report printed earlier.
    const fn = TOOL.slice(TOOL.indexOf("function applyInvariants"));
    for (const [what, wanted] of [
      ["Quellgruppen", "297"], ["echte Verkäufe", "296"],
      ["eigenständige Korrekturen", "1"], ["unaufgelöste Positionen", "0"],
      ["mehrdeutige Positionen", "0"], ["ungültige Positionen", "0"],
      ["Auszahlungsabweichungen", "0"], ["Fingerabdruck-Kollisionen", "0"],
      ["blockierte Gruppen", "0"],
    ] as const) {
      expect(fn, what).toContain(`expect("${what}"`);
      expect(fn.slice(fn.indexOf(`expect("${what}"`)), what).toContain(wanted);
    }
    const applyFn = TOOL.slice(TOOL.indexOf("async function apply("));
    expect(applyFn).toMatch(/if \(failures\.length > 0\) \{[\s\S]*?process\.exit\(1\)/);
    expect(applyFn).toContain("Nichts wurde geschrieben");
  });

  it("each sale is one transaction, through the seller-gated import function", () => {
    expect(TOOL).toContain('client.rpc("seller_import_sale_group"');
    // Not a pile of client-side inserts that can leave half a sale behind.
    expect(TOOL).not.toMatch(/\.from\("sales"\)|\.from\("sale_items"\)|\.insert\(/);
    const fn = code(latestFunction("seller_import_sale_group").body);
    expect(fn).toContain("can_operate_active_seller()");
    expect(fn).toContain("insert into public.sales");
    expect(fn).toContain("insert into public.sale_items");
    expect(fn).toContain("insert into public.sale_fees");
    expect(fn).toContain("insert into public.sale_refunds");
    expect(fn).toContain("insert into public.settlement_adjustments");
  });

  it("history can never move stock", () => {
    const fn = code(latestFunction("seller_import_sale_group").body);
    for (const forbidden of ["record_inventory_movement", "apply_inventory_movement",
                             "shop_inventory", "movement_id", "return_movement_id"]) {
      expect(fn, forbidden).not.toContain(forbidden);
    }
    // The payload the tool builds carries no movement field either.
    const payload = TOOL.slice(TOOL.indexOf("p_items: plan.items.map"));
    expect(payload.slice(0, payload.indexOf("})"))).not.toContain("movement");
    // And the table refuses one on a historical row regardless.
    expect(SQL).toContain("sale_items_no_historical_movement_trg");
  });

  it("a rerun cannot duplicate: the database owns the uniqueness", () => {
    expect(SQL).toMatch(/create unique index if not exists sales_import_fingerprint_uniq\s*\n\s*on public\.sales \(import_fingerprint\) where import_fingerprint is not null;/);
    // The importer also skips what it already knows about.
    expect(TOOL).toContain('p.status === "eligible"');
    expect(TOOL).toContain('client.rpc("seller_sale_fingerprints")');
  });

  it("a failure stops the run and names the group", () => {
    const loop = TOOL.slice(TOOL.indexOf("for (const plan of eligible)"));
    expect(loop).toContain("ABBRUCH bei Kopfzeile");
    expect(loop).toContain("plan.fingerprint.slice(0, 12)");
    expect(loop).toContain("process.exit(1)");
    expect(loop).toContain("Vor einem erneuten Lauf den Bestand prüfen");
  });

  it("history keeps the workbook's Buy-In factor, not today's", () => {
    /*
     * `Markt G` (Q) and `Buy In` (R) imply one constant factor across the
     * book. `orderbook_global_factor()` is a different number and belongs to
     * new sales; stamping it on 2026 would restate what those sales cost.
     */
    expect(TOOL).toContain("export function workbookBuyInFactor");
    expect(TOOL).toMatch(/p_factor: Number\(factor\.toFixed\(6\)\)/);
    // The CODE never calls it — the comment beside `p_factor` names it only
    // to say which factor is deliberately not used.
    const importFn = TOOL.slice(TOOL.indexOf("async function importGroup"),
                                TOOL.indexOf("async function apply("));
    expect(importFn.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""))
      .not.toContain("orderbook_global_factor");
  });

  it("reported payout is never invented for a historical sale", () => {
    const fn = code(latestFunction("seller_import_sale_group").body);
    expect(fn).not.toContain("reported_payout");
    expect(TOOL).not.toContain("p_reported");
  });

  it("the standalone correction is never written as a sale", () => {
    /*
     * It has no sale to belong to; a fake one would be a fabricated order.
     * Only `eligible` groups reach the sale importer, and the correction is
     * `standalone_correction` — it goes to 0061's adjustment path instead.
     */
    expect(TOOL).toMatch(/const eligible = plans\.filter\(\(p\) => p\.status === "eligible"\)/);
    const correctionPath = TOOL.slice(TOOL.indexOf('=== EIGENSTÄNDIGE KORREKTUR ==='));
    expect(correctionPath).toContain("seller_import_settlement_adjustment");
    expect(correctionPath).not.toContain("seller_import_sale_group");
    expect(SQL).toContain("`sale_id` NULL is a channel-level correction that belongs to no sale");
  });
});

describe("0061 — the standalone historical adjustment", () => {
  const SQL = migrationSource("0061_orderbook_standalone_adjustments.sql");
  const IMPORT = code(latestFunction("seller_import_settlement_adjustment").body);
  const READ = code(latestFunction("seller_historical_adjustments").body);

  it("is additive — it rewrites nothing that is already applied", () => {
    /*
     * 0059 and 0060 are on Staging and 292 sales sit on top of them. A
     * migration that edited either would be rewriting history that exists.
     */
    expect(code(SQL)).not.toMatch(/drop table|drop function|drop column|drop constraint/i);
    expect(code(SQL)).not.toContain("create table");
    expect(code(SQL)).not.toContain("create or replace function public.seller_add_settlement_adjustment");
    expect(code(SQL)).not.toContain("create or replace function public.seller_import_sale_group");
    // It adds one column to one table and nothing else.
    const alters = code(SQL).match(/alter table public\.\w+/g) ?? [];
    expect(new Set(alters)).toEqual(new Set(["alter table public.settlement_adjustments"]));
  });

  it("touches nothing outside settlement_adjustments", () => {
    for (const forbidden of ["public.sales", "public.sale_items", "public.sale_fees",
                             "public.sale_refunds", "public.shop_inventory",
                             "public.inventory_movements", "public.orders",
                             "public.purchases", "record_inventory_movement"]) {
      expect(code(SQL), forbidden).not.toContain(forbidden);
    }
  });

  it("gives a historical adjustment a database-enforced identity", () => {
    expect(SQL).toContain("add column if not exists import_fingerprint text");
    // Partial: operational rows carry none, and many NULLs are not a clash.
    expect(SQL).toMatch(/create unique index if not exists settlement_adjustments_import_fingerprint_uniq\s*\n\s*on public\.settlement_adjustments \(import_fingerprint\)\s*\n\s*where import_fingerprint is not null;/);
    // The same 64-hex shape the sales fingerprint uses.
    expect(SQL).toContain("check (import_fingerprint is null or import_fingerprint ~ '^[0-9a-f]{64}$')");
  });

  it("a fingerprinted row cannot claim to be operational", () => {
    expect(SQL).toContain("settlement_adjustments_fingerprint_is_historical");
    expect(SQL).toContain("check (import_fingerprint is null or source = 'excel_order_2026')");
  });

  it("the caller cannot choose the source, and cannot attach it to a sale", () => {
    /*
     * `source` and `sale_id` are not parameters. A standalone correction that
     * acquired a sale_id would start reducing that sale's expected payout —
     * the exact mistake of attaching `Korrektur >` to its neighbour.
     */
    const signature = SQL.slice(SQL.indexOf("create or replace function public.seller_import_settlement_adjustment"),
                                SQL.indexOf("returns jsonb"));
    expect(signature).not.toContain("p_source");
    expect(signature).not.toContain("p_sale_id");
    expect(IMPORT).toContain("'excel_order_2026'");
    expect(IMPORT).toMatch(/values\s*\n?\s*\(null,/);
  });

  it("is seller-gated like every other Orderbuch import function", () => {
    expect(IMPORT).toContain("can_operate_active_seller()");
    expect(IMPORT).toContain("insufficient_privilege");
    expect(READ).toContain("can_operate_active_seller()");
    expect(SQL).toContain("set search_path = ''");
  });

  it("a retry is a no-op, but changed content is refused", () => {
    // Retrying after a timeout is not a mistake and must not raise…
    expect(IMPORT).toMatch(/return jsonb_build_object\('id', v_existing\.id, 'inserted', false\)/);
    // …but the same identity with different money is a contradiction.
    expect(IMPORT).toContain("is already imported with different content");
    for (const field of ["channel", "amount", "reason", "occurred_at"]) {
      expect(IMPORT, field).toMatch(new RegExp(`v_existing\\.${field} is distinct from`));
    }
    expect(IMPORT).toContain("v_existing.sale_id is not null");
  });

  it("refuses a row with no fingerprint and no explanation", () => {
    expect(IMPORT).toContain("a historical adjustment needs its source fingerprint");
    expect(IMPORT).toContain("a standalone adjustment must say what it is");
    // The table says the same thing, so neither side is the only guard.
    expect(migrationSource("0059_orderbook_sales.sql"))
      .toContain("settlement_adjustments_standalone_identified");
  });

  it("the read path exposes reconciliation columns and only historical rows", () => {
    expect(READ).toContain("a.source = 'excel_order_2026'");
    for (const col of ["id", "sale_id", "channel", "amount", "reason",
                       "occurred_at", "source", "import_fingerprint"]) {
      expect(SQL, col).toMatch(new RegExp(`^\\s+${col} `, "m"));
    }
    expect(READ).not.toContain("note");
  });

  it("no table grant and no policy is added", () => {
    expect(code(SQL)).not.toMatch(/grant .* on table/i);
    expect(code(SQL)).not.toMatch(/create policy/i);
    expect(code(SQL)).not.toMatch(/alter table .* enable row level security/i);
    // Both new functions are revoked from public and anon, then granted only
    // to authenticated — where `can_operate_active_seller()` is the real gate.
    for (const fn of ["seller_import_settlement_adjustment(text, text, numeric, text, text, date, text)",
                      "seller_historical_adjustments()"]) {
      expect(SQL, fn).toContain(`revoke all on function public.${fn}`);
      expect(SQL, fn).toContain(`grant execute on function public.${fn}`);
    }
  });

  it("the importer sends the parser's own signed amount, not a re-reading", () => {
    const TOOL = readFileSync(join(process.cwd(), "tools/import-sales.mts"), "utf8");
    expect(TOOL).toContain('client.rpc("seller_import_settlement_adjustment"');
    // The payout effect the normalized model computed — `Korrektur >` is a
    // 5,19 € label with no sale, so the settlement effect is NEGATIVE.
    expect(TOOL).toMatch(/p_amount: correction\.expectedPayout/);
    expect(TOOL).toContain("p_fingerprint: correction.fingerprint");
  });
});

describe("0062 — maintaining an external sale after it happened", () => {
  const SQL = migrationSource("0062_orderbook_sale_maintenance.sql");
  const DATE_FN = code(latestFunction("seller_set_sale_date").body);
  const UPDATE_FN = code(latestFunction("seller_update_sale").body);
  const PAYOUT_FN = code(latestFunction("seller_set_sale_payout").body);
  const FEE_EDIT = code(latestFunction("seller_update_sale_fee").body);
  const REFUND_ADD = code(latestFunction("seller_add_sale_refund").body);
  const LIST = code(latestFunction("seller_sales").body);

  it("provenance is never touched by an edit", () => {
    /*
     * THE CORE RULE. `source` says where a row came from; it has never meant
     * frozen. No edit function reads or writes it, and none touches the
     * fingerprint — so a corrected historical sale stays a historical sale
     * and the importer still recognises it.
     */
    for (const fn of [DATE_FN, UPDATE_FN, PAYOUT_FN, FEE_EDIT]) {
      expect(fn).not.toContain("import_fingerprint");
      expect(fn).not.toContain("excel_order_2026");
      expect(fn).not.toMatch(/\bsource\s*=/);
    }
  });

  it("the importer keys on the fingerprint, so an edit cannot resurrect a sale", () => {
    // `seller_sale_fingerprints()` selects on source + fingerprint only —
    // nothing an edit changes — so a corrected date is never re-imported.
    const fps = code(latestFunction("seller_sale_fingerprints").body);
    expect(fps).toContain("s.import_fingerprint is not null");
    expect(fps).toContain("s.source = 'excel_order_2026'");
    for (const field of ["sold_at", "destination_country_code", "note", "buyer_ref"]) {
      expect(fps, field).not.toContain(field);
    }
    // And the group importer only ever INSERTs; it has no update path.
    const importer = code(latestFunction("seller_import_sale_group").body);
    expect(importer).not.toMatch(/update public\.sales/);
    expect(importer).not.toMatch(/on conflict/i);
  });

  it("an internal sale keeps its commerce-owned facts", () => {
    expect(DATE_FN).toContain("an internal sale takes its date from the order");
    expect(UPDATE_FN).toContain("these belong to the order, not to the Orderbuch");
    expect(REFUND_ADD).toContain("an order''s refunds belong to commerce");
    // The refusal covers every commerce-owned field, not just the money.
    expect(UPDATE_FN).toMatch(/p_items_subtotal is not null or p_shipping_charged is not null/);
    expect(UPDATE_FN).toMatch(/p_discount_amount is not null or p_clear_date or p_sold_at is not null/);
    expect(UPDATE_FN).toContain("p_country is not null");
  });

  it("a sale date is validated as a date, not as `not 2028`", () => {
    /*
     * A completed external sale cannot have happened tomorrow, and the book
     * starts long after 2000. The rule is about what a sale date can be —
     * there is no special case for the one wrong year in the workbook.
     */
    expect(DATE_FN).toContain("p_sold_at < date '2000-01-01'");
    expect(DATE_FN).toContain("p_sold_at > current_date + 1");
    expect(code(SQL)).not.toContain("2028");
    // NULL stays allowed: an unknown historical date is a fact.
    expect(DATE_FN).not.toMatch(/p_sold_at is null[\s\S]{0,80}raise/);
  });

  it("every correction is recorded, including a deletion", () => {
    expect(SQL).toContain("create table if not exists public.orderbook_audit");
    for (const col of ["entity_type", "entity_id", "action", "field",
                       "old_value", "new_value", "changed_at", "changed_by"]) {
      expect(SQL, col).toMatch(new RegExp(`^\\s+${col} `, "m"));
    }
    // A delete records what the row said before it went.
    const rmFee = code(latestFunction("seller_remove_sale_fee").body);
    const rmRefund = code(latestFunction("seller_remove_sale_refund").body);
    for (const fn of [rmFee, rmRefund]) {
      expect(fn).toMatch(/select \* into v_before/);
      expect(fn).toContain("'delete'");
    }
    // An update that changed nothing is not a correction.
    expect(code(latestFunction("orderbook_log").body))
      .toContain("p_old is not distinct from p_new");
  });

  it("the audit trail is append-only and unreachable from a client", () => {
    expect(code(SQL)).not.toMatch(/update public\.orderbook_audit|delete from public\.orderbook_audit/);
    expect(SQL).toContain("revoke all on table public.orderbook_audit from public, anon, authenticated");
    expect(SQL).toContain("alter table public.orderbook_audit enable row level security");
    // The recorder is internal: granted to nobody.
    expect(SQL).toMatch(/revoke all on function public\.orderbook_log\([^)]*\)\s*\n?\s*from public, anon, authenticated;/);
    expect(SQL).not.toMatch(/grant execute on function public\.orderbook_log/);
  });

  it("a stale edit is detected rather than silently winning", () => {
    expect(SQL).toContain("this sale changed while you were editing it");
    /*
     * `PT409`, not `serialization_failure`: 40001 tells the gateway to retry,
     * and the caller got `upstream request timeout` instead of a sentence.
     * A stale edit is a conflict, not a transient failure.
     */
    expect(SQL).toContain("errcode = 'PT409'");
    // The code, not the comment that explains why it is no longer used.
    expect(code(SQL)).not.toContain("serialization_failure");
    // One token for the whole sale: a fee change moves it too.
    expect(SQL).toContain("create or replace function public.orderbook_touch_sale");
    for (const fn of ["seller_add_sale_fee", "seller_remove_sale_fee",
                      "seller_update_sale_fee", "seller_add_sale_refund",
                      "seller_update_sale_refund", "seller_remove_sale_refund"]) {
      expect(code(latestFunction(fn).body), fn).toContain("orderbook_touch_sale");
    }
    for (const fn of [DATE_FN, UPDATE_FN, PAYOUT_FN, FEE_EDIT]) {
      expect(fn).toContain("orderbook_guard_stale");
    }
    // The list hands the token out.
    expect(LIST).toContain("'updated_at', m.updated_at");
  });

  it("a fee or refund can only be removed once it has been found", () => {
    // 0059 deleted by id without reading the row; both now resolve it first
    // so the audit line and the sale link are real.
    for (const fn of ["seller_remove_sale_fee", "seller_remove_sale_refund"]) {
      const body = code(latestFunction(fn).body);
      expect(body, fn).toMatch(/no_data_found/);
      expect(body, fn).toMatch(/v_before\.sale_id/);
    }
  });

  it("a fee is corrected in place, and a credit is still not a negative fee", () => {
    expect(FEE_EDIT).toContain("a fee is a positive amount; use a settlement adjustment for a credit");
    // NULL leaves a field alone, so one field can be fixed on its own.
    expect(FEE_EDIT).toMatch(/kind = coalesce\(p_kind, kind\)/);
    expect(FEE_EDIT).toMatch(/amount = coalesce\(p_amount, amount\)/);
    expect(FEE_EDIT).toMatch(/settled_by = coalesce\(p_settled_by, settled_by\)/);
    // …and each of those is audited.
    for (const field of ["kind", "amount", "settled_by", "label"]) {
      expect(FEE_EDIT, field).toContain(`'update', '${field}'`);
    }
  });

  it("a refund is money and says nothing about goods", () => {
    for (const forbidden of ["record_inventory_movement", "shop_inventory",
                             "movement_id", "returned_at", "return_movement_id"]) {
      expect(REFUND_ADD, forbidden).not.toContain(forbidden);
      expect(code(latestFunction("seller_update_sale_refund").body), forbidden).not.toContain(forbidden);
    }
    // No financial function in this migration touches stock at all.
    expect(code(SQL)).not.toContain("record_inventory_movement");
    expect(code(SQL)).not.toContain("public.shop_inventory");
  });

  it("restock is still the only path that moves stock, and 0062 did not touch it", () => {
    expect(code(SQL)).not.toContain("seller_restock_sale_item");
    expect(code(SQL)).not.toContain("seller_return_sale_item");
    const restock = code(latestFunction("seller_restock_sale_item").body);
    expect(restock).toContain("record_inventory_movement");
  });

  it("the payout can arrive later, with its own date, and stays independent", () => {
    expect(PAYOUT_FN).toContain("reported_payout_amount = p_amount");
    expect(PAYOUT_FN).toMatch(/coalesce\(p_paid_at::timestamptz, now\(\)\)/);
    // Clearing the amount clears the date: a payout date with no payout would
    // claim money that has not arrived.
    expect(PAYOUT_FN).toMatch(/case when p_amount is null then null/);
    // Expected payout is never written by it.
    expect(PAYOUT_FN).not.toContain("expected_payout");
  });

  it("the ledger gains two disjoint aggregates and no new accounting", () => {
    expect(LIST).toContain("where f.sale_id = s.id and f.kind <> 'shipping_label'), 0) as fees_total");
    expect(LIST).toContain("where f.sale_id = s.id and f.kind = 'shipping_label'), 0) as label_total");
    // Settlement does not appear in either: it decides the payout, not the cost.
    const feesLine = LIST.slice(LIST.indexOf("as fees_total") - 200, LIST.indexOf("as label_total"));
    expect(feesLine).not.toContain("settled_by");
    // And the payout formula itself is untouched by this migration.
    expect(code(SQL)).not.toContain("create or replace function public.sale_expected_payout");
  });

  it("no table grant, no policy, no RLS weakening", () => {
    expect(code(SQL)).not.toMatch(/grant .* on table/i);
    expect(code(SQL)).not.toMatch(/create policy/i);
    expect(code(SQL)).not.toMatch(/alter table public\.(sales|sale_items|sale_fees|sale_refunds|settlement_adjustments)/);
    // Every re-created function is revoked then granted only to authenticated.
    for (const fn of ["seller_set_sale_date(bigint, date, timestamptz)",
                      "seller_set_sale_payout(bigint, numeric, text, date, timestamptz)",
                      "seller_update_sale_fee(bigint, text, numeric, text, text, text, timestamptz)",
                      "seller_sale_audit(bigint)"]) {
      expect(SQL, fn).toContain(`'${fn}'`);
    }
    expect(SQL).toContain("revoke all on function public.%s from public, anon");
    expect(SQL).toContain("grant execute on function public.%s to authenticated");
  });

  it("a changed argument list is dropped first, or it becomes an overload", () => {
    /*
     * `create or replace function` only replaces when the ARGUMENT TYPES match.
     * Re-declaring one with an extra parameter creates a second function of
     * the same name, and every existing call then fails as ambiguous. The
     * repository already guards changed RETURN types; this is the other half.
     */
    const argsOf = (sql: string, name: string): string[] =>
      [...sql.matchAll(new RegExp(
        `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(([\\s\\S]*?)\\)\\s*\\n?\\s*returns`, "gi"))]
        .map((m) => (m[1].match(/\b(bigint|numeric|text|date|boolean|timestamptz|jsonb|integer)\b/g) ?? []).join(","));

    const before = migrationSource("0059_orderbook_sales.sql");
    let checked = 0;
    for (const name of ["seller_set_sale_date", "seller_update_sale", "seller_set_sale_payout",
                        "seller_add_sale_fee", "seller_remove_sale_fee",
                        "seller_add_sale_refund", "seller_remove_sale_refund"]) {
      const old = argsOf(before, name)[0];
      const now = argsOf(SQL, name)[0];
      if (old === undefined || now === undefined) continue;
      checked += 1;
      if (old === now) continue;   // a true replacement needs no drop
      const dropped = new RegExp(`drop\\s+function\\s+if\\s+exists\\s+public\\.${name}\\b`, "i");
      expect(dropped.test(SQL), `${name} changed its arguments without being dropped`).toBe(true);
    }
    expect(checked).toBeGreaterThanOrEqual(7);
    // The three that gained a concurrency token are exactly the dropped ones.
    expect((SQL.match(/drop function if exists/g) ?? [])).toHaveLength(3);
  });

  it("does not mass-edit the history it just imported", () => {
    /*
     * A migration changes capabilities, not facts. Every UPDATE here is a
     * single row inside a function, addressed by id — there is no statement
     * that sweeps the imported history.
     */
    const updates = [...code(SQL).matchAll(/update public\.\w+[\s\S]*?;/g)].map((m) => m[0]);
    expect(updates.length).toBeGreaterThan(0);
    for (const statement of updates) {
      expect(statement, statement.slice(0, 40)).toMatch(/where\s+(s\.)?id = p_\w+/);
    }
    expect(code(SQL)).not.toContain("excel_order_2026");
    // 0062 writes no sale items at all, and its fee/refund inserts are one
    // row per call from parameters — never a set drawn from a query.
    expect(code(SQL)).not.toContain("insert into public.sale_items");
    expect(code(SQL)).not.toContain("insert into public.sales");
    /*
     * The 0061 standalone correction is left exactly alone. 0062 names
     * settlement adjustments only in the audit enum and in the sentence that
     * tells a caller a credit is not a negative fee — it writes none.
     */
    expect(code(SQL)).not.toMatch(/(insert into|update|delete from) public\.settlement_adjustments/);
  });
});

describe("the Details overlay maintains an external sale", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const DETAILS = read("src/components/business/sale-details.tsx");
  const ACTIONS = read("src/lib/orderbook/sales-actions.ts");
  const LEDGER = read("src/components/business/sales-ledger.tsx");

  it("editing is opt-in, and never offered for an internal sale", () => {
    // The breakdown stays readable; inputs appear when the owner says so.
    expect(DETAILS).toContain("const [editing, setEditing]");
    expect(DETAILS).toMatch(/\{internal \? null : \([\s\S]{0,400}modal\.edit/);
    expect(DETAILS).toContain("modal.commerceLocked");
    // The ledger itself grows no always-visible inputs.
    const row = LEDGER.slice(LEDGER.indexOf("<LedgerRow "), LEDGER.indexOf("</LedgerRow>"));
    expect(row).not.toContain("<input");
    expect(row).not.toContain("<select");
  });

  it("every write carries the concurrency token the dialog was opened with", () => {
    // Seit 0091 ist „das Datum" kein eigener Schreibvorgang mehr: der Dialog
    // gibt den Token einmal mit, und zwar an den einen Aufruf.
    expect(DETAILS).toContain("}, sale.updatedAt)");
    for (const fn of ["setSaleDate", "updateSaleMeta", "updateSaleFee",
                      "updateSaleRefund"]) {
      expect(ACTIONS, fn).toMatch(new RegExp(`${fn}[\\s\\S]*?p_expected_updated_at`));
    }
    // And the ledger hands it out.
    expect(read("src/lib/orderbook/sales-queries.ts")).toContain("updatedAt:");
  });

  it("a date is set, corrected or cleared — never guessed", () => {
    expect(DETAILS).toContain('type="date"');
    // Empty means unknown, and goes through the function that can say so.
    expect(DETAILS).toMatch(/draft\.soldAt\.trim\(\) === "" \? null : draft\.soldAt\.trim\(\)/);
    expect(DETAILS).not.toMatch(/new Date\(\)\.toISOString\(\)[\s\S]{0,60}soldAt/);
  });

  it("fees and labels are added and corrected without raw enums on screen", () => {
    expect(DETAILS).toContain("addSaleFee");
    expect(DETAILS).toContain("updateSaleFee");
    expect(DETAILS).toContain("removeSaleFee");
    // The settlement toggle reads as words in both directions.
    expect(DETAILS).toMatch(/fee\.settled_by === "external" \? modal\.settledChannel : modal\.settledExternal/);
    // A label form never asks for a kind it already knows.
    expect(DETAILS).toMatch(/addSaleFee\(sale\.id, "shipping_label"/);
    // Custom label only where the model requires one.
    expect(DETAILS).toMatch(/value\.kind === "other"[\s\S]{0,200}modal\.label/);
  });

  it("a refund is money, and the screen says so", () => {
    expect(DETAILS).toContain("addSaleRefund");
    expect(DETAILS).toContain("removeSaleRefund");
    expect(DETAILS).toContain("copy.refundNotReturn");
    expect(de.business.sales.refundNotReturn).toContain("Geld");
    // Reasons come from the copy map, which mirrors the database constraint.
    expect(DETAILS).toContain("Object.keys(modal.refundReasons)");
    // And nothing here touches stock.
    for (const forbidden of ["restockSaleItem", "returnSaleItem", "bookSaleItem"]) {
      expect(DETAILS, forbidden).not.toContain(forbidden);
    }
  });

  it("the payout is never typed — it is read from the database", () => {
    expect(DETAILS).toContain("loaded.expected_payout");
    expect(DETAILS).not.toMatch(/setExpected|expectedPayout =/);
    // And no input writes it (ADR-0095).
    expect(DETAILS).not.toContain("setSalePayout");
  });

  it("the corrections made to a sale are visible on it", () => {
    expect(DETAILS).toContain("loadSaleAudit");
    expect(DETAILS).toContain("modal.history");
    expect(DETAILS).toMatch(/row\.old_value[\s\S]{0,120}row\.new_value/);
    // Provenance is shown alongside, so a corrected import still reads as one.
    expect(DETAILS).toContain("modal.imported");
    expect(DETAILS).toContain("modal.editedSince");
  });

  it("the ledger shows the ten workbook columns", () => {
    const head = LEDGER.slice(LEDGER.indexOf("<LedgerHead>"), LEDGER.indexOf("</LedgerHead>"));
    for (const key of ["date", "country", "sum", "shipping", "discount",
                       "fees", "label", "refund", "payout", "details"]) {
      expect(head, key).toContain(`copy.columns.${key}`);
    }
    // Fees and Label come from the read model, not from a client-side sum.
    expect(LEDGER).toContain("sale.feesTotal");
    expect(LEDGER).toContain("sale.labelTotal");
    expect(LEDGER).not.toMatch(/feesTotal\(|labelTotal\(/);
  });
});

describe("operational creation workflows", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const SALES_SQL = migrationSource("0059_orderbook_sales.sql");
  const NEW_SALE = read("src/components/business/new-sale.tsx");
  const NEW_PURCHASE = read("src/components/business/new-purchase.tsx");
  const SALE_ITEMS = read("src/components/business/sale-items.tsx");
  const SALE_PAGE = read("src/app/(business)/business/orderbuch/verkauf/page.tsx");
  const EINKAUF_PAGE = read("src/app/(business)/business/orderbuch/page.tsx");
  const CREATE = code(latestFunction("seller_create_sale").body);
  const BOOK = code(latestFunction("seller_book_sale_item").body);
  const REGISTER = code(latestFunction("orders_register_sale").body);

  it("Einkauf offers a new purchase; Extern offers a new sale; Intern does not", () => {
    /*
     * One compact action, contextual (0063). Each page decides WHAT may be
     * created here and hands the header a URL; `null` means the header renders
     * no action at all, which is the Intern case.
     */
    expect(EINKAUF_PAGE).toContain("/business/orderbuch/neu");
    expect(EINKAUF_PAGE).toContain("newLabel={copy.newPurchase}");
    // Extern gets a URL, Intern gets null — in one expression, so the two
    // cannot be changed apart.
    expect(SALE_PAGE).toMatch(/scope === "extern"\s*\n?\s*\?[\s\S]{0,200}verkauf\/neu[\s\S]{0,40}: null;/);
    expect(SALE_PAGE).toContain("newLabel={copy.newSale}");
    // The visible label is short; the accessible one is the whole sentence.
    expect(de.business.orderbook.newCompact).toBe("+ Neu");
    expect(de.business.sales.newSale).toBe("Neuen externen Verkauf anlegen");
    expect(de.business.orderbook.newPurchase).toBe("Neuen Einkauf anlegen");
  });

  it("an internal sale cannot be created by hand, at either level", () => {
    // The form never offers the channel — since 0065 the channel comes from
    // the chosen template, and no template names `skyisles`.
    expect(SALE_TEMPLATES.map((t) => t.channel)).not.toContain("skyisles");
    expect(NEW_SALE).not.toMatch(/value="skyisles"/);
    // …and the database refuses it even if something asked.
    expect(CREATE).toContain("internal sales are created from a paid order, not by hand");
    expect(CREATE).toMatch(/if p_channel = 'skyisles' then/);
  });

  it("a paid order creates exactly one internal sale, and an unpaid one none", () => {
    expect(REGISTER).toMatch(/if new\.payment_status <> 'paid' then\s*\n?\s*return new;/);
    // Already paid before this statement: nothing new happened.
    expect(REGISTER).toMatch(/tg_op = 'UPDATE' and old\.payment_status = 'paid'/);
    expect(REGISTER).toContain("'skyisles'");
    expect(REGISTER).toContain("new.id");
    expect(REGISTER).toContain("'commerce'");
    expect(REGISTER).toContain("orderbook_global_factor()");
    expect(REGISTER).toContain("on conflict (order_id) where order_id is not null do nothing");
    // The database makes a duplicate impossible regardless of the trigger.
    expect(SALES_SQL).toMatch(/create unique index if not exists sales_order_uniq\s*\n\s*on public\.sales \(order_id\) where order_id is not null;/);
    expect(SALES_SQL).toMatch(/after insert or update of payment_status on public\.orders/);
  });

  it("the internal sale is not a second order system", () => {
    // No order lines are copied into sale_items.
    expect(REGISTER).not.toContain("sale_items");
    expect(REGISTER).not.toContain("order_lines");
    // The detail page renders the ORDER's lines read-only instead.
    const page = read("src/app/(business)/business/orderbuch/verkauf/[id]/page.tsx");
    expect(page).toMatch(/internal\s*\n?\s*\? \(\(order\?\.lines/);
    expect(page).toContain("internal={internal}");
  });

  it("creating a sale writes no movement; Ausbuchen is the only one that does", () => {
    const create = code(latestFunction("seller_create_sale").body);
    const addItem = code(latestFunction("seller_add_sale_item").body);
    for (const fn of [create, addItem]) {
      for (const forbidden of ["record_inventory_movement", "shop_inventory", "movement_id"]) {
        expect(fn, forbidden).not.toContain(forbidden);
      }
    }
    // And the booking goes through the ledger, never a quantity update.
    expect(BOOK).toContain("record_inventory_movement(");
    expect(BOOK).toContain("'sale_external'");
    expect(BOOK).toMatch(/-1, 'sale_external'/);
    expect(BOOK).not.toMatch(/update public\.shop_inventory/);
    /*
     * Both screens still say so — beside the picker that adds an item, which
     * is where `Ausbuchen` and `Einbuchen` actually are. Under the create
     * form's submit button it was prose nobody read on the way past.
     */
    expect(de.business.sales.create.stockHint).toContain("Ausbuchen");
    expect(de.business.orderbook.createStockHint).toContain("Einbuchen");
    expect(read("src/components/business/sale-items.tsx")).toContain("create.stockHint");
    expect(read("src/components/business/add-purchase-item.tsx")).toContain("createStockHint");
    expect(NEW_SALE).not.toContain("create.stockHint");
    expect(NEW_PURCHASE).not.toContain("copy.createStockHint");
  });

  it("the two snapshots freeze at Ausbuchen, not at creation", () => {
    // One factor per sale, taken once and left alone.
    expect(BOOK).toMatch(/buy_in_factor_snapshot = coalesce\(buy_in_factor_snapshot, public\.orderbook_global_factor\(\)\)/);
    // The market price of the catalog, not a listing price, frozen as it leaves.
    expect(BOOK).toMatch(/select market_price into v_price from public\.skylanders/);
    expect(BOOK).toContain("market_price_snapshot = v_price");
    expect(BOOK).toContain("market_price_snapshot_at = now()");
    // Neither is set when the sale or the item is created.
    expect(code(latestFunction("seller_create_sale").body)).not.toContain("buy_in_factor_snapshot");
    expect(code(latestFunction("seller_add_sale_item").body)).not.toContain("market_price_snapshot");
  });

  it("Ausbuchen refuses rather than going negative", () => {
    /*
     * The guard lives in `apply_inventory_movement`, which every recorded
     * movement goes through: the update only matches while the remaining
     * quantity still covers the reservations, so a sale cannot eat a unit a
     * shop order is holding — and cannot go negative either, since `reserved`
     * is never below zero.
     */
    const apply = code(latestFunction("apply_inventory_movement").body);
    expect(apply).toMatch(/quantity \+ p_delta >= reserved/);
    expect(BOOK).toContain("record_inventory_movement");
    expect(BOOK).toContain("this item is not a catalog figure and has no stock position");
  });

  it("a purchase may be created without a date, and creating it stocks nothing", () => {
    // 0058 made the column nullable; the form stopped defaulting to today.
    expect(NEW_PURCHASE).toMatch(/useState\(""\)/);
    expect(NEW_PURCHASE).toMatch(/date\.trim\(\) \|\| null/);
    expect(NEW_PURCHASE).not.toContain("new Date().toISOString()");
    const create = code(latestFunction("seller_create_purchase").body);
    for (const forbidden of ["record_inventory_movement", "shop_inventory"]) {
      expect(create, forbidden).not.toContain(forbidden);
    }
    // Only Einbuchen moves stock, through the ledger.
    const bookPurchase = code(latestFunction("seller_book_purchase_item").body);
    expect(bookPurchase).toContain("record_inventory_movement");
  });

  it("items are searched in the one canonical catalog", () => {
    // `seller_import_catalog()` — the same source the purchase screen uses.
    expect(read("src/lib/orderbook/queries.ts")).toContain('rpc("seller_import_catalog")');
    /*
     * The filtering itself moved into `FigureSearch` in 0065, which is the
     * point of that component: the sale screen, the purchase screen and both
     * create forms now search identically. So the assertion follows it —
     * the catalog still arrives as a prop, the shared picker still shows the
     * series and the SKY-ID beside the name because display names repeat
     * across the six games, and this screen still makes no lookup of its own.
     */
    expect(SALE_ITEMS).toContain("FigureSearch");
    expect(SALE_ITEMS).toContain("catalog={catalog}");
    expect(SALE_ITEMS).not.toContain("catalog.filter");        // no second search
    expect(SALE_ITEMS).not.toContain("seller_import_catalog"); // no second lookup
    const picker = read("src/components/business/figure-search.tsx");
    expect(picker).toContain("{choice.series}");
    expect(picker).toContain("{choice.skyId}");
  });

  it("every creation path is seller-gated", () => {
    for (const fn of ["seller_create_sale", "seller_add_sale_item", "seller_book_sale_item",
                      "seller_create_purchase", "seller_add_purchase_item",
                      "seller_book_purchase_item"]) {
      expect(code(latestFunction(fn).body), fn).toContain("can_operate_active_seller()");
    }
    // And no component reaches a table directly.
    for (const file of [NEW_SALE, NEW_PURCHASE, SALE_ITEMS]) {
      expect(file).not.toMatch(/\.from\("(sales|sale_items|purchases|purchase_items)"\)/);
      expect(file).not.toContain("SERVICE_ROLE");
    }
  });

  it("Intern and Extern are scoped by channel, never by provenance", () => {
    const list = code(latestFunction("seller_sales").body);
    expect(list).toContain("p_scope = 'internal' and b.order_id is not null");
    expect(list).toContain("p_scope = 'external' and b.order_id is null");
    // `source` describes where a row came from, not how it was sold.
    expect(list).not.toMatch(/p_scope[\s\S]{0,120}excel_order_2026/);
  });
});

/* ===================================================================== */
/**
 * „VERSCHICKT" IST EIN KLICK — UND DERSELBE BUCHUNGSWEG (0090).
 *
 * Vorher bot eine frisch angelegte externe Position nichts an: `Ausbuchen`
 * erschien erst, wenn der ganze Verkauf über den Versandschalter auf
 * „verschickt" stand. Ein Verkauf, den niemand zweimal anfasste, ließ den
 * Bestand also unverändert stehen.
 *
 * Die Lösung ist KEIN zweiter Buchungsweg: `seller_ship_sale_item` ruft
 * `seller_book_sale_item` auf und schreibt daneben nur das Versanddatum.
 */
describe("shipping one external position, in a single step", () => {
  const SHIP = code(latestFunction("seller_ship_sale_item").body);
  const item = (over: Record<string, unknown> = {}) => ({
    movement_id: null, returned_at: null, return_movement_id: null,
    settled_at: null, not_shipped_at: null, return_announced_at: null,
    sky_id: "SKY-0203", legacy_stock_flag: null, ...over,
  } as never);
  const ctx = (over: Record<string, unknown> = {}) =>
    ({ frozen: false, cancelled: false, shipped: false, ...over } as never);

  it("offers it on an open position with a figure", () => {
    expect(saleItemActions(item(), ctx())).toMatchObject({ status: "open", primary: "ship" });
    expect(de.business.sales.itemActionLabels.ship).toBe("Verschickt");
  });

  it("books through the one existing path and writes no stock itself", () => {
    expect(SHIP).toContain("v_mid := public.seller_book_sale_item(p_item_id)");
    // Keine zweite Buchung: weder eine eigene Bewegung noch ein Griff in den Bestand.
    expect(SHIP).not.toContain("record_inventory_movement");
    expect(SHIP).not.toContain("apply_inventory_movement");
    expect(SHIP).not.toContain("shop_inventory");
    expect(SHIP).not.toContain("insert into public.inventory_movements");
    expect(SHIP).not.toContain("legacy_stock_events");
  });

  it("stamps the shipping date once, so a second position does not move it", () => {
    expect(SHIP).toContain("shipped_at = coalesce(shipped_at, now())");
    // Und sonst nichts an diesem Verkauf.
    const update = SHIP.slice(SHIP.indexOf("update public.sales"), SHIP.indexOf("return v_mid"));
    for (const column of ["items_subtotal", "shipping_charged", "discount_amount",
                          "cancelled_at", "stock_released_at", "import_fingerprint"]) {
      expect(update, column).not.toContain(column);
    }
  });

  it("cannot book twice: the inner call returns the movement it already has", () => {
    const BOOK = code(latestFunction("seller_book_sale_item").body);
    expect(BOOK).toContain("if v_item.movement_id is not null then return v_item.movement_id;");
    // Eine zweite Bewegung entsteht also nicht, und das Datum bleibt das erste.
    expect(SHIP).toContain("coalesce(shipped_at, now())");
  });

  it("is gated like every other seller function", () => {
    expect(SHIP).toContain("if not public.can_operate_active_seller() then");
    const source = migrationSource("0090_ship_sale_item.sql");
    expect(source).toContain("security definer");
    expect(source).toContain("set search_path = ''");
    expect(source).toContain("revoke all on function public.seller_ship_sale_item(bigint) from public, anon;");
    expect(source).toContain("grant execute on function public.seller_ship_sale_item(bigint) to authenticated;");
  });

  it("refuses the endings that mean nothing left the shelf", () => {
    expect(SHIP).toContain("if v_item.settled_at is not null then");
    expect(SHIP).toContain("if v_item.not_shipped_at is not null then");
    // Und im Formular werden sie gar nicht erst angeboten.
    expect(saleItemActions(item({ settled_at: "t" }), ctx()).primary).toBe("unsettle");
    expect(saleItemActions(item({ not_shipped_at: "t" }), ctx()).primary).toBe("unmark_not_shipped");
  });

  it("leaves the refusals where they already are — in the booking path", () => {
    const BOOK = code(latestFunction("seller_book_sale_item").body);
    expect(BOOK).toContain("historical sales never move stock");
    expect(BOOK).toContain("the order already moved this stock");
    expect(BOOK).toContain("this item is not a catalog figure and has no stock position");
    // Zu wenig Bestand entscheidet der kanonische Bewegungspfad.
    expect(BOOK).toContain("public.record_inventory_movement(");
  });

  it("shows nothing to ship where there is no figure — that line is settled instead", () => {
    expect(saleItemActions(item({ sky_id: null }), ctx()).primary).toBe("settle");
  });

  it("offers it once: a booked position moves on to the return actions", () => {
    expect(saleItemActions(item({ movement_id: 7 }), ctx()))
      .toMatchObject({ status: "outbooked", primary: "announce_return" });
    expect(saleItemActions(item({ movement_id: 7 }), ctx({ shipped: true })).primary)
      .not.toBe("ship");
  });

  it("treats every position on its own", () => {
    // Zwei Positionen desselben Verkaufs, eine gebucht: nur die andere wird
    // noch angeboten, und die Buchung adressiert die Position, nicht den Verkauf.
    expect(saleItemActions(item(), ctx()).primary).toBe("ship");
    expect(saleItemActions(item({ movement_id: 7 }), ctx()).primary).toBe("announce_return");
    expect(SHIP).toContain("where id = p_item_id");
    expect(readFileSync(join(process.cwd(), "src/components/business/sale-items.tsx"), "utf8"))
      .toContain("ship: run(() => shipSaleItem(id, saleId))");
  });

  it("does not offer it for an imported sale — history never moves stock here", () => {
    const held = saleItemActions(item({ source_row: 42 }), ctx({ historical: true }));
    expect(held.primary).toBeNull();
    expect(held.heldForReconciliation).toBe(true);
  });

  it("takes the sale out of `Offen` once every position has left", () => {
    const sale = {
      source: "manual", cancelledAt: null, stockReleasedAt: null, orderId: null,
      itemCount: 2, outbookedCount: 0, restockedCount: 0, settledCount: 0,
      notShippedCount: 0, closedCount: 0,
    };
    expect(saleStockStatus(sale)).toBe("open");
    expect(saleStockStatus({ ...sale, outbookedCount: 1, closedCount: 1 })).toBe("partial");
    expect(saleStockStatus({ ...sale, outbookedCount: 2, closedCount: 2 })).toBe("outbooked");
  });
});

/* ===================================================================== */
/**
 * ZWEI BILDSCHIRME, EINE AKTIONSLISTE.
 *
 * `saleItemActions` entscheidet für beide: die Detailseite
 * (`sale-items.tsx`) und die aufgeklappte Position in der Verkaufsliste
 * (`sales-ledger.tsx`). Jede rendert ihren Knopf über eine eigene
 * Handler-Tabelle — und genau da ging `ship` verloren: die Regel lieferte
 * `primary = "ship"`, die Liste kannte den Schlüssel nicht, und
 * `{run ? <button/> : null}` zeigte nichts. Statusspalte „Offen", Spalte
 * „Aktion" leer.
 *
 * Dieser Block prüft deshalb nicht Text, sondern Deckung: jede Aktion, die
 * die Regel tatsächlich hervorbringt, muss in der Detailseite verdrahtet
 * sein — und in der Liste entweder verdrahtet oder hier ausdrücklich als
 * bewusst ausgelassen benannt.
 */
describe("every action the rules produce is wired where it is offered", () => {
  const DETAIL = readFileSync(join(process.cwd(), "src/components/business/sale-items.tsx"), "utf8");
  const LEDGER = readFileSync(join(process.cwd(), "src/components/business/sales-ledger.tsx"), "utf8");

  /*
   * Die Liste bietet bewusst nur die Aktionen an, die Bestand bewegen oder
   * eine Retoure weiterschieben. Eine Position ohne Bewegung zu schließen
   * ist eine Entscheidung und gehört auf die Detailseite, wo der ganze
   * Verkauf sichtbar ist. Wer das ändert, ändert diese Liste — bewusst.
   *
   * `unmark_not_shipped` steht NICHT mehr darauf: das × zum Stornieren gibt
   * es hier, also muss es hier auch den Weg zurück geben. Eine Aktion, die
   * nur in einem der beiden Bildschirme rückgängig zu machen ist, ist eine
   * Sackgasse in dem anderen.
   */
  const LEDGER_OMITS = ["settle", "unsettle"];

  /** Alles, was `saleItemActions` über den Zustandsraum hinweg zurückgibt. */
  function producedActions(): string[] {
    const out = new Set<string>();
    const base = {
      movement_id: null as number | null, return_movement_id: null as number | null,
      returned_at: null as string | null, return_announced_at: null as string | null,
      settled_at: null as string | null, not_shipped_at: null as string | null,
      sky_id: "SKY-0203" as string | null, legacy_stock_flag: null as string | null,
    };
    const variants: Record<string, unknown>[] = [
      {}, { sky_id: null }, { legacy_stock_flag: "-" },
      { movement_id: 1 }, { movement_id: 1, return_announced_at: "t" },
      { movement_id: 1, returned_at: "t" },
      { movement_id: 1, returned_at: "t", return_movement_id: 2 },
      { settled_at: "t" }, { not_shipped_at: "t" },
    ];
    for (const over of variants) {
      for (const shipped of [false, true]) {
        for (const historical of [false, true]) {
          const { primary } = saleItemActions({ ...base, ...over } as never,
            { frozen: false, cancelled: false, shipped, historical });
          if (primary !== null) out.add(primary);
        }
      }
    }
    return [...out].sort();
  }

  it("produces the actions both screens have to know about", () => {
    // Wächter: fällt eine Aktion weg oder kommt eine dazu, schlägt das hier
    // zuerst auf — und die beiden Prüfungen darunter nennen den Ort.
    expect(producedActions()).toEqual([
      "announce_return", "book", "mark_returned", "restock", "settle", "ship", "unmark_not_shipped", "unsettle",
    ]);
  });

  it("the detail screen wires every one of them", () => {
    const map = DETAIL.slice(DETAIL.indexOf("const primary: Record<string, () => void> = {"),
                             DETAIL.indexOf("const quiet ="));
    for (const action of producedActions()) {
      expect(map, `${action} fehlt auf der Detailseite`).toContain(`${action}:`);
    }
  });

  it("the ledger wires every one it does not deliberately omit", () => {
    const map = LEDGER.slice(LEDGER.indexOf("const primary: Partial<Record<string, () => void>> = {"),
                             LEDGER.indexOf("const run = can.primary"));
    for (const action of producedActions()) {
      if (LEDGER_OMITS.includes(action)) {
        expect(map, `${action} soll in der Liste fehlen`).not.toContain(`${action}:`);
      } else {
        expect(map, `${action} fehlt in der Verkaufsliste`).toContain(`${action}:`);
      }
    }
  });

  it("both call the same server action for shipping", () => {
    expect(DETAIL).toContain("ship: run(() => shipSaleItem(id, saleId))");
    expect(LEDGER).toContain("ship: () => act(sale.id, () => shipSaleItem(id, sale.id))");
  });

  it("an open, shelf-bound position on an external sale offers it", () => {
    const item = {
      movement_id: null, return_movement_id: null, returned_at: null,
      return_announced_at: null, settled_at: null, not_shipped_at: null,
      sky_id: "SKY-0139", legacy_stock_flag: null,
    } as never;
    expect(saleItemActions(item, { frozen: false, cancelled: false, shipped: false,
                                   historical: false }))
      .toMatchObject({ status: "open", primary: "ship" });
  });
});

/* ===================================================================== */
/**
 * EIN SPEICHERN, EIN SCHREIBVORGANG (0091).
 *
 * Der Dialog schrieb Datum und Metadaten nacheinander, beide mit demselben
 * `expected_updated_at`. Der erste Aufruf setzte `updated_at` neu, der
 * zweite prüfte gegen den alten Wert — `PT409` gegen den eigenen Schreib-
 * vorgang, und die Metadaten blieben liegen.
 */
describe("saving a sale's metadata is one write", () => {
  const UPDATE = code(latestFunction("seller_update_sale").body);
  const DETAILS = readFileSync(join(process.cwd(), "src/components/business/sale-details.tsx"), "utf8");
  const ACTIONS = readFileSync(join(process.cwd(), "src/lib/orderbook/sales-actions.ts"), "utf8");

  it("writes date and metadata in the same statement, behind one guard", () => {
    expect(UPDATE.match(/orderbook_guard_stale/g)).toHaveLength(1);
    expect(UPDATE.match(/update public\.sales/g)).toHaveLength(1);
    const statement = UPDATE.slice(UPDATE.indexOf("update public.sales"), UPDATE.indexOf("-- One audit"));
    for (const column of ["sold_at", "destination_country_code", "buyer_ref",
                          "external_order_ref", "note", "updated_at"]) {
      expect(statement, column).toContain(column);
    }
  });

  it("checks the date range on this path too, as the separate one always did", () => {
    expect(UPDATE).toContain("that sale date is outside the plausible range");
    const DATE = code(latestFunction("seller_set_sale_date").body);
    expect(DATE).toContain("that sale date is outside the plausible range");
  });

  it("keeps every other guard of that function", () => {
    expect(UPDATE).toContain("if not public.can_operate_active_seller() then");
    expect(UPDATE).toContain("these belong to the order, not to the Orderbuch");
    expect(UPDATE).toContain("a destination country is a two-letter code");
    const source = migrationSource("0091_update_sale_date_range.sql");
    expect(source).toContain("security definer");
    expect(source).toContain("set search_path = ''");
    expect(source).toContain("from public, anon;");
    expect(source).toContain("to authenticated;");
  });

  it("the dialog no longer writes twice with one token", () => {
    const save = DETAILS.slice(DETAILS.indexOf("async function saveMeta()"),
                               DETAILS.indexOf("return (", DETAILS.indexOf("async function saveMeta()")));
    expect(save.match(/await run\(/g)).toHaveLength(1);
    expect(save).not.toContain("setSaleDate");
    // Und das Datum reist im selben Aufruf mit.
    expect(save).toContain("soldAt: wanted");
  });

  it("passes the three date states the function expects", () => {
    const fn = ACTIONS.slice(ACTIONS.indexOf("export async function updateSaleMeta"),
                             ACTIONS.indexOf("export async function setSaleShipped"));
    expect(fn).toContain('const touchesDate = "soldAt" in fields;');
    expect(fn).toContain("p_sold_at: touchesDate ? fields.soldAt ?? null : null");
    expect(fn).toContain('p_clear_date: touchesDate && (fields.soldAt ?? null) === null');
  });

  it("leaves the date-only path alone for the tools that use it", () => {
    expect(ACTIONS).toContain('return run("seller_set_sale_date"');
    expect(readFileSync(join(process.cwd(), "tools/apply-workbook-dates.mts"), "utf8"))
      .toContain('db.rpc("seller_set_sale_date"');
  });
});

/* ===================================================================== */
/**
 * DIE RETOURE IN ZWEI STUFEN — UND WARUM DER BILDSCHIRM SIE NICHT SAH.
 *
 * Das Datenmodell konnte den Ablauf seit 0074 vollständig: `return_announced_at`
 * ist die Ankündigung, `returned_at` der Wareneingang, `return_movement_id`
 * die Einbuchung. Was fehlte, war die Projektion: `seller_sale()` — die
 * Quelle beider Ansichten — lieferte `return_announced_at` nie mit. Der
 * Klick schrieb, der Bildschirm sah nichts und bot denselben Knopf erneut an.
 *
 * 0092 holt die drei fehlenden Felder nach und fasst den Wareneingang in
 * einen Aufruf: dieselben zwei Funktionen, eine Transaktion.
 */
describe("returning an external position, announced first and booked second", () => {
  const PROJECTION = code(latestFunction("seller_sale").body);
  const RECEIVE = code(latestFunction("seller_receive_sale_item_return").body);
  const ANNOUNCE = code(latestFunction("seller_announce_sale_item_return").body);
  const RESTOCK = code(latestFunction("seller_restock_sale_item").body);
  const DETAIL = readFileSync(join(process.cwd(), "src/components/business/sale-items.tsx"), "utf8");
  const LEDGER = readFileSync(join(process.cwd(), "src/components/business/sales-ledger.tsx"), "utf8");
  const item = (over: Record<string, unknown> = {}) => ({
    movement_id: null, return_movement_id: null, returned_at: null,
    return_announced_at: null, settled_at: null, not_shipped_at: null,
    sky_id: "SKY-0139", legacy_stock_flag: null, ...over,
  } as never);
  const ctx = { frozen: false, cancelled: false, shipped: false, historical: false };

  it("THE ROOT CAUSE: the projection now carries what the screen has to read", () => {
    for (const field of ["'return_announced_at', i.return_announced_at",
                         "'settled_at', i.settled_at",
                         "'not_shipped_at', i.not_shipped_at"]) {
      expect(PROJECTION, field).toContain(field);
    }
    // Und die Felder, die sie immer schon hatte, sind noch da.
    for (const field of ["'movement_id', i.movement_id", "'returned_at', i.returned_at",
                         "'return_movement_id', i.return_movement_id"]) {
      expect(PROJECTION, field).toContain(field);
    }
  });

  it("walks the lifecycle the operator sees", () => {
    // Offen → verschicken.
    expect(saleItemActions(item(), ctx)).toMatchObject({ status: "open", primary: "ship" });
    // Verschickt und ausgebucht → Retoure ankündigen.
    expect(saleItemActions(item({ movement_id: 669 }), ctx))
      .toMatchObject({ status: "outbooked", primary: "announce_return" });
    // Angekündigt → den Wareneingang bestätigen.
    expect(saleItemActions(item({ movement_id: 669, return_announced_at: "t" }), ctx))
      .toMatchObject({ status: "return_announced", primary: "mark_returned" });
    // Eingebucht → nichts mehr zu tun.
    expect(saleItemActions(item({ movement_id: 669, return_announced_at: "t",
                                  returned_at: "t", return_movement_id: 670 }), ctx))
      .toMatchObject({ status: "restocked", primary: null });
  });

  it("names the two steps as the operator does", () => {
    const labels = de.business.sales.itemActionLabels;
    expect(labels.announce_return).toBe("Retoure");
    expect(labels.mark_returned).toBe("Bestätigen");
    expect(de.business.sales.itemStates.return_announced).toBe("Retoure");
    // Der Endzustand ist der vorhandene, kein neuer.
    expect(de.business.sales.itemStates.restocked).toBe("Wieder eingelagert ✓");
  });

  it("announcing moves no stock and cannot be announced twice", () => {
    expect(ANNOUNCE).toContain("if v_item.return_announced_at is not null then return; end if;");
    expect(ANNOUNCE).not.toContain("record_inventory_movement");
    expect(ANNOUNCE).not.toContain("shop_inventory");
    // Etwas muss das Regal verlassen haben, sonst ist es keine Retoure.
    expect(ANNOUNCE).toContain("nothing was booked out of stock for this position");
  });

  it("confirming books exactly one +1, through the path that always did", () => {
    expect(RECEIVE).toContain("perform public.seller_return_sale_item(p_item_id, true)");
    expect(RECEIVE).toContain("v_mid := public.seller_restock_sale_item(p_item_id)");
    // Die Funktion bucht nichts selbst.
    expect(RECEIVE).not.toContain("record_inventory_movement");
    expect(RECEIVE).not.toContain("shop_inventory");
    expect(RECEIVE).not.toContain("legacy_stock_events");
    // Und die +1 entsteht dort, wo sie hingehört.
    expect(RESTOCK).toContain("public.record_inventory_movement(");
    expect(RESTOCK).toContain(", 1, 'return',");
  });

  it("cannot book the return twice", () => {
    expect(RECEIVE).toContain("if v_item.return_movement_id is not null then");
    expect(RECEIVE).toContain("return v_item.return_movement_id;");
    // Auch der innere Weg ist für sich idempotent.
    expect(RESTOCK).toContain("if v_item.return_movement_id is not null then return v_item.return_movement_id;");
  });

  it("refuses a position that never left the shelf", () => {
    expect(RECEIVE).toContain("nothing was booked out of stock for this position");
    expect(RESTOCK).toContain("this item never left stock");
  });

  it("keeps history out of it", () => {
    expect(RESTOCK).toContain("historical sales never move stock");
    const source = migrationSource("0092_sale_item_return_receipt.sql");
    expect(source).not.toContain("legacy_stock_events");
    expect(source).toContain("security definer");
    expect(source).toContain("set search_path = ''");
    expect(source).toContain("revoke all on function public.seller_receive_sale_item_return(bigint) from public, anon;");
    expect(source).toContain("grant execute on function public.seller_receive_sale_item_return(bigint) to authenticated;");
  });

  it("both screens confirm through the same server action", () => {
    expect(DETAIL).toContain("mark_returned: run(() => receiveSaleItemReturn(id, saleId))");
    expect(LEDGER).toContain("mark_returned: () => act(sale.id, () => receiveSaleItemReturn(id, sale.id))");
    // Und der alte Einzelschritt bleibt für Zeilen, die schon `returned_at` tragen.
    expect(DETAIL).toContain("restock: run(() => restockSaleItem(id, saleId))");
    expect(LEDGER).toContain("restock: () => act(sale.id, () => restockSaleItem(id, sale.id))");
  });

  it("an item without a figure never enters this path", () => {
    expect(saleItemActions(item({ sky_id: null }), ctx).primary).toBe("settle");
    expect(saleItemActions(item({ sky_id: null, movement_id: null }), ctx).primary).not.toBe("ship");
  });
});

/* ===================================================================== */
/**
 * STORNIEREN — DER ZWEITE WEG AUS EINER OFFENEN POSITION.
 *
 * Verkauft und verschickt ist der eine Ausgang; nie rausgegangen der andere.
 * Beide sind Enden, nur bewegt der zweite nichts: kein Movement, kein
 * Bestand, keine Buchung, die später zurückgenommen werden müsste.
 *
 * Das Datenmodell konnte das seit 0074 — `not_shipped_at`, geschrieben von
 * `seller_set_sale_item_not_shipped`, und `sale_item_is_closed()` zählt es
 * als abgeschlossen. Gefehlt hat nur das Wort: der Zustand hieß „Nicht
 * verschickt" und stand als Textlink neben der Zeile. Jetzt heißt er
 * „Storniert" und sitzt als × neben „Verschickt".
 */
describe("cancelling an open position", () => {
  const CANCEL = code(latestFunction("seller_set_sale_item_not_shipped").body);
  const CLOSED = code(latestFunction("sale_item_is_closed").body);
  const DETAIL = readFileSync(join(process.cwd(), "src/components/business/sale-items.tsx"), "utf8");
  const LEDGER = readFileSync(join(process.cwd(), "src/components/business/sales-ledger.tsx"), "utf8");
  const item = (over: Record<string, unknown> = {}) => ({
    movement_id: null, return_movement_id: null, returned_at: null,
    return_announced_at: null, settled_at: null, not_shipped_at: null,
    sky_id: "SKY-0139", legacy_stock_flag: null, ...over,
  } as never);
  const ctx = { frozen: false, cancelled: false, shipped: false, historical: false };

  it("1. an open position offers shipping AND cancelling", () => {
    const can = saleItemActions(item(), ctx);
    expect(can.status).toBe("open");
    expect(can.primary).toBe("ship");
    expect(can.canNotShip).toBe(true);
  });

  it("2. cancelling writes one timestamp and never touches stock", () => {
    expect(CANCEL).toContain("set not_shipped_at = now()");
    expect(CANCEL).not.toContain("record_inventory_movement");
    expect(CANCEL).not.toContain("shop_inventory");
    expect(CANCEL).not.toContain("inventory_movements");
    expect(CANCEL).not.toContain("legacy_stock_events");
    // Und zweimal klicken ändert nichts mehr.
    expect(CANCEL).toContain("if v_item.not_shipped_at is not null then return; end if;");
  });

  it("3. a cancelled position is terminal on screen", () => {
    const can = saleItemActions(item({ not_shipped_at: "t" }), ctx);
    expect(can.status).toBe("not_shipped");
    expect(can.primary).toBe("unmark_not_shipped");   // nur zurücknehmen
    expect(can.canNotShip).toBe(false);               // kein zweites Stornieren
    expect(de.business.sales.itemStates.not_shipped).toBe("Storniert");
    // Terminal heißt geschlossen — und bleibt es.
    expect(saleItemClosed(item({ not_shipped_at: "t" }))).toBe(true);
  });

  it("4. a booked position cannot be cancelled", () => {
    expect(saleItemActions(item({ movement_id: 5 }), ctx).canNotShip).toBe(false);
    // Und die Datenbank lehnt es unabhängig von der Oberfläche ab.
    expect(CANCEL).toContain("this position left the shelf; reverse the booking first");
    expect(CANCEL).toContain("this position is already closed");
    expect(CANCEL).toContain("an order''s lines are owned by commerce");
  });

  it("5. a cancelled position does not hold the sale open", () => {
    expect(CLOSED).toContain("p_item.not_shipped_at is not null");
    expect(saleItemClosed(item({ not_shipped_at: "t" }))).toBe(true);
  });

  it("6. three shipped and one cancelled is a finished sale", () => {
    const sale = { source: "manual", cancelledAt: null, stockReleasedAt: null, orderId: null,
      itemCount: 4, outbookedCount: 3, restockedCount: 0, settledCount: 0,
      notShippedCount: 1, closedCount: 4 };
    expect(saleStockStatus(sale)).not.toBe("open");
    expect(saleStockStatus(sale)).not.toBe("partial");
    // Und eine einzelne stornierte Position ebenso.
    expect(saleStockStatus({ ...sale, itemCount: 1, outbookedCount: 0, notShippedCount: 1,
                             closedCount: 1 })).not.toBe("open");
  });

  it("7. the workbook's own `-`/`-` reads as cancelled, and moves nothing", () => {
    expect(legacyOutcome({ legacy_stock_flag: "-", legacy_shipped_flag: "-", sky_id: "SKY-0181" }))
      .toBe("not_shipped");
    expect(de.business.sales.legacyStates.not_shipped).toBe("Storniert");
    // Beide Bildschirme lesen dasselbe — das war vorher nur auf der
    // Detailseite so, die Liste zeigte den abgeleiteten Zustand.
    const cell = "{outcome !== null ? copy.legacyStates[outcome] : copy.itemStates[can.status]}";
    expect(DETAIL).toContain(cell);
    expect(LEDGER).toContain(cell);
  });

  it("8. shipping and returning are untouched", () => {
    expect(saleItemActions(item(), ctx).primary).toBe("ship");
    expect(saleItemActions(item({ movement_id: 5 }), ctx).primary).toBe("announce_return");
    expect(saleItemActions(item({ movement_id: 5, return_announced_at: "t" }), ctx).primary)
      .toBe("mark_returned");
  });

  it("the × is secondary, labelled and cancels in one click", () => {
    for (const source of [DETAIL, LEDGER]) {
      expect(source).toContain("aria-label={copy.markNotShippedItem}");
      // Ein Klick schreibt direkt — keine Zwischenstufe mehr.
      expect(source).toMatch(/onClick=\{\(\) => act\(.*setSaleItemNotShipped\(id, sale/);
      expect(source).not.toContain("setCancelling");
      expect(source).not.toContain("cancelItemConfirm");
      expect(source).not.toContain("cancelItemYes");
      expect(source).not.toContain("cancelItemNo");
    }
    expect(de.business.sales.markNotShippedItem).toBe("Stornieren");
    // Und die Rückfragetexte sind auch aus dem Wortschatz verschwunden.
    const sales = de.business.sales as Record<string, unknown>;
    expect(sales.cancelItemConfirm).toBeUndefined();
    expect(sales.cancelItemYes).toBeUndefined();
    expect(sales.cancelItemNo).toBeUndefined();
  });

  /* ------------------------------------------------------------------ */
  /*
   * RÜCKGÄNGIG — DAUERHAFT, SOLANGE DIE POSITION STORNIERT IST.
   *
   * Der Weg zurück ist derselbe, den 0074 schon kennt: dieselbe Funktion
   * mit `false`. Sie räumt `not_shipped_at` weg und sonst nichts — keine
   * Bewegung, kein Bestand, kein zweiter Buchungspfad.
   */
  it("9. a cancelled position keeps `Rückgängig` available", () => {
    const can = saleItemActions(item({ not_shipped_at: "t" }), ctx);
    expect(can.primary).toBe("unmark_not_shipped");
    expect(de.business.sales.itemActionLabels.unmark_not_shipped).toBe("Rückgängig");
    // Beide Bildschirme hängen an genau diesem Weg.
    expect(DETAIL).toContain("unmark_not_shipped: run(() => setSaleItemNotShipped(id, saleId, false))");
    expect(LEDGER)
      .toContain("unmark_not_shipped: () => act(sale.id, () => setSaleItemNotShipped(id, sale.id, false))");
  });

  it("10. undoing clears the timestamp and moves nothing", () => {
    expect(CANCEL).toContain("if not p_not_shipped then");
    expect(CANCEL).toContain("update public.sale_items set not_shipped_at = null");
    // Die ganze Funktion kennt keinen Bestandspfad — für beide Richtungen.
    expect(CANCEL).not.toContain("record_inventory_movement");
    expect(CANCEL).not.toContain("shop_inventory");
  });

  it("11. undoing makes the position — and the sale — open again", () => {
    const back = item({ not_shipped_at: null });
    expect(saleItemStatus(back, false)).toBe("open");
    expect(saleItemClosed(back)).toBe(false);
    const can = saleItemActions(back, ctx);
    expect(can.primary).toBe("ship");
    expect(can.canNotShip).toBe(true);
    // Ein Verkauf, der nur wegen der Stornierung geschlossen war, ist es nicht mehr.
    const sale = { source: "manual", cancelledAt: null, stockReleasedAt: null, orderId: null,
      itemCount: 1, outbookedCount: 0, restockedCount: 0, settledCount: 0 };
    expect(saleStockStatus({ ...sale, notShippedCount: 1, closedCount: 1 })).not.toBe("open");
    expect(saleStockStatus({ ...sale, notShippedCount: 0, closedCount: 0 })).toBe("open");
  });

  it("12. cancelled does not wear the green success tick", () => {
    const cancelled = saleItemIndicator("not_shipped", false);
    expect(cancelled.tone).not.toBe("green");
    expect(cancelled.glyph).not.toBe("\u2713");
    // Es ist das Symbol, das es für genau diesen Ausgang schon gibt.
    const legacy = saleItemIndicator("settled", false,
      { historical: true, outcome: "not_shipped" });
    expect(cancelled).toEqual(legacy);
    expect(cancelled).toEqual({ tone: "grey", glyph: "\u21a9" });
    // Die beiden echten Bewegungen behalten ihren Haken.
    expect(saleItemIndicator("outbooked", true)).toEqual({ tone: "green", glyph: "\u2713" });
    expect(saleItemIndicator("restocked", false).glyph).toBe("\u2713");
    // Und `Erledigt` ist ein anderer Ausgang und bleibt grün.
    expect(saleItemIndicator("settled", false)).toEqual({ tone: "green", glyph: "\u2713" });
  });

  it("13. the workbook's `-`/`-` shows cancelled, but never `Rückgängig`", () => {
    const legacyItem = item({ legacy_stock_flag: "-", legacy_shipped_flag: "-", settled_at: "t" });
    const can = saleItemActions(legacyItem, { ...ctx, historical: true });
    expect(can.primary).not.toBe("unmark_not_shipped");
    // Auch dann nicht, wenn die Zeile den Zeitstempel selbst trüge.
    expect(saleItemActions(item({ not_shipped_at: "t" }), { ...ctx, historical: true }).primary)
      .toBeNull();
    // Der Status bleibt „Storniert", das Icon dasselbe wie operativ.
    expect(legacyOutcome(legacyItem as never)).toBe("not_shipped");
    expect(saleItemIndicator("not_shipped", false, { historical: true, outcome: "not_shipped" }))
      .toEqual({ tone: "grey", glyph: "\u21a9" });
  });
});

/* ===================================================================== */
/**
 * ZWEI AKTIONEN, EINE ZEILE — UND EIN ZIEL NACH DEM ANLEGEN.
 *
 * Das × stand unter „Verschickt", weil die Aktionsspalte 6,5rem breit war
 * und der Flex-Container umbrach. Und das Formular schickte auf eine eigene
 * Detailseite, obwohl das Verkaufsbuch dieselbe Ansicht längst als Fenster
 * hat. Beides ist Darstellung; an der Lager- und Statuslogik ändert sich
 * nichts, was die Fälle darunter absichern.
 */
describe("the two actions of an open position sit side by side", () => {
  const DETAIL = readFileSync(join(process.cwd(), "src/components/business/sale-items.tsx"), "utf8");
  const LEDGER = readFileSync(join(process.cwd(), "src/components/business/sales-ledger.tsx"), "utf8");
  const NEW = readFileSync(join(process.cwd(), "src/components/business/new-sale.tsx"), "utf8");
  const PAGE = readFileSync(join(process.cwd(),
    "src/app/(business)/business/orderbuch/verkauf/page.tsx"), "utf8");

  it("gives the action column room for both controls", () => {
    const tracks = SALE_ITEM_COLUMNS.trim().split(/\s+(?![^(]*\))/);
    expect(tracks.at(-1)).toBe("9rem");
  });

  it("lays the cell out in a row, not a wrapping stack", () => {
    for (const source of [DETAIL, LEDGER]) {
      expect(source).toContain('className="flex items-center justify-end gap-2 text-right"');
      expect(source).not.toContain('className="flex flex-wrap justify-end gap-2 text-right"');
    }
  });

  it("shows both controls at once, with nothing stepping aside", () => {
    // Ohne Rückfrage gibt es auch keinen Zustand, der den Hauptknopf ausblendet.
    expect(DETAIL).toContain("{can.primary ? (");
    expect(LEDGER).toContain("{run ? (");
    for (const source of [DETAIL, LEDGER]) {
      expect(source).not.toContain("cancelling");
    }
  });

  it("sends a new sale to the ledger, opened, not to a page of its own", () => {
    expect(NEW).toContain("router.push(`/business/orderbuch/verkauf?verkauf=${created.id}`)");
    expect(NEW).not.toContain("router.push(`/business/orderbuch/verkauf/${created.id}`)");
  });

  it("the ledger opens that sale once, expanded and in the existing overlay", () => {
    expect(PAGE).toContain("openSale={openSale}");
    expect(PAGE).toContain("Number(params.verkauf)");
    expect(LEDGER).toContain("openSale?: number;");
    // Das Fenster steht ab der ersten Darstellung offen - ohne Effekt, der
    // nach dem Rendern noch einmal Zustand setzt.
    expect(LEDGER).toContain(
      "useState<number | null>(\n    () => (openSale !== undefined && sales.some((s) => s.id === openSale) ? openSale : null))");
    // Aufgeklappt, damit Positionen und ihre Aktionen sichtbar sind.
    expect(LEDGER).toContain("...(openSale !== undefined ? [openSale] : [])");
    // Geladen wird die Zeile ueber genau den bestehenden Mount-Effekt.
    expect(LEDGER).toContain("for (const id of open) load(id);");
  });

  it("clears the parameter when the overlay closes", () => {
    expect(LEDGER).toContain("if (openSale !== undefined) router.replace(backHref);");
  });

  it("keeps the deep link route in place", () => {
    expect(existsSync(join(process.cwd(),
      "src/app/(business)/business/orderbuch/verkauf/[id]/page.tsx"))).toBe(true);
  });

  it("changes nothing about stock semantics", () => {
    // Dieselben Entscheidungen wie zuvor, unabhängig von der Darstellung.
    const item = (over: Record<string, unknown> = {}) => ({
      movement_id: null, return_movement_id: null, returned_at: null,
      return_announced_at: null, settled_at: null, not_shipped_at: null,
      sky_id: "SKY-0139", legacy_stock_flag: null, ...over,
    } as never);
    const ctx = { frozen: false, cancelled: false, shipped: false, historical: false };
    expect(saleItemActions(item(), ctx)).toMatchObject({ primary: "ship", canNotShip: true });
    expect(saleItemActions(item({ not_shipped_at: "t" }), ctx))
      .toMatchObject({ status: "not_shipped", primary: "unmark_not_shipped", canNotShip: false });
    expect(saleItemActions(item({ movement_id: 5 }), ctx))
      .toMatchObject({ status: "outbooked", primary: "announce_return", canNotShip: false });
  });
});
