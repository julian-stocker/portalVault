import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import { addToCart, getSnapshot, removeFromCart, resetCartStore, subscribe } from "@/lib/cart/store";
import { cartCount, lineKey, MAX_LINE_QUANTITY } from "@/lib/cart/cart";

/**
 * "This one is already in your basket" (V11).
 *
 * The catalog pill gains a second appearance, and only an appearance: it is
 * the same button, doing the same thing, in a brighter gold with a tick in
 * the basket. It never becomes a remove, never becomes a toggle, and never
 * shows a quantity — the card stays quiet, and managing amounts is /cart's
 * job.
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

const ACTION = "src/components/shop/shop-action.tsx";
const GLYPH = "src/components/shop/cart-glyph.tsx";
const CARD = "src/components/catalog/catalog-card.tsx";
const CART = "src/components/cart/cart-view.tsx";
const PANEL = "src/components/shop/offer-panel.tsx";

const action = code(ACTION);
const glyph = code(GLYPH);
const cart = code(CART);

const BASH = {
  skyId: "SKY-0001",
  condition: "loose" as const,
  name: "Bash",
  imageSrc: null,
  price: 4.49,
};

/**
 * A hand-written `localStorage` and `window`, as `store.test.ts` uses: the
 * store touches three browser APIs, and stubbing those is smaller and more
 * honest than adding a DOM implementation for one file.
 */
type Listener = (event: { key: string | null }) => void;

let entries: Map<string, string>;
let storageListeners: Listener[];

