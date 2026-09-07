import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import { CART_STORAGE_KEY, cartCount, decodeCart, encodeCart, addLine } from "@/lib/cart/cart";
import { addToCart, getSnapshot, resetCartStore, subscribe } from "@/lib/cart/store";
import { activeSection } from "@/lib/nav/sections";
import { de } from "@/lib/i18n/de";

/**
 * The floating cart (V9).
 *
 * The same cart as the header badge, reachable while scrolling a phone. What
 * is asserted here is when it appears and when it must not: an empty cart, a
 * desktop, the administrator, and the cart page itself.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
    })
    .join("\n");
}

const FLOATING = "src/components/cart/floating-cart.tsx";
const NAV = "src/components/layout/site-nav.tsx";

/** A minimal storage, the same shape the store test uses. */
function fakeStorage() {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (k: string) => entries.get(k) ?? null,
    setItem: (k: string, v: string) => void entries.set(k, v),
  };
}
let storage: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  storage = fakeStorage();
  vi.stubGlobal("window", {
    localStorage: storage,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  resetCartStore();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetCartStore();
});

const BASH = {
  skyId: "SKY-0007",
  condition: "loose" as const,
  name: "Bash",
  imageSrc: null,
  price: 4.49,
};

describe("when it is there", () => {
  it("is not rendered while the cart is empty", () => {
    expect(code(FLOATING)).toContain("if (count === 0) return null;");
  });

  it("appears with the first article", () => {
    const off = subscribe(() => {});
    expect(getSnapshot().cart).toHaveLength(0);
    addToCart(BASH);
    expect(cartCount(getSnapshot().cart)).toBe(1);
    off();
  });

  it("counts pieces, so it follows every change", () => {
    const off = subscribe(() => {});
    addToCart(BASH, 2);
    addToCart({ ...BASH, condition: "boxed", price: 7.99 }, 3);
    expect(cartCount(getSnapshot().cart)).toBe(5);
    off();
  });

  it("shows nothing before the stored cart has been read", () => {
    // `count` is 0 until `ready`, so the server renders nothing and the
    // first browser frame matches it — no flash, no hydration mismatch.
    expect(getSnapshot()).toEqual({ cart: [], ready: false });
    expect(code(FLOATING)).toContain("const { count } = useCart();");
  });

  it("reads the same store as the header badge, not a second one", () => {
    const floating = code(FLOATING);
    const badge = code("src/components/cart/cart-badge.tsx");
    for (const source of [floating, badge]) {
      expect(source).toContain('from "@/components/cart/use-cart"');
      expect(source).not.toContain("createContext");
      expect(source).not.toContain("useState");
    }
  });
});

describe("where it is not", () => {
  const nav = code(NAV);

  it("is hidden from md: upwards", () => {
    // The header never leaves the screen there, so a floating shortcut would
    // be a second control for a destination already in view.
    expect(code(FLOATING)).toContain("md:hidden");
  });

  it("is not offered to the administrator", () => {
    expect(nav).toContain("const floatingCart = !admin && active !== \"cart\";");
  });

  it("is not shown on the cart page itself", () => {
    expect(activeSection("/cart")).toBe("cart");
    expect(nav).toContain('active !== "cart"');
  });

  it("is mounted once, with the navigation", () => {
    // Not by every page that might want it.
    expect(nav).toContain("{floatingCart ? <FloatingCart /> : null}");
    expect((nav.match(/<FloatingCart/g) ?? []).length).toBe(1);
  });

  it("is therefore on the catalog and on a figure page", () => {
    // Both are in the public layout, which mounts the navigation.
    expect(activeSection("/")).toBe("catalog");
    expect(activeSection("/skylanders/bash")).toBe("catalog");
  });
});

describe("where it sits", () => {
  const floating = code(FLOATING);

  it("clears the bottom bar and the home indicator", () => {
    // The same numbers NavSpacer reserves: 2.75rem of bar plus the phone's
    // safe-area inset, and a gap on top of both.
    expect(floating).toContain("bottom-[calc(2.75rem+env(safe-area-inset-bottom)+0.75rem)]");
    const nav = code(NAV);
    expect(nav).toContain("h-[calc(2.75rem+env(safe-area-inset-bottom))]");
    expect(nav).toContain("pb-[env(safe-area-inset-bottom)]");
  });

  it("sits below the header in the stacking order", () => {
    // The header is z-30 and sticky; the bottom bar is z-20. This must not
    // cover either's controls.
    expect(floating).toContain("z-30");
    expect(floating).toContain("fixed right-4");
  });

  it("is a link to the cart, not a control that does something else", () => {
    expect(floating).toContain('href="/cart"');
    expect(floating).not.toContain("onClick");
  });
});

describe("what it says", () => {
  const floating = code(FLOATING);

  it("names itself and its count for a screen reader", () => {
    expect(floating).toContain("aria-label={de.cart.openWith(count)}");
    expect(de.cart.openWith(1)).toBe("Warenkorb öffnen, 1 Artikel");
    expect(de.cart.openWith(3)).toBe("Warenkorb öffnen, 3 Artikel");
  });

  it("shows the count, and the count is decoration beside the name", () => {
    expect(floating).toContain('aria-hidden="true"');
    expect(floating).toContain("formatNumber(count)");
    // The total is deliberately not shown: the count is the question, and a
    // sum needs width a floating control should not take from 390 px.
    expect(floating).not.toContain("cartTotal");
    expect(floating).not.toContain("formatPrice");
  });

  it("keeps a 44 px touch target", () => {
    expect(floating).toContain("min-h-11");
  });

  it("uses the existing accent, not a new colour", () => {
    expect(floating).toContain("bg-accent");
    expect(floating).toContain("text-on-accent");
    expect(floating).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});

describe("the cart architecture is untouched", () => {
  it("stores what it always stored", () => {
    const cart = addLine([], BASH, 2);
    const round = decodeCart(encodeCart(cart));
    expect(round).toEqual(cart);
    expect(round[0].skyId).toBe("SKY-0007");
    expect(round[0].condition).toBe("loose");
    expect(CART_STORAGE_KEY).toBe("skyisles.cart.v1");
  });

  it("adds no provider, no second store and no server call", () => {
    const floating = code(FLOATING);
    expect(floating).not.toContain("@/lib/supabase");
    expect(floating).not.toContain(".rpc(");
    expect(floating).not.toContain("use server");
    expect(floating).not.toContain("Provider");
  });

  it("reads a cart written before it existed", () => {
    const stored = encodeCart(addLine([], BASH, 3));
    storage.setItem(CART_STORAGE_KEY, stored);
    const off = subscribe(() => {});
    expect(cartCount(getSnapshot().cart)).toBe(3);
    off();
  });
});
