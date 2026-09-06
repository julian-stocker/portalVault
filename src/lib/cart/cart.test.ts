import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  addLine,
  cartCount,
  cartTotal,
  decodeCart,
  encodeCart,
  keyOf,
  MAX_LINE_QUANTITY,
  removeLine,
  resolveCart,
  setLineQuantity,
  unavailableEntries,
  type Cart,
} from "@/lib/cart/cart";
import type { Offer, OfferIndex } from "@/lib/shop/offer";

/**
 * The local cart (ADR-0043).
 *
 * Three rules carry everything else: identity is `sky_id + condition`, the
 * server's price wins over the stored one, and nothing disappears from the
 * screen on the visitor's behalf.
 */
const BASH = {
  skyId: "SKY-0001",
  condition: "loose" as const,
  name: "Bash",
  imageSrc: null,
  price: 9.9,
};

const BASH_BOXED = { ...BASH, condition: "boxed" as const, price: 19 };

function index(offers: readonly Offer[]): OfferIndex {
  const map = new Map<string, Offer[]>();
  for (const offer of offers) {
    const list = map.get(offer.skyId);
    if (list) list.push(offer);
    else map.set(offer.skyId, [offer]);
  }
  return map;
}

function offer(overrides: Partial<Offer> = {}): Offer {
  return { skyId: "SKY-0001", condition: "loose", price: 9.9, available: true, ...overrides };
}

