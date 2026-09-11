import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The bug this file exists for, in the reporter's words:
 *
 *   "Artikel als Gast/in Profil A in den Warenkorb gelegt · Logout ·
 *    Login Profil B · derselbe Warenkorb ist weiterhin da"
 *
 * One `localStorage` key, no owner in it. These pin the fix: a guest basket
 * and each account's basket are different things, a sign-in folds the guest's
 * into the account's exactly once, and nothing ever moves between accounts
 * (ADR-0061).
 *
 * The server half is mocked — `cart_items` is proved by its policies, not by
 * a unit test — so what is under test here is the store's own behaviour: who
 * it asks, when, and what it shows in between.
 */

const server = vi.hoisted(() => ({
  carts: new Map<string, { skyId: string; condition: string; quantity: number }[]>(),
  who: "",
  loads: 0,
  merges: [] as { user: string; lines: number }[],
  saves: [] as { user: string; skyId: string; quantity: number }[],
  cleared: [] as string[],
}));

vi.mock("@/lib/cart/account-cart", () => ({
  loadAccountCart: async () => {
    server.loads += 1;
    return (server.carts.get(server.who) ?? []).map((l) => ({
      ...l,
      name: l.skyId,
      imageSrc: null,
      priceAtAdd: 1,
    }));
  },
  mergeGuestCart: async (lines: { skyId: string; condition: string; quantity: number }[]) => {
    server.merges.push({ user: server.who, lines: lines.length });
    const existing = server.carts.get(server.who) ?? [];
    const merged = [...existing];
    for (const line of lines) {
      const hit = merged.find((l) => l.skyId === line.skyId && l.condition === line.condition);
      if (hit) hit.quantity = Math.min(hit.quantity + line.quantity, 99);
      else merged.push({ skyId: line.skyId, condition: line.condition, quantity: line.quantity });
    }
    server.carts.set(server.who, merged);
    return merged.map((l) => ({ ...l, name: l.skyId, imageSrc: null, priceAtAdd: 1 }));
  },
  saveAccountLine: async (skyId: string, condition: string, quantity: number) => {
    server.saves.push({ user: server.who, skyId, quantity });
    const cart = server.carts.get(server.who) ?? [];
    const rest = cart.filter((l) => !(l.skyId === skyId && l.condition === condition));
    server.carts.set(server.who, quantity < 1 ? rest : [...rest, { skyId, condition, quantity }]);
  },
  clearAccountCart: async () => {
    server.cleared.push(server.who);
    server.carts.set(server.who, []);
  },
}));

import { GUEST_CART_KEY, encodeCart, type Cart } from "@/lib/cart/cart";
import {
  addToCart,
  bindPrincipal,
  clearCart,
  getSnapshot,
  resetCartStore,
  subscribe,
} from "@/lib/cart/store";
import { principalFor, GUEST } from "@/lib/auth/principal";
import type { CartArticle } from "@/lib/cart/store";

const A = principalFor("user-a");
const B = principalFor("user-b");

const BASH: CartArticle = {
  skyId: "SKY-0007",
  condition: "loose",
  name: "Bash",
  imageSrc: null,
  price: 9.9,
};
const SPYRO: CartArticle = { ...BASH, skyId: "SKY-0043", name: "Spyro", price: 4.5 };

let local: Map<string, string>;

/**
 * The store is asynchronous once an account is involved: binding starts a
 * load and publishes when it lands. Nothing here polls — a microtask flush is
 * enough, because the mocks resolve immediately.
 */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function mount(): () => void {
  return subscribe(() => undefined);
}

function seedGuest(cart: Cart): void {
  local.set(GUEST_CART_KEY, encodeCart(cart));
}

beforeEach(() => {
  local = new Map<string, string>();
  server.carts.clear();
  server.who = "";
  server.loads = 0;
  server.merges = [];
  server.saves = [];
  server.cleared = [];
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => local.get(k) ?? null,
      setItem: (k: string, v: string) => void local.set(k, v),
      removeItem: (k: string) => void local.delete(k),
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  resetCartStore();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetCartStore();
});

describe("a guest basket is the guest's", () => {
  it("is read from local storage and written back there", () => {
    const off = mount();
    bindPrincipal(GUEST);
    addToCart(BASH, 2);

    expect(getSnapshot().cart).toHaveLength(1);
    expect(local.has(GUEST_CART_KEY)).toBe(true);
    // Nothing was asked of the server, because a guest has no row anywhere.
    expect(server.loads).toBe(0);
    expect(server.saves).toHaveLength(0);
    off();
  });

  it("is not the key the broken release used", () => {
    // `skyisles.cart.v1` had no owner in it, which is the whole defect. It is
    // abandoned rather than migrated: there is no way to tell whose it was.
    expect(GUEST_CART_KEY).not.toBe("skyisles.cart.v1");
  });
});

