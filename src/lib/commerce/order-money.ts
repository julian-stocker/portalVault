/**
 * What the buyer paid, and what is left of it (0096).
 *
 * THE TWO QUESTIONS ARE NOT THE SAME ONE, which is why the screen asks them
 * separately. „Vom Käufer bezahlt" is a fact about the customer's money and
 * the only thing a refund may touch. „Verkaufserlös" is a fact about this
 * business: the same money minus what selling it cost. Printing one number
 * called „Bestellwert" answered neither.
 *
 * WHAT IS NOT IN HERE.
 *
 * A CANCELLATION IS NOT A REFUND. `order_line_events` says what happened to
 * the goods; `order_refunds` says what happened to the money, and only the
 * second one appears below. A cancelled position that has not been repaid is
 * still the customer's money sitting here — which is exactly what the
 * operator needs to see.
 *
 * A REFUND IS NOT A STOCK EVENT either. Nothing in this module reads or
 * changes inventory.
 *
 * THE DISCOUNT IS SUBTRACTED ONCE. It is already gone from what the customer
 * transferred, so it belongs in block A and nowhere else. Taking it off the
 * proceeds as well would charge this business for it twice.
 *
 * WHERE THE COSTS COME FROM. `sale_fees` — the model 0059 introduced and the
 * Orderbuch has used ever since, `kind in ('payment','marketplace','other')`
 * for fees and `'shipping_label'` for the label. Nothing is estimated and no
 * cost is invented: an order with no recorded fees shows none.
 *
 * RELATION TO `sale_expected_payout()`: the same shape, one deliberate
 * difference. That function answers "what will the channel transfer", so it
 * counts only fees the channel itself deducts (`settled_by = 'channel'`) and
 * adds `settlement_adjustments`. This answers "what did this order earn", so
 * every recorded cost counts, however it was paid.
 *
 * INTEGER CENTS THROUGHOUT, as everywhere money is added in this codebase.
 */

/** The fee kinds `sale_fees` knows, split the way the screen shows them. */
export const FEE_KINDS = ["payment", "marketplace", "other"] as const;
export const LABEL_KIND = "shipping_label";

/* `amount` is `unknown` on purpose: a Postgres `numeric` arrives as a string
   over PostgREST, and coercing it at the edge is what `cents()` is for. */
export type OrderCost = { kind: string; amount: unknown };

export type OrderMoney = {
  itemsSubtotal: number;
  shippingAmount: number;
  discountAmount: number;
  /** Zwischensumme + Versand − Rabatt. What the customer actually transferred. */
  buyerPaid: number;
  /** The sum of every documented repayment. Several refunds add up. */
  refunded: number;
  /** buyerPaid − refunded. */
  remaining: number;
  fees: number;
  shippingLabel: number;
  /** fees + shippingLabel. */
  costs: number;
  /** remaining − costs. May be negative when the costs exceed what is left. */
  proceeds: number;
};

const cents = (value: unknown): number => {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  /* Half away from zero, like round(numeric, 2) in Postgres. */
  return n < 0 ? -Math.round(-n * 100) : Math.round(n * 100);
};

export function orderMoney(input: {
  itemsSubtotal: unknown;
  shippingAmount: unknown;
  discountAmount: unknown;
  /** One entry per `order_refunds` row. Partial refunds add up. */
  refunds: readonly { amount: unknown }[];
  /** One entry per `sale_fees` row of the sale this order belongs to. */
  costs: readonly OrderCost[];
}): OrderMoney {
  const subtotal = cents(input.itemsSubtotal);
  const shipping = cents(input.shippingAmount);
  const discount = cents(input.discountAmount);
  const paid = subtotal + shipping - discount;

  let refunded = 0;
  for (const one of input.refunds) refunded += Math.max(0, cents(one.amount));

  let fees = 0;
  let label = 0;
  for (const one of input.costs) {
    const amount = Math.max(0, cents(one.amount));
    if (one.kind === LABEL_KIND) label += amount;
    else fees += amount;
  }

  const remaining = paid - refunded;
  const costs = fees + label;
  const euro = (c: number) => c / 100;

  return {
    itemsSubtotal: euro(subtotal),
    shippingAmount: euro(shipping),
    discountAmount: euro(discount),
    buyerPaid: euro(paid),
    refunded: euro(refunded),
    remaining: euro(remaining),
    fees: euro(fees),
    shippingLabel: euro(label),
    costs: euro(costs),
    proceeds: euro(remaining - costs),
  };
}
