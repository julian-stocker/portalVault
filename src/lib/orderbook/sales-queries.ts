/**
 * Reading the Verkauf ledger (ADR-0089).
 *
 * Seller-gated twice, like the Einkauf reader: once here so a route can answer
 * before querying, and again inside every function, which is the boundary.
 */
import { cache } from "react";

import { canOperateSeller } from "@/lib/auth/capabilities";
import { createClient } from "@/lib/supabase/server";
import {
  EMPTY_COUNTS, readCounts, type ClassificationCounts, type StatusScope,
} from "./classification";
import { rpcScope, sortSales, type SaleScope } from "./sales-view";

export type SaleRow = {
  id: number;
  channel: string;
  orderId: number | null;
  orderNumber: string | null;
  soldAt: string | null;
  shippedAt: string | null;
  paymentStatus: string | null;
  fulfillmentStatus: string | null;
  country: string | null;
  itemCount: number;
  itemsSubtotal: number | null;
  shippingCharged: number | null;
  discountAmount: number | null;
  refunded: number;
  /** Every fee that is not a shipping label (0062). */
  feesTotal: number;
  /** Every shipping label, whoever settled it (0062). */
  labelTotal: number;
  expectedPayout: number | null;
  buyerRef: string | null;
  externalOrderRef: string | null;
  source: string;
  note: string | null;
  /** The optimistic-concurrency token an edit reads and sends back (0062). */
  updatedAt: string | null;
  /** A test transaction — the operator's flag, or the order's sandbox mode (0063). */
  isTest: boolean;
  /** Still needs work. Derived; never a stored column (0063). */
  isIncomplete: boolean;
  /** A physical booking is still owed — `Ausbuchen` would accept it (0066). */
  isOpen: boolean;
  matchItems: { id: number; position: number; name: string }[];
};

export type SalesSummary = {
  saleCount: number; itemCount: number; gross: number; refunded: number;
  feesTotal: number; labelTotal: number;
  expectedPayout: number;
};

const EMPTY: SalesSummary = {
  saleCount: 0, itemCount: 0, gross: 0, refunded: 0, feesTotal: 0, labelTotal: 0,
  expectedPayout: 0,
};

const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const maybe = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export const fetchSales = cache(async (
  scope: SaleScope, year?: number | "ohne", month?: number, search?: string,
  status: StatusScope = "normal",
): Promise<{ sales: SaleRow[]; summary: SalesSummary; counts: ClassificationCounts }> => {
  const empty = { sales: [], summary: EMPTY, counts: EMPTY_COUNTS };
  if (!(await canOperateSeller())) return empty;
  const supabase = await createClient();
  const undated = year === "ohne";
  const { data, error } = await supabase.rpc("seller_sales", {
    p_year: undated ? null : year ?? null,
    p_month: undated ? null : month ?? null,
    p_search: search ?? null,
    p_undated: undated,
    // The two axes, side by side and independent: `bereich` decides where the
    // sale happened, `status` what kind of record it is.
    p_scope: rpcScope(scope),
    /*
     * Still sent, still false. The parameter survives in `seller_sales`
     * because dropping it would cost a migration for nothing; no screen has
     * offered the filter since ADR-0095.
     */
    p_open_payout: false,
    p_status: status,
  });
  if (error || data === null || typeof data !== "object") return empty;

  const root = data as Record<string, unknown>;
  const s = (root.summary ?? {}) as Record<string, unknown>;
  const sales = (Array.isArray(root.sales) ? root.sales : []).map((raw) => {
    const r = raw as Record<string, unknown>;
    return {
      id: Number(r.id), channel: String(r.channel),
      orderId: r.order_id === null ? null : Number(r.order_id),
      orderNumber: (r.order_number as string) ?? null,
      soldAt: r.sold_at === null || r.sold_at === undefined ? null : String(r.sold_at),
      shippedAt: (r.shipped_at as string) ?? null,
      paymentStatus: (r.payment_status as string) ?? null,
      fulfillmentStatus: (r.fulfillment_status as string) ?? null,
      country: (r.country as string) ?? null,
      itemCount: n(r.item_count),
      itemsSubtotal: maybe(r.items_subtotal),
      shippingCharged: maybe(r.shipping_charged),
      discountAmount: maybe(r.discount_amount),
      refunded: n(r.refunded),
      feesTotal: n(r.fees_total),
      labelTotal: n(r.label_total),
      expectedPayout: maybe(r.expected_payout),
      buyerRef: (r.buyer_ref as string) ?? null,
      externalOrderRef: (r.external_order_ref as string) ?? null,
      source: String(r.source),
      updatedAt: r.updated_at === null || r.updated_at === undefined ? null : String(r.updated_at),
      isTest: r.is_test === true,
      isIncomplete: r.is_incomplete === true,
      isOpen: r.is_open === true,
      note: (r.note as string) ?? null,
      matchItems: (Array.isArray(r.match_items) ? r.match_items : []).map((m) => {
        const i = m as Record<string, unknown>;
        return { id: Number(i.id), position: Number(i.position), name: String(i.name ?? "") };
      }),
    };
  });

  return {
    // The database ordered it; sorting again is the guarantee the screen never
    // inherits an accidental order.
    sales: sortSales(sales),
    summary: {
      saleCount: n(s.sale_count), itemCount: n(s.item_count), gross: n(s.gross),
      refunded: n(s.refunded), feesTotal: n(s.fees_total), labelTotal: n(s.label_total),
      expectedPayout: n(s.expected_payout),
    },
    counts: readCounts(root.classification),
  };
});

/** One sale with everything hanging off it — items or order lines, fees, refunds. */
export const fetchSale = cache(async (id: number): Promise<Record<string, unknown> | null> => {
  if (!(await canOperateSeller())) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_sale", { p_id: id });
  if (error || data === null || typeof data !== "object") return null;
  return data as Record<string, unknown>;
});

/**
 * Years that actually have sales, for the filter.
 *
 * `any`, not the default `normal`: the year chips have to offer a year whose
 * only sales are tests, otherwise choosing Test would empty the list that was
 * supposed to lead to them.
 */
export const fetchSaleYears = cache(async (): Promise<number[]> => {
  const { sales } = await fetchSales("extern", undefined, undefined, undefined, "any");
  const internal = await fetchSales("intern", undefined, undefined, undefined, "any");
  return [...new Set([...sales, ...internal.sales]
    .filter((s): s is SaleRow & { soldAt: string } => s.soldAt !== null)
    .map((s) => Number(s.soldAt.slice(0, 4))))].sort((a, b) => b - a);
});
