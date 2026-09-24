/**
 * Recording a repayment (ADR-0086).
 *
 * WHAT THIS DOES NOT DO: move money. Stripe is not called from here. The
 * operator issues the refund in Stripe — where the original payment lives, and
 * where a refund can actually be authorised — and records it here so the
 * order, the reports and the customer's own page agree about what happened.
 *
 * That split is deliberate rather than unfinished. A button in this product
 * that moved real money would need Stripe write credentials in a place that
 * has never held any (ADR-0051), and it would make a mis-click irreversible.
 * The provider's own refund id can be recorded alongside, which is what makes
 * the two records reconcilable.
 *
 * THE MONEY IS THE SUM OF THE EVENTS. `orders.payment_status` is updated to
 * `refunded` or `partially_refunded` so the operator's list reads correctly,
 * but every figure is computed from `order_refunds` (ADR-0083).
 */
"use server";

import { revalidatePath } from "next/cache";

import { canOperateSeller } from "@/lib/auth/capabilities";
import { de } from "@/lib/i18n/de";
import { allocationsValid, type RefundAllocation } from "@/lib/commerce/order-lines";
import { createClient } from "@/lib/supabase/server";

export type RefundResult = { ok: true; refundedTotal: string } | { ok: false; message: string };

export async function recordRefund(input: {
  orderNumber: string;
  amount: number;
  reason?: string;
  withdrawalId?: number;
  providerRefundId?: string;
  /**
   * What the amount was for (0095).
   *
   * Optional, and 1:n — a repayment may cover one position, a part of one,
   * several, the shipping or goodwill. Where it is given, the parts must add
   * up to the amount exactly; the database checks that again before it writes
   * anything, so a half-allocated refund cannot exist.
   */
  allocations?: readonly RefundAllocation[];
}): Promise<RefundResult> {
  if (!(await canOperateSeller())) return { ok: false, message: de.admin.notAllowed };

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, message: de.business.withdrawals.amountInvalid };
  }
  const allocations = input.allocations ?? [];
  if (!allocationsValid(allocations, input.amount)) {
    return { ok: false, message: de.business.withdrawals.allocationsInvalid };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_record_refund", {
    p_order_number: input.orderNumber,
    p_amount: input.amount,
    p_reason: input.reason?.trim() || null,
    p_withdrawal_id: input.withdrawalId ?? null,
    p_provider_refund_id: input.providerRefundId?.trim() || null,
    p_allocations: allocations.length === 0 ? null : allocations.map((one) => ({
      type: one.type,
      order_line_id: one.orderLineId,
      quantity: one.quantity,
      amount: one.amount,
    })),
  });

  if (error) {
    const code = error.code ?? "";
    if (code === "42501") return { ok: false, message: de.admin.notAllowed };
    // The database refuses more than was paid, and an order that was never
    // paid. Both are facts about the order, not faults.
    if (code === "22023") return { ok: false, message: de.business.withdrawals.refundRefused };
    return { ok: false, message: de.business.withdrawals.refundFailed };
  }

  const row = (data ?? {}) as Record<string, unknown>;

  revalidatePath("/business/widerrufe");
  revalidatePath(`/business/orders/${input.orderNumber}`);
  revalidatePath("/business/orders");
  return { ok: true, refundedTotal: String(row.refunded_total ?? "0") };
}
