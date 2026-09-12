import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { MAX_LINE_QUANTITY } from "@/lib/cart/cart";

/**
 * The quantity stepper in /cart.
 *
 * Extracted from `card-state.test.ts` in V3.2, which was otherwise entirely
 * about the catalog's buy pill — a control that no longer exists: the card
 * links to the figure's offers instead of selling from the grid. The stepper
 * is unaffected by that and keeps its rules.
 */
const cart = readFileSync("src/components/cart/cart-view.tsx", "utf8");

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
