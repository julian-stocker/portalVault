/**
 * The 0180 rules the screen applies early (`decide.ts`). The database stays
 * the judge; these must never let more through than 0180 allows, and their
 * early reasons must be 0180's own codes.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { allowed0180, changeValues, expectedBlock, TAKEABLE_FIELDS } from "./decide";
import { SELECTION_FIELDS, SELECTION_PROBLEMS } from "./selection";
import type { Match } from "./view";

const MIGRATION = readFileSync("supabase/migrations/0180_sales_recon_selected_apply.sql", "utf8");

const current = (over: Record<string, unknown> = {}) => ({
  soldOn: "2026-01-14", itemsSubtotal: 12.5, discount: 0, itemsNet: 12.5, shipping: 4.99, refundsTotal: 0,
  cancelledOn: null, expectedTotal: 17.49, pieces: 1, externalOrderRef: null, isTest: false, ...over,
});
const match = (certainty: Match["certainty"], over: Record<string, unknown> = {}): Pick<Match, "category" | "certainty" | "ledger"> => ({
  category: "deviating", certainty,
  ledger: { state: "unchanged", version: { analysed: null, current: null }, current: current(over),
    atAnalysis: {} as NonNullable<Match["ledger"]>["atAnalysis"] },
});

describe("the offer is 0180's, never more", () => {
  it("the four takeable fields are 0180's whitelist", () => {
    expect([...TAKEABLE_FIELDS].sort()).toEqual([...SELECTION_FIELDS].sort());
    expect(MIGRATION).toContain("when p_field in ('sold_on', 'items_net', 'shipping', 'external_order_ref')\n      then array['take_external', 'keep_ledger', 'defer']");
    expect(MIGRATION).toContain("when p_field in ('total', 'pieces', 'figure')\n      then array['keep_ledger', 'defer']");
    expect(allowed0180("total")).toEqual(["keep_ledger", "defer"]);
  });
});

describe("early reasons are 0180's codes", () => {
  it("each code is one the preview itself gives", () => {
    const codes = [
      expectedBlock(match("deterministic", { isTest: true }), { field: "sold_on" }),
      expectedBlock(match("deterministic", { cancelledOn: "2026-01-20" }), { field: "sold_on" }),
      expectedBlock(match("deterministic", { refundsTotal: 3 }), { field: "shipping" }),
      expectedBlock(match("probable"), { field: "sold_on" }),
      expectedBlock(match("unique"), { field: "items_net" }),
      expectedBlock(match("deterministic"), { field: "total" }),
    ];
    expect(codes).toEqual(["test_sale", "cancelled", "refunded", "uncertain", "unique_ref_only", "field_not_takeable"]);
    for (const c of codes) expect(SELECTION_PROBLEMS).toContain(c);
  });

  it("a refund blocks amounts, not the day or the order number; unique allows the number only", () => {
    expect(expectedBlock(match("deterministic", { refundsTotal: 3 }), { field: "sold_on" })).toBeNull();
    expect(expectedBlock(match("unique", { refundsTotal: 3 }), { field: "external_order_ref" })).toBeNull();
    expect(expectedBlock(match("deterministic"), { field: "items_net" })).toBeNull();
  });
});

describe("the preview's values", () => {
  it("reads old and new by the field's key", () => {
    expect(changeValues({ field: "items_net", old: { itemsNet: 10, discount: 2 }, target: { itemsNet: 12 } })).toEqual({ old: 10, target: 12 });
    expect(changeValues({ field: "external_order_ref", old: { externalOrderRef: null }, target: { externalOrderRef: "x" } }))
      .toEqual({ old: null, target: "x" });
    expect(changeValues({ field: null, old: null, target: null })).toEqual({ old: null, target: null });
  });
});
