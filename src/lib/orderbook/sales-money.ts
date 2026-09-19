/**
 * How a sale's money is presented (ADR-0089).
 *
 * ONE PLACE FOR THE AGGREGATION RULES. The ledger row, the Details overlay and
 * the tests all read these; nothing recomputes what a payout is. The canonical
 * numbers still come from the database — `sale_expected_payout()` derives the
 * payout and these functions only group rows it already agrees with.
 *
 * THE WORKBOOK IS THE SEMANTIC SOURCE
 *
 * `Order 2026` kept the shipping label in two columns because the settlement
 * differs, and the owner reads them as one cost. The Excel payout formula is
 *
 *     U + V − W − AD − (X + AA + Y) + AB
 *
 * so `Z`, a label the owner paid outside the channel, reduces no payout while
 * `Y`, one the channel billed, does. That is a payout rule, not a display
 * rule: both are shipping-label cost and both belong in the `Label` total.
 * Splitting them on screen is the Details overlay's job.
 */

/** One `sale_fees` row, as `seller_sale()` returns it. */
export type FeeRow = {
  id: number | string;
  kind: string;
  label: string | null;
  amount: number;
  settled_by: string;
  note?: string | null;
};

export type RefundRow = {
  id: number | string;
  amount: number;
  occurred_at: string | null;
  reason: string | null;
  note?: string | null;
};

export type AdjustmentRow = {
  id: number | string;
  /** SIGNED: positive is a credit. */
  amount: number;
  reason: string | null;
  occurred_at: string | null;
  note?: string | null;
};

/** The only fee kind that is a shipping label. */
export const LABEL_KIND = "shipping_label";

/**
 * `Fees` — everything the sale cost that is NOT a shipping label.
 *
 * Excludes `shipping_label` in both settlement modes, so a label is never
 * counted in `Fees` and in `Label` at once. Settlement is irrelevant here: the
 * column is what the sale cost, not what the channel withheld.
 */
export const feesTotal = (fees: readonly FeeRow[]): number =>
  fees.filter((f) => f.kind !== LABEL_KIND).reduce((sum, f) => sum + Number(f.amount), 0);

/**
 * `Label` — the shipping-label cost, whoever settled it.
 *
 * A sale may carry more than one: the workbook has orders with a channel label
 * and an externally paid one, and both are real money.
 */
export const labelTotal = (fees: readonly FeeRow[]): number =>
  fees.filter((f) => f.kind === LABEL_KIND).reduce((sum, f) => sum + Number(f.amount), 0);

export const refundsTotal = (refunds: readonly RefundRow[]): number =>
  refunds.reduce((sum, r) => sum + Number(r.amount), 0);

/** Signed: credits raise the payout, debits lower it. */
export const adjustmentsTotal = (adjustments: readonly AdjustmentRow[]): number =>
  adjustments.reduce((sum, a) => sum + Number(a.amount), 0);

/*
 * `payoutCell` and `payoutDelta` lived here until ADR-0095.
 *
 * They existed for one workflow: the owner typed in what the marketplace had
 * actually paid, and the screen compared it against the computed figure. That
 * reconciliation is gone — the payout is DERIVED and nothing else — so a
 * helper whose whole job was "reported, or expected but flagged" has no
 * question left to answer.
 *
 * The formula itself is untouched: `plannedPayout` below, and
 * `sale_expected_payout()` in SQL.
 */

/**
 * Splits fees into the two groups the overlay shows separately.
 *
 * Order is preserved inside each group, so a sale with two labels lists them
 * as the workbook recorded them.
 */
export function groupFees(fees: readonly FeeRow[]): { charges: FeeRow[]; labels: FeeRow[] } {
  return {
    charges: fees.filter((f) => f.kind !== LABEL_KIND),
    labels: fees.filter((f) => f.kind === LABEL_KIND),
  };
}


/* =======================================================================
 * THE PAYOUT FORMULA ITSELF (moved here in 0065)
 *
 * It lived in `sales-import.ts` because the historical import was the first
 * thing that needed it. Two other callers need exactly the same arithmetic —
 * the external-sale form, which computes a payout for a sale that does not
 * exist yet, and the tests that reconstruct the workbook — and neither can
 * import the xlsx reader to get it.
 *
 * WHAT IT IS, in the workbook's own columns:
 *
 *     U + V − W − AD − (X + AA + Y) + AB
 *
 *     U   items_subtotal      what the buyer paid for the goods
 *     V   shipping_charged    what the buyer paid to receive them
 *     W   discount_amount     what we took off
 *     AD  refunds             what we gave back
 *     X   payment fee         ┐
 *     AA  marketplace fee     ├ fees the CHANNEL deducted
 *     Y   channel label       ┘
 *     Z   external label      a label bought at the post office — real money,
 *                             but it never passed through the channel, so it
 *                             cannot change what the channel owes
 *     AB  Fee S.              a signed credit; the workbook ADDS it
 *
 * `settled_by` is the whole of the Y/Z distinction, which is why there is no
 * separate column for either.
 *
 * THE DATABASE IS STILL THE AUTHORITY FOR A SALE THAT EXISTS.
 * `sale_expected_payout()` computes the identical expression in SQL, and the
 * detail screen reads it rather than recomputing — a rule `sales.test.ts`
 * enforces. This function is for the case where there is nothing to read
 * from yet: the create form, and the import preview.
 * ======================================================================= */

/** One planned `sale_fees` row. `settled_by` decides whether it reduces the payout. */
export type FeePlan = { kind: string; amount: number; settled_by: string; label?: string };
export type RefundPlan = { amount: number; note?: string };
/** SIGNED: positive is a credit that RAISES the payout. */
export type AdjustmentPlan = { amount: number; reason?: string; note?: string };

export function plannedPayout(
  subtotal: number, shipping: number, discount: number,
  fees: readonly FeePlan[], refunds: readonly RefundPlan[], adjustments: readonly AdjustmentPlan[],
): number {
  return subtotal + shipping - discount
    - refunds.reduce((s, r) => s + r.amount, 0)
    - fees.filter((f) => f.settled_by === "channel").reduce((s, f) => s + f.amount, 0)
    + adjustments.reduce((s, a) => s + a.amount, 0);
}

/**
 * The same number, rounded the way money is compared.
 *
 * Floating point makes `18.42` out of a sum that prints as `18.419999…`, and
 * a reconciliation screen that shows `Differenz -0,00 €` is worse than one
 * that shows nothing. Two decimals, once, at the boundary.
 */
export const roundMoney = (value: number): number => Math.round(value * 100) / 100;


/**
 * A typed amount, or `null` when it is not a number.
 *
 * German decimals, because the owner types `3,42`. An EMPTY field is zero,
 * not invalid: most of these inputs are optional and leaving one blank means
 * "there was none of this", which is a real answer and a common one.
 */
export function parseMoney(raw: string): number | null {
  const value = raw.trim().replace(",", ".");
  if (value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * The same, but a minus sign is meaningful.
 *
 * A settlement adjustment is signed by design: the workbook's `Fee S.` is a
 * credit on three orders and the reconciliation screen must be able to enter
 * a debit. Zero is returned as `0` and the caller drops the row —
 * `settlement_adjustments_amount_not_zero` refuses it anyway.
 */
export function parseSignedMoney(raw: string): number | null {
  const value = raw.trim().replace(",", ".");
  if (value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