/** The file without its comments — what the code does, not what it says. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("*") && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
    })
    .join("\n");
}

describe("what identifies a line", () => {
  it("keeps loose and boxed apart", () => {
    // The same identity a stock position has. Merging them would put one
    // price on two different articles.
    const cart = addLine(addLine([], BASH), BASH_BOXED);
    expect(cart).toHaveLength(2);
    expect(cart.map(keyOf)).toEqual(["SKY-0001/loose", "SKY-0001/boxed"]);
  });

  it("raises the quantity when the same article is added again", () => {
    const cart = addLine(addLine([], BASH), BASH, 2);
    expect(cart).toHaveLength(1);
    expect(cart[0].quantity).toBe(3);
  });
});

describe("quantities", () => {
  it("never goes below one or above the bound", () => {
    const cart = addLine([], BASH);
    expect(setLineQuantity(cart, keyOf(cart[0]), 500)[0].quantity).toBe(MAX_LINE_QUANTITY);
    // Zero is a removal, which is what typing 0 into the field means.
    expect(setLineQuantity(cart, keyOf(cart[0]), 0)).toHaveLength(0);
  });

  it("counts pieces, not lines", () => {
    const cart = addLine(addLine([], BASH, 2), BASH_BOXED, 3);
    expect(cart).toHaveLength(2);
    expect(cartCount(cart)).toBe(5);
  });

  it("removes exactly one line", () => {
    const cart = addLine(addLine([], BASH), BASH_BOXED);
    const rest = removeLine(cart, "SKY-0001/loose");
    expect(rest.map(keyOf)).toEqual(["SKY-0001/boxed"]);
  });
});

describe("the server's answer beats the stored one", () => {
  it("uses today's price, not the price it was added at", () => {
    const cart = addLine([], BASH, 2);
    const [entry] = resolveCart(cart, index([offer({ price: 12 })]));

    expect(entry.price).toBe(12);
    expect(entry.total).toBe(24);
    expect(entry.priceChanged).toBe(true);
    // The old price is kept, but only so the change can be pointed out.
    expect(entry.line.priceAtAdd).toBe(9.9);
  });

  it("says nothing about a price that has not moved", () => {
    const [entry] = resolveCart(addLine([], BASH), index([offer()]));
    expect(entry.priceChanged).toBe(false);
  });
});

describe("what cannot be bought", () => {
  it("keeps a sold-out line on screen and out of the total", () => {
    const cart = addLine(addLine([], BASH, 2), BASH_BOXED, 1);
    const entries = resolveCart(
      cart,
      index([offer({ available: false }), offer({ condition: "boxed", price: 19 })]),
    );

    expect(entries).toHaveLength(2);
    expect(entries[0].purchasable).toBe(false);
    expect(entries[0].total).toBeNull();
    // Only the boxed line counts.
    expect(cartTotal(entries)).toBe(19);
    expect(unavailableEntries(entries)).toHaveLength(1);
  });

  it("keeps a withdrawn line on screen, with no price at all", () => {
    // SkyIsles stopped listing it. The line is still the visitor's choice.
    const [entry] = resolveCart(addLine([], BASH), index([]));
    expect(entry.offer).toBeNull();
    expect(entry.price).toBeNull();
    expect(entry.purchasable).toBe(false);
    expect(cartTotal([entry])).toBe(0);
  });

  it("rounds the total to cents", () => {
    const cart = addLine([], { ...BASH, price: 0.1 }, 3);
    const entries = resolveCart(cart, index([offer({ price: 0.1 })]));
    expect(cartTotal(entries)).toBe(0.3);
  });
});

describe("storage", () => {
  it("survives a round trip", () => {
    const cart: Cart = addLine(addLine([], BASH, 2), BASH_BOXED);
    expect(decodeCart(encodeCart(cart))).toEqual(cart);
  });

  it("migrates a version 1 cart instead of dropping it", () => {
    // Version 1 stored a bare file name; version 2 stores a URL, because an
    // uploaded image is not under /images/skylanders (ADR-0046).
    const stored = JSON.stringify({
      version: 1,
      lines: [
        {
          skyId: "SKY-0001",
          condition: "loose",
          quantity: 2,
          name: "Bash",
          imageFile: "0123456789abcdef.webp",
          priceAtAdd: 9.9,
        },
      ],
    });
    const cart = decodeCart(stored);
    expect(cart).toHaveLength(1);
    expect(cart[0].imageSrc).toBe("/images/skylanders/0123456789abcdef.webp");
    expect(cart[0].quantity).toBe(2);
  });

  it("does not turn a stray version 1 value into a broken URL", () => {
    const stored = JSON.stringify({
      version: 1,
      lines: [
        {
          skyId: "SKY-0001",
          condition: "loose",
          quantity: 1,
          name: "Bash",
          imageFile: "../../etc/passwd",
          priceAtAdd: 9.9,
        },
      ],
    });
    expect(decodeCart(stored)[0].imageSrc).toBeNull();
  });

  it("treats anything unreadable as an empty cart", () => {
    // A wrong cart is worse than an empty one, and nothing in it costs more
    // than two taps to choose again.
    expect(decodeCart(null)).toEqual([]);
    expect(decodeCart("not json")).toEqual([]);
    expect(decodeCart("[]")).toEqual([]);
    expect(decodeCart(JSON.stringify({ version: 99, lines: [] }))).toEqual([]);
    expect(decodeCart(JSON.stringify({ version: 0, lines: [] }))).toEqual([]);
  });

  it("drops lines that are not lines", () => {
    const stored = JSON.stringify({
      version: 1,
      lines: [
        { skyId: "nope", condition: "loose", quantity: 1, name: "x", priceAtAdd: 1 },
        { skyId: "SKY-0001", condition: "sealed", quantity: 1, name: "x", priceAtAdd: 1 },
        { skyId: "SKY-0001", condition: "loose", quantity: 0, name: "x", priceAtAdd: 1 },
        { skyId: "SKY-0002", condition: "loose", quantity: 2, name: "Bash", priceAtAdd: 9.9 },
      ],
    });
    expect(decodeCart(stored).map(keyOf)).toEqual(["SKY-0002/loose"]);
  });

  it("refuses to hold the same article twice", () => {
    const stored = JSON.stringify({
      version: 1,
      lines: [
        { skyId: "SKY-0001", condition: "loose", quantity: 1, name: "Bash", priceAtAdd: 9.9 },
        { skyId: "SKY-0001", condition: "loose", quantity: 7, name: "Bash", priceAtAdd: 9.9 },
      ],
    });
    // Two lines for one offer could never be reconciled against it.
    expect(decodeCart(stored)).toHaveLength(1);
  });
});

describe("what the cart is not allowed to do", () => {
  const model = code("src/lib/cart/cart.ts");
  const store = code("src/lib/cart/store.ts");
  const hook = code("src/components/cart/use-cart.ts");
  const view = code("src/components/cart/cart-view.tsx");

  it("never reaches the database", () => {
    // The cart is local (ADR-0043): no client, no action, no RPC.
    for (const source of [model, store, hook, view]) {
      expect(source).not.toContain("@/lib/supabase");
      expect(source).not.toContain(".rpc(");
      expect(source).not.toContain("use server");
    }
  });

  it("never books a movement or reserves stock", () => {
    for (const source of [model, store, hook, view]) {
      expect(source).not.toContain("inventory_movement");
      expect(source).not.toContain("reserved");
    }
  });
});
