/**
 * The cart, from any client component.
 *
 * A thin read over the module store (`src/lib/cart/store.ts`) via
 * `useSyncExternalStore` — React's primitive for state that lives outside
 * React. No provider, because there is one cart per browser and nothing to
 * scope it to.
 *
 * `count` is 0 until `ready`, which is what keeps the server's markup and the
 * browser's first render identical.
 */
"use client";

import { useSyncExternalStore } from "react";

import { cartCount, type Cart } from "@/lib/cart/cart";
import {
  addToCart,
  clearCart,
  getServerSnapshot,
  getSnapshot,
  removeFromCart,
  setCartQuantity,
  subscribe,
} from "@/lib/cart/store";

export type { CartArticle } from "@/lib/cart/store";

export function useCart(): {
  cart: Cart;
  /** Pieces in the cart. 0 until the stored cart has been read. */
  count: number;
  ready: boolean;
  add: typeof addToCart;
  setQuantity: typeof setCartQuantity;
  remove: typeof removeFromCart;
  clear: typeof clearCart;
} {
  const { cart, ready } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return {
    cart,
    count: ready ? cartCount(cart) : 0,
    ready,
    add: addToCart,
    setQuantity: setCartQuantity,
    remove: removeFromCart,
    clear: clearCart,
  };
}
