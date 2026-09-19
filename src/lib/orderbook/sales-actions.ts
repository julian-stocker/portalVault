/**
 * Writing the Verkauf (ADR-0089).
 *
 * Every one is a thin pass-through to a seller-gated function. The checks here
 * are a courtesy so a denied click gets a sentence instead of a stack trace;
 * the database is what actually refuses.
 */
"use server";

import { revalidatePath } from "next/cache";

import { canOperateSeller } from "@/lib/auth/capabilities";
import { de } from "@/lib/i18n/de";
import { createClient } from "@/lib/supabase/server";

export type Result = { ok: true } | { ok: false; message: string };
const copy = de.business.sales;

const paths = (id?: number) =>
  id ? ["/business/orderbuch/verkauf", `/business/orderbuch/verkauf/${id}`]
     : ["/business/orderbuch/verkauf"];

/**
 * The database's refusals, in German.
 *
 * These are rules, not faults: the operator is being told what to do next, so
 * a generic "could not be saved" would throw away an explanation the function
 * already wrote.
 */
function message(error: { code?: string; message?: string }): string {
  const text = error.message ?? "";
  if (error.code === "42501") return de.admin.notAllowed;
  if (text.includes("below its reserved")) return copy.errors.reserved;
  if (text.includes("no stock position")) return copy.errors.noStock;
  if (text.includes("not a catalog figure")) return copy.errors.notAFigure;
  if (text.includes("historical sales never move stock")) return copy.errors.historical;
  if (text.includes("mark the item as returned")) return copy.errors.returnFirst;
  if (text.includes("never left stock")) return copy.errors.neverBooked;
  if (text.includes("already restocked")) return copy.errors.alreadyRestocked;
  if (text.includes("belong to the order") || text.includes("owns its shipping")
      || text.includes("takes its items from the order") || text.includes("belong to commerce")
      || text.includes("takes its date from the order")) return copy.errors.commerceOwned;
  if (text.includes("a fee is a positive amount")) return copy.errors.positiveFee;
  if (text.includes("stock movements; reverse them first")) return copy.errors.hasMovements;
  if (text.includes("booked out; reverse")) return copy.errors.itemBooked;
  if (text.includes("created from a paid order")) return copy.errors.internalAutomatic;
  if (text.includes("test status from the order")) return copy.errors.internalTestDerived;
  if (text.includes("outside the plausible range")) return copy.errors.dateRange;
  // 0065. Distinct from `historical sales never move stock`, which is about
  // booking: these are about editing or deleting one imported line.
  if (text.includes("legacy workbook")) return copy.errors.historicalItem;
  if (text.includes("part of that record")) return copy.errors.bookedItem;
  if (text.includes("too many items, fees or adjustments")) return copy.errors.tooMany;
  return de.admin.writeFailed;
}

async function run(fn: string, args: Record<string, unknown>, id?: number): Promise<Result> {
  if (!(await canOperateSeller())) return { ok: false, message: de.admin.notAllowed };
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: message(error) };
  for (const p of paths(id)) revalidatePath(p);
  return { ok: true };
}

export async function createSale(
  channel: string, soldAt: string | null, country: string | null,
  externalRef: string | null, buyerRef: string | null, note: string | null,
  isTest = false,
): Promise<{ ok: true; id: number } | { ok: false; message: string }> {
  if (!(await canOperateSeller())) return { ok: false, message: de.admin.notAllowed };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_create_sale", {
    p_channel: channel, p_sold_at: soldAt, p_country: country,
    p_external_ref: externalRef, p_buyer_ref: buyerRef, p_note: note,
    p_is_test: isTest,
  });
  if (error || typeof data !== "number") return { ok: false, message: message(error ?? {}) };
  revalidatePath("/business/orderbuch/verkauf");
  return { ok: true, id: data };
}

/**
 * Marking an external sale as a test, or taking the mark away (0063).
 *
 * Refused outright for an internal sale: that answer belongs to the order and
 * `orders.commerce_mode` is frozen, so there is nothing here to change.
 *
 * `expectedUpdatedAt` is 0062's concurrency token. Passing it means an edit
 * made against a sale somebody else has since corrected is refused rather than
 * silently winning.
 */
export async function setSaleTest(
  id: number, isTest: boolean, expectedUpdatedAt?: string | null,
): Promise<Result> {
  return run("seller_set_sale_test", {
    p_id: id, p_is_test: isTest, p_expected_updated_at: expectedUpdatedAt ?? null,
  }, id);
}

