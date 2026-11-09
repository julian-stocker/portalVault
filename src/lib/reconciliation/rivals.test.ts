/**
 * The `rival_sale` rule of 0180, recomputed for display (2026-11-09).
 *
 * Simulated from the April session on Staging: the order of sale 157
 * (12-14570-08869, 30.04., Warnado / Camo / Dino-Rang) is blocked by sale
 * 160 (01.05., Camo, Bash) and sale 158 (01.05., Eruptor, Trigger Happy,
 * Drobot, Dino Rang); the order of 155 (11-14567-77386, 29.04.) by 158 —
 * May sales, after the April report, so this session can never pair them.
 *
 * The SQL predicate it mirrors is checked character for character below.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { rivalOrders, rivalSales, rivalWindow, wantsOrderNumber } from "./rivals";
import type { LedgerPiece, LedgerSale } from "./types";
import type { Finding, Match } from "./view";

const piece = (rawName: string, name: string | null = rawName, skyId: string | null = null): LedgerPiece =>
  ({ itemId: 1, skyId, name, rawName, seriesCode: "SSA", baseSkyId: null });
const sale = (saleId: number, soldOn: string, pieces: LedgerPiece[], over: Partial<LedgerSale> = {}): LedgerSale => ({
  saleId, source: "excel_order_2026", isTest: false, soldOn, itemsSubtotal: 0, discount: 0, shipping: 0, refundsTotal: 0,
  cancelledOn: null, externalOrderRef: null, pieces, ...over,
});
const line = (name: string) => ({ lineRef: null, listingId: "1", title: name, variant: null, name, quantity: 1, unitPrice: 1, value: 1 });
const pair = (saleId: number, soldOn: string, names: string[]): Pick<Match, "order" | "sale"> => ({
  order: { soldOn, lines: names.map(line) } as unknown as Match["order"],
  sale: { id: saleId } as Match["sale"],
});

const S157 = sale(157, "2026-04-30", [piece("Warnado"), piece("Camo"), piece("Dino Rang", "Dino-Rang")]);
const S158 = sale(158, "2026-05-01", [piece("Eruptor"), piece("Trigger Happy"), piece("Drobot"), piece("Dino Rang", "Dino-Rang")]);
const S160 = sale(160, "2026-05-01", [piece("Camo"), piece("Bash")]);
const S155 = sale(155, "2026-04-29", [piece("Stump Smash"), piece("Eruptor"), piece("Dino Rang", "Dino-Rang")]);
const ALL = [S155, S157, S158, S160];
const PAIRED = new Set([155, 157]);

describe("the April case", () => {
  it("12-14570-08869 / sale 157: blocked by 158 (Dino Rang) and 160 (Camo) — by date, then id", () => {
    expect(rivalSales(pair(157, "2026-04-30", ["warnado", "camo", "dino-rang"]), ALL, PAIRED)).toEqual([
      { saleId: 158, soldOn: "2026-05-01", shared: ["Dino Rang"], pieces: ["Eruptor", "Trigger Happy", "Drobot", "Dino Rang"], updatedAt: null },
      { saleId: 160, soldOn: "2026-05-01", shared: ["Camo"], pieces: ["Camo", "Bash"], updatedAt: null },
    ]);
  });

  it("11-14567-77386 / sale 155: blocked by 158 (Eruptor, Dino Rang); 160 shares nothing", () => {
    expect(rivalSales(pair(155, "2026-04-29", ["stump smash", "eruptor", "dino-rang"]), ALL, PAIRED).map((r) => [r.saleId, r.shared]))
      .toEqual([[158, ["Eruptor", "Dino Rang"]]]);
  });
});

describe("the rule, part by part — as 0180 has it", () => {
  const p = pair(157, "2026-04-30", ["camo"]);
  it("a sale paired in this session is no rival; the pair's own sale neither", () => {
    expect(rivalSales(p, ALL, new Set([157, 160]))).toEqual([]);
  });
  it("a test, a cancelled sale, or one that has an order number is no rival", () => {
    for (const over of [{ isTest: true }, { cancelledOn: "2026-05-02" }, { externalOrderRef: "01-0000-0000" }]) {
      expect(rivalSales(p, [{ ...S160, ...over }], PAIRED)).toEqual([]);
    }
  });
  it("±3 days around the ORDER date, both ends included", () => {
    expect(rivalWindow("2026-04-30")).toEqual({ from: "2026-04-27", to: "2026-05-03" });
    expect(rivalSales(p, [{ ...S160, soldOn: "2026-05-03" }], PAIRED)).toHaveLength(1);
    expect(rivalSales(p, [{ ...S160, soldOn: "2026-05-04" }], PAIRED)).toEqual([]);
    expect(rivalSales(p, [{ ...S160, soldOn: "2026-04-27" }], PAIRED)).toHaveLength(1);
  });
  it("names exact after trim and case — raw name or catalogue name; another spelling stays unseen", () => {
    expect(rivalSales(pair(1, "2026-04-30", ["  CAMO "]), [S160], new Set())).toHaveLength(1);
    expect(rivalSales(pair(1, "2026-04-30", ["dino-rang"]), [S158], new Set())).toHaveLength(1); // catalogue name
    expect(rivalSales(pair(1, "2026-04-30", ["dino rang"]), [S158], new Set())).toHaveLength(1); // raw name
    expect(rivalSales(pair(1, "2026-04-30", ["dinorang"]), [S158], new Set())).toEqual([]);
  });
  it("without the report's lines nothing is claimed (the database says no_lines then)", () => {
    expect(rivalSales({ ...p, order: { ...p.order!, lines: null } }, ALL, PAIRED)).toEqual([]);
  });
  it("only a pair that still asks for the order number is looked at", () => {
    const f = (field: string, applied = false) => ({ field, applied }) as unknown as Finding;
    expect(wantsOrderNumber({ findings: [f("external_order_ref")] })).toBe(true);
    expect(wantsOrderNumber({ findings: [f("external_order_ref", true)] })).toBe(false);
    expect(wantsOrderNumber({ findings: [f("shipping")] })).toBe(false);
  });

  it("the SQL this mirrors is still 0180's — and still the live one (no later migration changed take_check)", () => {
    const sql = readFileSync("supabase/migrations/0180_sales_recon_selected_apply.sql", "utf8");
    for (const part of ["s2.order_id is null", "not s2.is_test", "s2.cancelled_at is null", "s2.external_order_ref is null",
      "s2.sold_at between o.sold_on - 3 and o.sold_on + 3", "m2.order_id is not null",
      "lower(btrim(l ->> 'name')) in (lower(btrim(i.raw_name))", "lower(btrim(k.name))", "return 'rival_sale';"]) {
      expect(sql, part).toContain(part);
    }
    for (const f of ["0181_legacy_sale_item_corrections.sql", "0182_backup_sale_item_corrections.sql"]) {
      expect(readFileSync(`supabase/migrations/${f}`, "utf8")).not.toContain("sales_recon_take_check");
    }
  });
});

describe("the other half: rival ORDERS (0180's rival_order)", () => {
  const order = (id: number, orderRef: string, soldOn: string, names: string[], sale: { id: number } | null = null) =>
    ({ order: { id, orderRef, soldOn, lines: names.map(line) }, sale }) as unknown as Pick<Match, "order" | "sale">;
  it("another UNPAIRED order of the session, ±3 days of the sale, sharing a figure — never the pair's own, never a paired one", () => {
    const matches = [order(1, "own", "2026-04-30", ["Camo"]), order(2, "rival", "2026-05-02", ["camo "]),
      order(3, "paired", "2026-05-01", ["Camo"], { id: 99 }), order(4, "far", "2026-05-04", ["Camo"]), order(5, "other", "2026-05-01", ["Bash"])];
    expect(rivalOrders(S157, 1, matches)).toEqual([{ orderId: 2, orderRef: "rival", soldOn: "2026-05-02", shared: ["camo "] }]);
  });
});
