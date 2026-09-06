import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CART_STORAGE_KEY, decodeCart } from "@/lib/cart/cart";
import {
  addToCart,
  clearCart,
  getServerSnapshot,
  getSnapshot,
  removeFromCart,
  resetCartStore,
  setCartQuantity,
  subscribe,
  type CartArticle,
} from "@/lib/cart/store";

/**
 * The cart store against a real storage API (ADR-0043).
 *
 * `cart.test.ts` covers the rules; this covers the wiring — that what is put
 * in survives a reload, that a second tab is heard, and that a browser which
 * refuses to store anything still leaves a usable cart on screen.
 *
 * A hand-written `localStorage` rather than jsdom: the store touches exactly
 * three browser APIs, and stubbing those is smaller, faster and more honest
 * than adding a DOM implementation as a dependency for one file.
 */
function fakeStorage() {
  const entries = new Map<string, string>();
  return {
    entries,
    throwOnWrite: false,
    getItem(key: string): string | null {
      return entries.get(key) ?? null;
    },
    setItem(this: { throwOnWrite: boolean }, key: string, value: string): void {
      if (this.throwOnWrite) throw new Error("QuotaExceededError");
      entries.set(key, value);
    },
  };
}

type Listener = (event: { key: string | null }) => void;

let storage: ReturnType<typeof fakeStorage>;
let storageListeners: Listener[];

const BASH: CartArticle = {
  skyId: "SKY-0007",
  condition: "loose",
  name: "Bash",
  imageFile: null,
  price: 9.9,
};

const BOXED: CartArticle = { ...BASH, condition: "boxed", price: 24 };

beforeEach(() => {
  storage = fakeStorage();
  storageListeners = [];
  vi.stubGlobal("window", {
    localStorage: storage,
    addEventListener: (type: string, listener: Listener) => {
      if (type === "storage") storageListeners.push(listener);
    },
    removeEventListener: (type: string, listener: Listener) => {
      if (type === "storage") storageListeners = storageListeners.filter((l) => l !== listener);
    },
  });
  resetCartStore();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetCartStore();
});

/** What React does: subscribe, then read. Returns the unsubscribe. */
function mount(): () => void {
  return subscribe(() => {});
}

describe("what the server renders", () => {
  it("is always the empty cart", () => {
    // The server cannot know what is in a browser's storage. Rendering a
    // guess is a hydration mismatch and a badge that flickers.
    storage.entries.set(CART_STORAGE_KEY, JSON.stringify({ version: 1, lines: [{ ...BASH, quantity: 4, priceAtAdd: 9.9 }] }));
    expect(getServerSnapshot()).toEqual({ cart: [], ready: false });
  });
});

describe("persistence", () => {
  it("survives a reload", () => {
    const off = mount();
    addToCart(BASH, 2);
    addToCart(BOXED);
    off();

    // A new page load: same storage, a store that knows nothing.
    resetCartStore();
    const off2 = mount();
    const { cart, ready } = getSnapshot();

    expect(ready).toBe(true);
    expect(cart).toHaveLength(2);
    expect(cart[0]).toMatchObject({ skyId: "SKY-0007", condition: "loose", quantity: 2 });
    expect(cart[1]).toMatchObject({ condition: "boxed", priceAtAdd: 24 });
    off2();
  });

  it("writes something a fresh decode can read", () => {
    const off = mount();
    addToCart(BASH, 3);
    expect(decodeCart(storage.getItem(CART_STORAGE_KEY))).toEqual(getSnapshot().cart);
    off();
  });

  it("is not ready before it has been read", () => {
    expect(getSnapshot()).toEqual({ cart: [], ready: false });
    const off = mount();
    expect(getSnapshot().ready).toBe(true);
    off();
  });
});

describe("changing the cart", () => {
  it("raises and lowers a quantity", () => {
    const off = mount();
    addToCart(BASH);
    expect(getSnapshot().cart[0].quantity).toBe(1);

    setCartQuantity("SKY-0007/loose", 5);
    expect(getSnapshot().cart[0].quantity).toBe(5);

    setCartQuantity("SKY-0007/loose", 2);
    expect(getSnapshot().cart[0].quantity).toBe(2);
    expect(decodeCart(storage.getItem(CART_STORAGE_KEY))[0].quantity).toBe(2);
    off();
  });

  it("removes one line and keeps the other", () => {
    const off = mount();
    addToCart(BASH);
    addToCart(BOXED);

    removeFromCart("SKY-0007/loose");
    expect(getSnapshot().cart.map((line) => line.condition)).toEqual(["boxed"]);
    expect(decodeCart(storage.getItem(CART_STORAGE_KEY))).toHaveLength(1);
    off();
  });

  it("empties on clear, in memory and in storage", () => {
    const off = mount();
    addToCart(BASH, 4);
    clearCart();
    expect(getSnapshot().cart).toEqual([]);
    expect(decodeCart(storage.getItem(CART_STORAGE_KEY))).toEqual([]);
    off();
  });

  it("hands React a new snapshot object on every change", () => {
    // useSyncExternalStore compares by identity; a mutated snapshot would
    // simply never re-render.
    const off = mount();
    const before = getSnapshot();
    addToCart(BASH);
    expect(getSnapshot()).not.toBe(before);
    off();
  });
});

describe("a second tab", () => {
  it("is heard", () => {
    const off = mount();
    addToCart(BASH);

    // The other tab writes, then the browser tells this one.
    storage.entries.set(
      CART_STORAGE_KEY,
      JSON.stringify({ version: 1, lines: [{ ...BOXED, quantity: 7, priceAtAdd: 24 }] }),
    );
    for (const listener of storageListeners) listener({ key: CART_STORAGE_KEY });

    expect(getSnapshot().cart).toHaveLength(1);
    expect(getSnapshot().cart[0]).toMatchObject({ condition: "boxed", quantity: 7 });
    off();
  });

  it("is ignored when it changed something else", () => {
    const off = mount();
    addToCart(BASH, 3);
    for (const listener of storageListeners) listener({ key: "some.other.key" });
    expect(getSnapshot().cart[0].quantity).toBe(3);
    off();
  });

  it("stops being listened to once nothing is mounted", () => {
    const off = mount();
    expect(storageListeners).toHaveLength(1);
    off();
    expect(storageListeners).toHaveLength(0);
  });
});

describe("a browser that will not store anything", () => {
  it("keeps the cart on screen for the session", () => {
    // Private mode, or a full quota. Losing what somebody just chose because
    // it could not be saved would be the worse answer.
    const off = mount();
    storage.throwOnWrite = true;
    addToCart(BASH, 2);

    expect(getSnapshot().cart).toHaveLength(1);
    expect(storage.getItem(CART_STORAGE_KEY)).toBeNull();
    off();
  });
});