export async function updateSaleAmounts(id: number, subtotal: number, shipping: number, discount: number) {
  return run("seller_update_sale", { p_id: id, p_items_subtotal: subtotal,
    p_shipping_charged: shipping, p_discount_amount: discount }, id);
}

/**
 * Set, correct or clear an external sale date.
 *
 * `expectedUpdatedAt` is the row's own `updated_at`, read when the editor was
 * opened. The database compares it and refuses if someone else has since
 * changed the sale — so the second of two tabs is told rather than winning.
 */
export async function setSaleDate(
  id: number, soldAt: string | null, expectedUpdatedAt?: string | null,
) {
  return run("seller_set_sale_date",
    { p_id: id, p_sold_at: soldAt, p_expected_updated_at: expectedUpdatedAt ?? null }, id);
}

/**
 * The operational metadata of an external sale.
 *
 * Deliberately not the money: `items_subtotal`, `shipping_charged` and
 * `discount_amount` have their own action, and for an internal sale the
 * database refuses all of it.
 */
export async function updateSaleMeta(
  id: number,
  fields: { country?: string | null; buyerRef?: string | null;
            externalRef?: string | null; note?: string | null },
  expectedUpdatedAt?: string | null,
) {
  return run("seller_update_sale", {
    p_id: id,
    p_country: fields.country ?? null,
    p_buyer_ref: fields.buyerRef ?? null,
    p_external_ref: fields.externalRef ?? null,
    p_note: fields.note ?? null,
    p_expected_updated_at: expectedUpdatedAt ?? null,
  }, id);
}

export async function setSaleShipped(id: number, shipped: boolean) {
  return run("seller_set_sale_shipped", { p_id: id, p_shipped: shipped }, id);
}

/**
 * Creating an external sale whole (0065, ADR-0092).
 *
 * ONE CALL, ONE TRANSACTION. The old path was `seller_create_sale`, then a
 * second call for the amounts, then the fees and the payout in Details —
 * each its own transaction, and its own chance to leave a sale whose money
 * is half entered. The reconciliation is the point of this screen, so a
 * half-entered sale is not a cosmetic problem: it compares a reported payout
 * against a figure that is missing two fees.
 *
 * `items` is one element per physical unit; duplicates are expected. Nothing
 * here moves stock — `Ausbuchen` on the individual item still does that, and
 * only that.
 */
export async function createSaleWithDetails(input: {
  channel: string;
  soldAt: string | null;
  country: string | null;
  reference: string | null;
  buyer: string | null;
  note: string | null;
  isTest: boolean;
  subtotal: number;
  shipping: number;
  discount: number;
  items: readonly { sky_id: string }[];
  fees: readonly { kind: string; amount: number; settled_by: string; label?: string }[];
  adjustments: readonly { amount: number; reason?: string; note?: string }[];
}) {
  if (!(await canOperateSeller())) return { ok: false as const, message: de.admin.notAllowed };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_create_sale_with_details", {
    p_channel: input.channel,
    p_sold_at: input.soldAt,
    p_country: input.country,
    p_external_ref: input.reference,
    p_buyer_ref: input.buyer,
    p_note: input.note,
    p_is_test: input.isTest,
    p_items_subtotal: input.subtotal,
    p_shipping_charged: input.shipping,
    p_discount_amount: input.discount,
    p_items: input.items,
    p_fees: input.fees,
    p_adjustments: input.adjustments,
    /*
     * No reported payout at creation (ADR-0095). The RPC still accepts one —
     * dropping the parameter would cost a migration for nothing — but the
     * payout is derived from the sale's own figures now, so there is nothing
     * to record. `seller_create_sale_with_details` skips the write when this
     * is null.
     */
    p_payout_amount: null,
    p_payout_ref: null,
  });
  if (error || typeof data !== "number") {
    return { ok: false as const, message: message(error ?? {}) };
  }
  revalidatePath("/business/orderbuch/verkauf");
  return { ok: true as const, id: data };
}

/**
 * Correcting which figure a sale item is (0065).
 *
 * Only for a hand-made, unbooked, unreturned line. The database refuses the
 * rest — an internal sale's item, anything with a stock movement, and every
 * imported line — and the screen hides the control in those cases rather
 * than offering a click that can only end in a refusal.
 */
export async function setSaleItemSky(itemId: number, skyId: string, saleId: number) {
  return run("seller_set_sale_item_sky", { p_item_id: itemId, p_sky_id: skyId }, saleId);
}

export async function addSaleItem(saleId: number, skyId: string | null, rawName: string | null, condition: string) {
  return run("seller_add_sale_item", { p_sale_id: saleId, p_sky_id: skyId,
    p_raw_name: rawName, p_condition: condition }, saleId);
}

