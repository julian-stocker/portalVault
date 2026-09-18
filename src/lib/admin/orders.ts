/**
 * What the administration area knows about orders (B-Admin V1).
 *
 * Pure: no database, no React. The two decisions worth testing are here —
 * which orders demand attention, and whether one may be shipped — so both can
 * be exercised without a fixture.
 *
 * THE SHIPPING RULE IS A MIRROR, NOT THE BOUNDARY
 *
 * `admin_mark_order_shipped()` refuses an order that is unpaid, flagged or
 * already gone, and it refuses it whatever this file says. `canShip()` exists
 * so the interface can disable a button and name the reason in German instead
 * of surfacing a Postgres error — the same relationship `username.ts` has with
 * its CHECK constraint (ADR-0016).
 */

/** What `admin_orders()` returns, one row per order. */
export type AdminOrderRow = {
  order_number: string;
  placed_at: string;
  payment_status: string;
  fulfillment_status: string;
  needs_resolution: boolean;
  total_amount: string | number;
  line_count: number;
  customer_email: string;
  /** 0 flagged · 1 paid and unsent · 2 in flight · 3 settled. From SQL. */
  attention: number;
  /** Which world the order was placed in. Frozen at insert (ADR-0060). */
  commerce_mode: string;
};

/** The document `admin_order()` returns. */
export type AdminOrderDetail = {
  order: {
    order_number: string;
    placed_at: string;
    paid_at: string | null;
    shipped_at: string | null;
    payment_status: string;
    fulfillment_status: string;
    needs_resolution: boolean;
    customer_email: string;
    items_subtotal: string | number;
    shipping_amount: string | number;
    discount_amount: string | number;
    total_amount: string | number;
    shipping_method: string | null;
    /** The carrier the catalogue keys on — what a tracking link is built from. */
    shipping_method_code: string | null;
    tracking_number: string | null;
    is_guest: boolean;
    /** Which world the order was placed in. Never changes (ADR-0060). */
    commerce_mode: string;
    /** Sandbox only: have the return movements already been booked? */
    stock_reverted: boolean;
  };
  address: {
    first_name: string;
    last_name: string;
    company: string | null;
    street: string;
    house_number: string;
    address_line_2: string | null;
    postal_code: string;
    city: string;
    country_code: string;
    phone: string | null;
  } | null;
  lines: {
    sky_id: string;
    condition: string;
    name: string;
    quantity: number;
    unit_price: string | number;
    line_total: string | number;
  }[];
  events: {
    event_type: string;
    actor_kind: string;
    created_at: string;
    payload: Record<string, unknown>;
  }[];
  /**
   * Delivery state per mail, from `order_mail` (ADR-0059). Absent on an order
   * placed before 0019 and on one where no mail has been attempted — both are
   * an empty list, not a missing field.
   */
  mail: {
    kind: string;
    /** The EFFECTIVE state: a stale claim already reads as `unresolved`. */
    state: string;
    sent_at: string | null;
    attempts: number;
    last_error: string | null;
    updated_at: string | null;
  }[];
};

/* ------------------------------------------------------------- attention */

/** The four buckets `admin_orders()` sorts by, named. */
export type Attention = "needs_resolution" | "to_ship" | "in_flight" | "settled";

export function attentionOf(value: number): Attention {
  switch (value) {
    case 0:
      return "needs_resolution";
    case 1:
      return "to_ship";
    case 2:
      return "in_flight";
    default:
      return "settled";
  }
}

/** How much work is waiting, by kind. */
export type OpenOrderCounts = {
  /** Paid, nothing booked, shipping locked. The number that must be seen. */
  needsResolution: number;
  /** Paid and unsent. Ordinary work. */
  toShip: number;
  /**
   * Placed, not paid yet. Nobody has to do anything about it — but it is
   * open, and until 0024 it was counted nowhere and filtered out of the list
   * that calls itself "only open" (ADR-0063). A checkout that hangs because a
   * webhook never arrived looks exactly like this one.
   */
  inFlight: number;
};

export const NO_OPEN_ORDERS: OpenOrderCounts = { needsResolution: 0, toShip: 0, inFlight: 0 };

/*
 * `openOrderCounts(rows)` used to live here: it counted the three buckets out
 * of the rows `admin_orders(p_open_only => true)` returned.
 *
 * It was removed in 0045, and the reason is worth keeping. That call is capped
 * at 100 rows, so the badge was never a count of open orders — it was a count
 * of open orders *on the first page*. A shop with 130 needing attention said
 * 100, and would have gone on saying 100 as the number grew. Counting is not
 * listing: `seller_open_order_counts()` does it with an aggregate, with no cap
 * and with the same predicate (ADR-0082).
 */

/**
 * Is there anything for a person to do?
 *
 * Deliberately NOT the same question as "is anything open". A checkout in
 * flight is open and needs nobody; saying "you have work" about it would make
 * the sentence untrue every time somebody opens a basket. The wider set —
 * everything not settled — is what `p_open_only` returns, and it is
 * defined once, in SQL (ADR-0063).
 */
export function hasOpenWork(counts: OpenOrderCounts): boolean {
  return counts.needsResolution > 0 || counts.toShip > 0;
}

/* -------------------------------------------------------------- shipping */

/** Why an order cannot be shipped, or null when it can. */
export type ShipBlocker = "not_paid" | "needs_resolution" | "already_shipped";

/**
 * The same four conditions the database enforces, in the same order.
 *
 * `needs_resolution` is checked before the payment status on purpose: such an
 * order IS paid, and reporting "not paid" would send the operator looking for
 * the wrong thing. It is paid and nothing was booked — that is the message.
 */
export function shipBlocker(order: {
  payment_status: string;
  fulfillment_status: string;
  needs_resolution: boolean;
}): ShipBlocker | null {
  if (order.needs_resolution) return "needs_resolution";
  if (order.payment_status !== "paid") return "not_paid";
  /*
   * `shipped` is no longer a blocker (ADR-0074): the status control renders
   * the way back from it. Only the states with no workflow behind them —
   * `preparing`, `completed`, `cancelled` — still have nothing to offer.
   */
  if (order.fulfillment_status !== "unfulfilled" && order.fulfillment_status !== "shipped") {
    return "already_shipped";
  }
  return null;
}

export function canShip(order: {
  payment_status: string;
  fulfillment_status: string;
  needs_resolution: boolean;
}): boolean {
  return shipBlocker(order) === null;
}

/* -------------------------------------------------------- tracking input */

/** What the database will accept. Mirrors the CHECK in migration 0018. */
export const TRACKING_MAX_LENGTH = 64;

/**
 * A pasted tracking number, as it should be stored — or null.
 *
 * Trimming here is not the "do not correct names" rule from CLAUDE.md: that
 * one protects article and category names, which carry meaning from the
 * legacy source. Whitespace around a carrier reference is a paste artefact and
 * nothing else. Beyond the trim the value is stored exactly as issued: no
 * upper-casing, no dash removal, no carrier detection.
 */
export function normaliseTracking(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

export function trackingTooLong(value: string | null): boolean {
  return value !== null && value.length > TRACKING_MAX_LENGTH;
}