describe("signing in folds the guest basket in, once", () => {
  it("merges what the guest had and then forgets it", async () => {
    const off = mount();
    bindPrincipal(GUEST);
    addToCart(BASH, 2);
    expect(local.has(GUEST_CART_KEY)).toBe(true);

    server.who = "user-a";
    bindPrincipal(A);
    await settle();

    expect(server.merges).toEqual([{ user: "user-a", lines: 1 }]);
    expect(getSnapshot().cart.map((l) => l.skyId)).toEqual(["SKY-0007"]);
    // Cleared, so the next sign-in cannot merge the same basket again.
    expect(local.has(GUEST_CART_KEY)).toBe(false);
    off();
  });

  it("does not merge anything when the guest basket is empty", async () => {
    const off = mount();
    server.who = "user-a";
    server.carts.set("user-a", [{ skyId: "SKY-0043", condition: "loose", quantity: 1 }]);

    bindPrincipal(A);
    await settle();

    expect(server.merges).toEqual([]);
    expect(server.loads).toBe(1);
    expect(getSnapshot().cart.map((l) => l.skyId)).toEqual(["SKY-0043"]);
    off();
  });

  it("never carries a basket from one account into another", async () => {
    const off = mount();
    server.who = "user-a";
    server.carts.set("user-a", [{ skyId: "SKY-0007", condition: "loose", quantity: 3 }]);
    bindPrincipal(A);
    await settle();
    expect(getSnapshot().cart).toHaveLength(1);

    // Straight from one account to another, with no sign-out in between.
    server.who = "user-b";
    bindPrincipal(B);
    await settle();

    expect(server.merges).toEqual([]);
    expect(getSnapshot().cart).toEqual([]);
    expect(server.carts.get("user-a")).toHaveLength(1);
    off();
  });
});

describe("the reported sequence, end to end", () => {
  it("A signs out and B sees only B's basket", async () => {
    const off = mount();

    // A, with something in the basket.
    server.who = "user-a";
    server.carts.set("user-a", [{ skyId: "SKY-0007", condition: "loose", quantity: 2 }]);
    bindPrincipal(A);
    await settle();
    expect(getSnapshot().cart.map((l) => l.skyId)).toEqual(["SKY-0007"]);

    // Sign out. The guest basket is empty, so the screen is empty.
    bindPrincipal(GUEST);
    expect(getSnapshot().cart).toEqual([]);

    // B signs in and sees B's basket — which is B's, not A's.
    server.who = "user-b";
    server.carts.set("user-b", [{ skyId: "SKY-0043", condition: "loose", quantity: 1 }]);
    bindPrincipal(B);
    await settle();
    expect(getSnapshot().cart.map((l) => l.skyId)).toEqual(["SKY-0043"]);
    off();
  });

  it("A signs back in and gets A's own basket back", async () => {
    const off = mount();
    server.who = "user-a";
    server.carts.set("user-a", [{ skyId: "SKY-0007", condition: "loose", quantity: 2 }]);
    bindPrincipal(A);
    await settle();

    bindPrincipal(GUEST);
    server.who = "user-b";
    bindPrincipal(B);
    await settle();

    server.who = "user-a";
    bindPrincipal(A);
    await settle();
    expect(getSnapshot().cart.map((l) => l.skyId)).toEqual(["SKY-0007"]);
    off();
  });

  it("shows nothing at all while it does not yet know whose basket it is", async () => {
    const off = mount();
    server.who = "user-a";
    server.carts.set("user-a", [{ skyId: "SKY-0007", condition: "loose", quantity: 2 }]);
    bindPrincipal(A);
    await settle();

    bindPrincipal(B);
    // Between the switch and the load there must be no basket on screen —
    // certainly not the one that belonged to the account before.
    expect(getSnapshot()).toEqual({ cart: [], ready: false });
    off();
  });
});

describe("a signed-in basket is written to the account", () => {
  it("persists the line that changed and nothing else", async () => {
    const off = mount();
    server.who = "user-a";
    bindPrincipal(A);
    await settle();

    addToCart(BASH, 1);
    addToCart(SPYRO, 2);
    await settle();

    expect(server.saves.map((s) => s.skyId)).toEqual(["SKY-0007", "SKY-0043"]);
    expect(server.saves.every((s) => s.user === "user-a")).toBe(true);
    // Nothing landed in the guest's local basket.
    expect(local.has(GUEST_CART_KEY)).toBe(false);
    off();
  });

  it("empties the account's basket, not the browser's", async () => {
    const off = mount();
    server.who = "user-a";
    server.carts.set("user-a", [{ skyId: "SKY-0007", condition: "loose", quantity: 2 }]);
    bindPrincipal(A);
    await settle();

    clearCart();
    await settle();

    expect(getSnapshot().cart).toEqual([]);
    expect(server.cleared).toEqual(["user-a"]);
    off();
  });

  it("a load for an account nobody is any more cannot publish over a newer one", async () => {
    const off = mount();
    server.who = "user-a";
    server.carts.set("user-a", [{ skyId: "SKY-0007", condition: "loose", quantity: 2 }]);
    bindPrincipal(A);
    // Switch before the first load can land.
    bindPrincipal(GUEST);
    await settle();

    expect(getSnapshot().cart).toEqual([]);
    off();
  });
});

describe("a guest basket seeded by the previous session", () => {
  it("belongs to the guest, and to the first account that signs in", async () => {
    seedGuest([
      { skyId: "SKY-0007", condition: "loose", quantity: 1, name: "Bash", imageSrc: null, priceAtAdd: 9.9 },
    ]);
    const off = mount();
    bindPrincipal(GUEST);
    expect(getSnapshot().cart).toHaveLength(1);

    server.who = "user-a";
    bindPrincipal(A);
    await settle();
    expect(server.merges).toEqual([{ user: "user-a", lines: 1 }]);

    // And once merged it is gone, so B cannot inherit it.
    bindPrincipal(GUEST);
    server.who = "user-b";
    bindPrincipal(B);
    await settle();
    expect(server.merges).toHaveLength(1);
    off();
  });
});