export async function removeSaleItem(itemId: number, saleId: number) {
  return run("seller_remove_sale_item", { p_item_id: itemId }, saleId);
}

/* Stock. Never optimistic: the row changes when the database says it changed. */
export async function bookSaleItem(itemId: number, saleId: number) {
  return run("seller_book_sale_item", { p_item_id: itemId }, saleId);
}
export async function unbookSaleItem(itemId: number, saleId: number) {
  return run("seller_unbook_sale_item", { p_item_id: itemId }, saleId);
}
export async function returnSaleItem(itemId: number, saleId: number, returned: boolean) {
  return run("seller_return_sale_item", { p_item_id: itemId, p_returned: returned }, saleId);
}
export async function restockSaleItem(itemId: number, saleId: number) {
  return run("seller_restock_sale_item", { p_item_id: itemId }, saleId);
}

export async function addSaleFee(
  saleId: number, kind: string, amount: number, settledBy: string, label: string | null,
) {
  return run("seller_add_sale_fee", { p_sale_id: saleId, p_kind: kind, p_amount: amount,
    p_settled_by: settledBy, p_label: label }, saleId);
}
/**
 * Correct a fee in place. `null` leaves a field alone.
 *
 * Mutation rather than a reversing entry, because a fee is constrained to a
 * positive amount and a credit is a settlement adjustment — there is no way to
 * express "this was 2,34 and should be 2,43" as a second fee row. What it said
 * before is kept in the audit trail instead.
 */
export async function updateSaleFee(
  feeId: number, saleId: number,
  fields: { kind?: string | null; amount?: number | null;
            settledBy?: string | null; label?: string | null },
  expectedUpdatedAt?: string | null,
) {
  return run("seller_update_sale_fee", {
    p_fee_id: feeId, p_kind: fields.kind ?? null, p_amount: fields.amount ?? null,
    p_settled_by: fields.settledBy ?? null, p_label: fields.label ?? null,
    p_expected_updated_at: expectedUpdatedAt ?? null,
  }, saleId);
}

export async function removeSaleFee(feeId: number, saleId: number) {
  return run("seller_remove_sale_fee", { p_fee_id: feeId }, saleId);
}

export async function addSaleRefund(
  saleId: number, amount: number, occurredAt: string | null, reason: string | null, note: string | null,
) {
  return run("seller_add_sale_refund", { p_sale_id: saleId, p_amount: amount,
    p_occurred_at: occurredAt, p_reason: reason, p_note: note }, saleId);
}
/** Correct a refund event. Money only — it says nothing about goods. */
export async function updateSaleRefund(
  refundId: number, saleId: number,
  fields: { amount?: number | null; occurredAt?: string | null; reason?: string | null },
  expectedUpdatedAt?: string | null,
) {
  return run("seller_update_sale_refund", {
    p_refund_id: refundId, p_amount: fields.amount ?? null,
    p_occurred_at: fields.occurredAt ?? null, p_reason: fields.reason ?? null,
    p_expected_updated_at: expectedUpdatedAt ?? null,
  }, saleId);
}

export async function removeSaleRefund(refundId: number, saleId: number) {
  return run("seller_remove_sale_refund", { p_refund_id: refundId }, saleId);
}

/*
 * `setSalePayout` was removed in ADR-0095 with the settlement workflow it
 * served. `seller_set_sale_payout` still exists in the database and the
 * three `reported_payout_*` columns still hold what was recorded before —
 * nothing was deleted — but no screen writes them any more.
 */


/** Every recorded correction to one sale, newest first. */
export async function loadSaleAudit(id: number): Promise<Record<string, unknown>[]> {
  if (!(await canOperateSeller())) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_sale_audit", { p_sale_id: id });
  if (error || !Array.isArray(data)) return [];
  return data as Record<string, unknown>[];
}

/**
 * A settlement correction, entered as a magnitude plus a direction.
 *
 * The database column is signed; the owner should never have to know that.
 */
export async function addAdjustment(
  saleId: number, channel: string, kind: "credit" | "debit", amount: number,
  reason: string | null, note: string | null,
) {
  return run("seller_add_settlement_adjustment", {
    p_sale_id: saleId, p_channel: channel,
    p_amount: kind === "credit" ? Math.abs(amount) : -Math.abs(amount),
    p_reason: reason, p_note: note,
  }, saleId);
}

/** The items of one sale, fetched when its row is expanded. */
export async function loadSale(id: number): Promise<Record<string, unknown> | null> {
  if (!(await canOperateSeller())) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_sale", { p_id: id });
  return error ? null : (data as Record<string, unknown>);
}
