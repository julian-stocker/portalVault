/**
 * Shipping, as the application knows it: which methods exist, and nothing else.
 *
 * **No price appears in this file.** The rule — 5,49 € for Hermes, 6,49 € for
 * DHL, free from 75 € of goods — lives in migration 0011 and only there, in
 * `shipping_amount_for()`. `create_order()` charges what that function
 * returns, and the checkout displays what the same function returns through
 * `shipping_quote()`. A price mirrored here could drift from the one actually
 * charged, and the customer would be shown one number and billed another.
 *
 * What does live here is the vocabulary: the two codes a browser may name.
 * `src/lib/commerce/shipping.test.ts` reads the migration and fails if the
 * list stops matching the catalog — the same coupling `MAX_LINE_QUANTITY` has
 * with `max_cart_quantity()`.
 *
 * V1 delivers to Germany only. That is enforced in `create_order()`, not here:
 * a checkout that posts another country is refused by the database rather than
 * quietly charged German postage.
 */

export const SHIPPING_METHODS = ["hermes", "dhl"] as const;

export type ShippingMethod = (typeof SHIPPING_METHODS)[number];

/** Preselected at checkout. The cheaper of the two. */
export const DEFAULT_SHIPPING_METHOD: ShippingMethod = "hermes";

/** The only country V1 ships to. */
export const DELIVERY_COUNTRY = "DE";

export function isShippingMethod(value: unknown): value is ShippingMethod {
  return typeof value === "string" && (SHIPPING_METHODS as readonly string[]).includes(value);
}

/**
 * One row of what the checkout shows: a method, its name, and what this
 * basket would actually pay for it.
 *
 * `amount` is display only. The order is charged whatever `create_order()`
 * computes from the goods value it worked out itself — a tampered subtotal
 * changes what is shown and cannot change what is billed.
 */
export type ShippingOption = {
  code: ShippingMethod;
  name: string;
  amount: number;
  isDefault: boolean;
};