beforeEach(() => {
  entries = new Map();
  storageListeners = [];
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => void entries.set(key, value),
    },
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

describe("the two appearances", () => {
  it("is the ordinary accent pill when nothing is in the cart", () => {
    expect(action).toContain('const BUY_IDLE = "bg-accent shadow-card hover:bg-accent-hover";');
  });

  it("is a stronger gold once something is", () => {
    expect(action).toContain("bg-accent-hover");
    expect(action).toContain("ring-gold-line-strong");
    expect(action).toContain("shadow-gold");
  });

  it("invents no colour — every token already exists", () => {
    const tokens = readFileSync("src/app/globals.css", "utf8");
    for (const token of ["--accent-hover", "--gold-line-strong", "--gold-frame"]) {
      expect(tokens).toContain(token);
    }
    expect(action).not.toMatch(/#[0-9a-fA-F]{6}/);
    expect(action).not.toMatch(/rgb\(|hsl\(/);
  });

  it("changes no geometry, so a marked card is exactly as tall (V9.1)", () => {
    // The height, padding and radius live in BUY and are not touched by
    // either state; a ring and a shadow are painted, not laid out.
    expect(action).toContain("inline-flex h-10 shrink-0 items-center justify-center gap-1.5");
    for (const state of ["BUY_IDLE", "BUY_IN_CART"]) {
      const value = action.slice(action.indexOf(`const ${state} =`));
      const literal = value.slice(0, value.indexOf(";"));
      expect(literal).not.toMatch(/\bh-\d|\bpx-\d|\bpy-\d|rounded-/);
    }
  });
});

describe("the tick", () => {
  it("is drawn, not typed", () => {
    expect(glyph).toContain("CartCheckedGlyph");
    expect(glyph).not.toContain("✓");
    expect(glyph).not.toContain("&check;");
  });

  it("is the same basket, so the two states cannot drift", () => {
    // One shared path component, used by both glyphs.
    expect(glyph).toContain("function BasketPaths()");
    expect((glyph.match(/<BasketPaths \/>/g) ?? []).length).toBe(2);
    expect((glyph.match(/M3 6h18l-1\.8 9\.6/g) ?? []).length).toBe(1);
  });

  it("stays decorative — the button's name carries the meaning", () => {
    expect((glyph.match(/aria-hidden="true"/g) ?? []).length).toBe(2);
  });

  it("is used by the card and by the figure page", () => {
    expect(action).toContain("<CartCheckedGlyph />");
    expect(code(PANEL)).toContain("<CartCheckedGlyph />");
  });
});

describe("the button still means one thing", () => {
  it("keeps the price visible in both states", () => {
    // The price sits outside the conditional: one expression, both states.
    expect(action).toContain("{anyInCart ? <CartCheckedGlyph /> : <CartGlyph />}\n        {formatPrice(summary.price)}");
  });

  it("is never a remove and never a toggle", () => {
    expect(action).not.toMatch(/removeFromCart|\bremove\(/);
    expect(action).not.toContain("de.cart.remove");
    // A second tap adds another one; nothing here subtracts.
    expect(action).not.toContain("setQuantity");
  });

  it("still says 'add' to a screen reader, worded for a repeat", () => {
    expect(action).toContain("de.shop.addAnotherFor(");
    expect(action).toContain("de.shop.addToCartFor(");
  });

  it("shows no quantity badge on the card", () => {
    // The floating cart keeps the total; the card stays quiet (V11 §15).
    // A quantity is read once, to answer "is it in there" — and never
    // rendered: no count, no badge, no "99+".
    const mentions = action.split("\n").filter((line) => line.includes("quantity"));
    expect(mentions).toHaveLength(1);
    expect(mentions[0]).toContain("line.quantity > 0");
    expect(action).not.toContain("cartCount");
    expect(action).not.toContain("formatNumber");
    expect(action).not.toContain("99+");
  });
});

describe("what counts as 'in the cart'", () => {
  it("is this figure and this condition, with something in it", () => {
    expect(action).toContain("const key = lineKey(skyId, condition);");
    expect(action).toContain("cart.some((line) => keyOf(line) === key && line.quantity > 0)");
  });

  it("marks the closed pill from any condition that can still be bought", () => {
    expect(action).toContain("const anyInCart = buyable.some((offer) => inCart(offer.condition));");
  });

  it("marks each condition separately once the chooser is open", () => {
    const chooser = action.slice(action.indexOf("if (choosing)"));
    expect(chooser).toContain("const already = inCart(offer.condition);");
    expect(chooser).toContain("already ? BUY_IN_CART : BUY_IDLE");
  });

  it("reads the one cart store, never a second state", () => {
    expect(action).toContain("const { cart } = useCart();");
    expect(action).not.toContain("useState<");
    expect(action).not.toContain("createContext");
  });
});

describe("it reacts to the cart itself", () => {
  it("shows the mark once a line exists, and drops it when it goes", () => {
    const off = subscribe(() => {});
    const key = lineKey(BASH.skyId, BASH.condition);

    const holds = () => getSnapshot().cart.some((l) => lineKey(l.skyId, l.condition) === key);

    expect(holds()).toBe(false);
    addToCart(BASH);
    expect(holds()).toBe(true);
    removeFromCart(key);
    expect(holds()).toBe(false);
    off();
  });

  it("is the same store the header and the floating cart read", () => {
    const off = subscribe(() => {});
    addToCart(BASH);
    addToCart(BASH);
    expect(cartCount(getSnapshot().cart)).toBe(2);
    off();
  });

  it("follows a change made in another tab", () => {
    const off = subscribe(() => {});
    addToCart(BASH);
    expect(getSnapshot().cart).toHaveLength(1);

    // What a second tab does: rewrite the key, then the storage event.
    entries.set("skyisles.cart.v1", JSON.stringify({ version: 2, lines: [] }));
    for (const listener of storageListeners) listener({ key: "skyisles.cart.v1" });

    expect(getSnapshot().cart).toHaveLength(0);
    off();
  });
});

describe("where the pill is and is not", () => {
  it("is absent when there is nothing to buy", () => {
    expect(code(CARD)).toContain("offers.length > 0 ? (");
    expect(action).toContain('if (summary.kind === "none") return null;');
  });

  it("is not offered to the administrator", () => {
    // The operator does not shop in their own catalog (ADR-0042).
    const card = code(CARD);
    const adminBranch = card.slice(card.indexOf("if (admin) {"));
    expect(adminBranch).not.toContain("shop={shop}");
  });

  it("is independent of ownership", () => {
    // Somebody who owns one may want a second; the mark is about the cart.
    expect(action).not.toMatch(/collected|owned/i);
  });
});

describe("the cart's own stepper", () => {
  it("has no free number field any more", () => {
    expect(cart).not.toContain('type="number"');
    expect(cart).not.toContain("QuantityField");
    expect(cart).toContain("QuantityStepper");
  });

  it("cannot be typed into at all", () => {
    expect(cart).not.toContain("<input");
    expect(cart).not.toContain("onChange");
  });

  it("takes minus locally and immediately", () => {
    expect(cart).toContain("onClick={() => setQuantity(key, line.quantity - 1)}");
  });

  it("sends plus through the checked path", () => {
    const plus = cart.slice(cart.indexOf("de.cart.increaseFor") - 900);
    expect(cart).toContain("void addOne({");
    expect(plus).toContain("addOne");
  });

  it("stops minus at one and leaves removal to Entfernen", () => {
    expect(cart).toContain("disabled={line.quantity <= 1}");
    expect(cart).toContain("de.cart.removeFor(line.name)");
  });

  it("offers no plus on a line that cannot be bought", () => {
    expect(cart).toContain("disabled={pending || !entry.purchasable || line.quantity >= MAX_LINE_QUANTITY}");
  });

  it("never exceeds the cart's own bound", () => {
    expect(MAX_LINE_QUANTITY).toBe(99);
    expect(cart).toContain("MAX_LINE_QUANTITY");
  });

  it("keeps both ends at a 44 px target", () => {
    expect(cart).toContain("h-11 w-11");
  });
});
