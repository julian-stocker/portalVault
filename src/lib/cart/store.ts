/**
 * Where the cart actually lives.
 *
 * A module-level store rather than a React context, because there is exactly
 * one cart in a browser and it belongs to the browser, not to a subtree. Two
 * consequences follow, and both are the point:
 *
 *   - the header badge and /cart read the same value with no provider
 *     between them, so they cannot disagree
 *   - `localStorage` is subscribed to, so a second tab that changes the cart
 *     updates this one. It is one cart per browser, not one per tab.
 *
 * Read through `useSyncExternalStore` (see `use-cart.ts`), which is React's
 * primitive for exactly this: an external source of truth with a server
 * snapshot. The server snapshot is the empty cart — the server cannot know
 * what is in `localStorage`, and rendering a guess would be a hydration
 * mismatch and a flickering badge.
 *
 * Nothing here reaches the database (ADR-0043). The cart writes no table,
 * books no movement and reserves no stock.
 */
import {
  addLine,
  CART_STORAGE_KEY,
  decodeCart,
  encodeCart,
  EMPTY_CART,
  removeLine,
  setLineQuantity,
  type Cart,
} from "@/lib/cart/cart";
import type { OfferCondition } from "@/lib/shop/offer";

/** What can be put in the cart: one article, at the price it is offered for. */
export type CartArticle = {
  skyId: string;
  condition: OfferCondition;
  name: string;
  imageFile: string | null;
  price: number;
};

/**
 * The snapshot React compares by identity, so it is replaced on change and
 * never mutated.
 *
 * `ready` is false until storage has been read once. Anything that displays
 * a number waits for it; otherwise the first browser render would differ
 * from the server's.
 */
export type CartSnapshot = { cart: Cart; ready: boolean };

const EMPTY: CartSnapshot = { cart: EMPTY_CART, ready: false };
const SERVER: CartSnapshot = EMPTY;

let snapshot: CartSnapshot = EMPTY;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function read(): Cart {
  try {
    return decodeCart(window.localStorage.getItem(CART_STORAGE_KEY));
  } catch {
    // Private mode, or storage disabled. An empty cart is the honest answer.
    return EMPTY_CART;
  }
}

function publish(cart: Cart): void {
  snapshot = { cart, ready: true };
  emit();
}

/** Another tab changed the cart. Same browser, same cart. */
function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== CART_STORAGE_KEY) return;
  publish(read());
}

export function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    window.addEventListener("storage", onStorage);
    // The first read happens here rather than at module scope: this runs
    // after mount, in the browser, which is the only place `window` exists.
    publish(read());
  }
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function getSnapshot(): CartSnapshot {
  return snapshot;
}

export function getServerSnapshot(): CartSnapshot {
  return SERVER;
}

function change(next: (cart: Cart) => Cart): void {
  const cart = next(snapshot.cart);
  try {
    window.localStorage.setItem(CART_STORAGE_KEY, encodeCart(cart));
  } catch {
    // Quota or private mode. The cart stays in memory for this session
    // rather than being dropped because it could not be saved.
  }
  publish(cart);
}

export function addToCart(article: CartArticle, quantity = 1): void {
  change((cart) => addLine(cart, article, quantity));
}

export function setCartQuantity(key: string, quantity: number): void {
  change((cart) => setLineQuantity(cart, key, quantity));
}

export function removeFromCart(key: string): void {
  change((cart) => removeLine(cart, key));
}

export function clearCart(): void {
  change(() => EMPTY_CART);
}

/** Test seam: forgets everything this module is holding. Not used by the app. */
export function resetCartStore(): void {
  snapshot = EMPTY;
  listeners.clear();
}
