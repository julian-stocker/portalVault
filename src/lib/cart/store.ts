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
  GUEST_CART_KEY,
  keyOf,
  lineKey,
  decodeCart,
  encodeCart,
  EMPTY_CART,
  removeLine,
  setLineQuantity,
  type Cart,
} from "@/lib/cart/cart";
import type { OfferCondition } from "@/lib/shop/offer";
import { GUEST, principalKey, samePrincipal, type Principal } from "@/lib/auth/principal";
import {
  clearAccountCart,
  loadAccountCart,
  mergeGuestCart,
  saveAccountLine,
} from "@/lib/cart/account-cart";

/** What can be put in the cart: one article, at the price it is offered for. */
export type CartArticle = {
  skyId: string;
  condition: OfferCondition;
  name: string;
  /** Already resolved to a URL by `imageSrc()` (ADR-0046). */
  imageSrc: string | null;
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

/**
 * Who this browser is acting as.
 *
 * `null` until a layout says. Before that the store answers "not ready" and
 * nothing renders a number — the same rule that already applied before
 * storage had been read once.
 *
 * A guest's basket is local, because a guest has no account to hang one on.
 * A signed-in basket is a table under RLS, because two accounts on one
 * browser must not be able to see each other's (ADR-0061).
 */
let principal: Principal | null = null;

/**
 * Rising counter, so a slow load for a principal nobody is any more cannot
 * publish over a newer one. Signing out while the account basket is in flight
 * is exactly that case.
 */
let generation = 0;

function guestKey(): string {
  return GUEST_CART_KEY;
}

function isGuest(): boolean {
  return principal === null || principal.kind === "guest";
}

function emit(): void {
  for (const listener of listeners) listener();
}

/** The guest basket, from local storage. Never the account's. */
function readGuest(): Cart {
  try {
    return decodeCart(window.localStorage.getItem(guestKey()));
  } catch {
    // Private mode, or storage disabled. An empty cart is the honest answer.
    return EMPTY_CART;
  }
}

function writeGuest(cart: Cart): void {
  try {
    window.localStorage.setItem(guestKey(), encodeCart(cart));
  } catch {
    // Quota or private mode. The cart stays in memory for this session
    // rather than being dropped because it could not be saved.
  }
}

function clearGuestStorage(): void {
  try {
    window.localStorage.removeItem(guestKey());
  } catch {
    /* nothing stored, nothing to clear */
  }
}

function publish(cart: Cart): void {
  snapshot = { cart, ready: true };
  emit();
}

/**
 * Another tab changed the guest basket. Same browser, same guest.
 *
 * Only the guest basket is mirrored this way. A signed-in basket lives on the
 * server, where a second tab's write is already the same row — there is no
 * local copy for a `storage` event to be about.
 */
function onStorage(event: StorageEvent): void {
  if (!isGuest()) return;
  if (event.key !== null && event.key !== guestKey()) return;
  publish(readGuest());
}

export function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    window.addEventListener("storage", onStorage);
    // Deliberately NOT a read here.
    //
    // Effects run child-first, so a cart badge subscribes before the layout's
    // gate has said who the browser is. Reading the guest basket in that gap
    // would show a signed-in person somebody else's count for a frame. The
    // store stays "not ready" until a principal is bound, which is the honest
    // answer: it does not yet know whose basket to show (ADR-0061).
    if (principal !== null && principal.kind === "guest" && !snapshot.ready) {
      publish(readGuest());
    }
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

/**
 * Apply a change, show it, then persist it.
 *
 * Optimistic on purpose: a basket button that waits for a round trip feels
 * broken, and there is nothing here worth a spinner. The line that was
 * touched is the only thing written, so two tabs adding two different
 * articles both keep theirs.
 */
function change(next: (cart: Cart) => Cart, touched?: string): void {
  const cart = next(snapshot.cart);
  publish(cart);

  if (isGuest()) {
    writeGuest(cart);
    return;
  }

  const key = touched ?? null;
  if (key === null) return;
  const line = cart.find((l) => keyOf(l) === key) ?? null;

  // `lineKey()` is `${skyId}/${condition}`, and a SKY id contains no slash.
  const slash = key.lastIndexOf("/");
  const skyId = key.slice(0, slash);
  const condition = key.slice(slash + 1);

  void saveAccountLine(skyId, condition, line?.quantity ?? 0, line?.priceAtAdd ?? null).catch(() => {
    /* The server refused or the network is gone. The next load corrects it;
       reverting under the customer's finger would be worse than being one
       reload out of date. */
  });
}

export function addToCart(article: CartArticle, quantity = 1): void {
  change((cart) => addLine(cart, article, quantity), lineKey(article.skyId, article.condition));
}

export function setCartQuantity(key: string, quantity: number): void {
  change((cart) => setLineQuantity(cart, key, quantity), key);
}

export function removeFromCart(key: string): void {
  change((cart) => removeLine(cart, key), key);
}

/**
 * Empty it. Called when an order is placed — the articles are on the order
 * now, and leaving them in the basket would invite a second one.
 */
export function clearCart(): void {
  publish(EMPTY_CART);
  if (isGuest()) {
    clearGuestStorage();
    return;
  }
  void clearAccountCart().catch(() => {
    /* The next load corrects it. */
  });
}

/* ------------------------------------------------------------- the principal */

/**
 * Say who the browser is acting as, and load that identity's basket.
 *
 * Called by a small client component in the layouts, with the user id the
 * server already knows. Three things happen, in this order and only when the
 * principal actually changed:
 *
 *   1. anything the previous identity left in the tab is thrown away
 *   2. a guest basket, if there is one, is folded into the account being
 *      signed in to — once, and then the guest basket is cleared
 *   3. the new identity's basket is loaded and published
 *
 * Step 2 only ever runs guest -> account. There is deliberately no path that
 * moves a basket the other way, or from one account to another.
 */
export function bindPrincipal(next: Principal): void {
  if (samePrincipal(principal, next)) return;

  const previous = principal;
  principal = next;
  const mine = (generation += 1);

  // Not ready again: whatever is on screen belongs to somebody else.
  snapshot = { cart: EMPTY_CART, ready: false };
  emit();

  if (next.kind === "guest") {
    // Signing out. The account's basket stays on the server, untouched; this
    // browser simply stops showing it.
    publish(readGuest());
    return;
  }

  // Signing in — or arriving on a page already signed in. A guest basket is
  // only ever merged on the way in, which is the same thing in both cases.
  const guestCart = previous === null || previous.kind === "guest" ? readGuest() : EMPTY_CART;

  void (async () => {
    try {
      const cart = guestCart.length > 0 ? await mergeGuestCart(guestCart) : await loadAccountCart();
      if (mine !== generation) return; // somebody else is the principal now
      if (guestCart.length > 0) clearGuestStorage();
      publish(cart);
    } catch {
      if (mine === generation) publish(EMPTY_CART);
    }
  })();
}

/** Which identity the store is currently showing. For tests and for the UI. */
export function currentPrincipal(): Principal {
  return principal ?? GUEST;
}

/** Test seam: forgets everything this module is holding. Not used by the app. */
export function resetCartStore(): void {
  snapshot = EMPTY;
  listeners.clear();
  principal = null;
  generation += 1;
}
