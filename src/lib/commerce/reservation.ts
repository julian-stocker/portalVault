/**
 * Reserved stock, as the application knows it.
 *
 * The rules are in the database (migration 0010) and stay there: holding stock
 * is a decision that has to be made under a row lock, and no amount of care in
 * TypeScript can substitute for that. What lives here is the vocabulary, and
 * one number that must not be allowed to drift.
 *
 * WHY THE CART STILL RESERVES NOTHING
 *
 * Adding something to the cart holds no stock and never has (ADR-0043). V11
 * added `shop_quantity_available()`, which asks whether a quantity *would* be
 * possible — a statement about this moment, not a promise. Reserving begins at
 * checkout and nowhere else.
 */

/**
 * How long a checkout may hold stock.
 *
 * The authority is `public.reservation_ttl()`; this is a mirror so the
 * interface can say "20 Minuten" without a round trip.
 * `src/lib/commerce/schema.test.ts` reads the migration and fails if the two
 * disagree — the same coupling `MAX_LINE_QUANTITY` has with
 * `max_cart_quantity()`.
 *
 * Long enough for a PayPal detour or a banking app with two-factor
 * confirmation; short enough that a one-of-a-kind figure is not withheld from
 * everybody else for half an hour after somebody wandered off. Most used
 * Skylanders exist exactly once, which is what makes the upper bound matter
 * more than the lower one.
 *
 * **The server sets `expires_at`, always.** A client that could choose its own
 * expiry could hold stock indefinitely.
 */
export const RESERVATION_TTL_MINUTES = 20;

/**
 * Three states, mirrored from the CHECK constraint in 0010.
 *
 *   active     holds stock; `shop_inventory.reserved` counts it
 *   released   gave it back — expired, cancelled or failed
 *   converted  became a sale; the stock left the shelf for good
 *
 * Both terminal states hold nothing. A released reservation is kept rather
 * than deleted: it is the explanation for a number that changed.
 */
export const RESERVATION_STATES = ["active", "released", "converted"] as const;

export type ReservationState = (typeof RESERVATION_STATES)[number];

/** Does a reservation in this state hold stock right now? */
export function holdsStock(state: ReservationState): boolean {
  return state === "active";
}

/**
 * When a reservation created now would run out.
 *
 * Mirrors what the database computes. Used for display and for tests, never
 * as the value that is stored — `reserve_for_order()` sets `expires_at` from
 * `reservation_ttl()` itself.
 */
export function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + RESERVATION_TTL_MINUTES * 60_000);
}
