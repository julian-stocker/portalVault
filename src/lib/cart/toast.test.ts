import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import {
  CART_TOAST_MS,
  dismissCartToast,
  getServerSnapshot,
  getSnapshot,
  resetCartToast,
  showCartToast,
  subscribe,
} from "@/lib/cart/toast";
import { de } from "@/lib/i18n/de";

/**
 * The add-to-cart confirmation (V10).
 *
 * The buy button used to rename itself for a moment. It says one thing now
 * and always means it; the confirmation happens in a live region that appears
 * and goes away on its own.
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

const TOAST = "src/components/cart/cart-toast.tsx";
const ACTION = "src/components/shop/shop-action.tsx";
const PANEL = "src/components/shop/offer-panel.tsx";

const BASH = { kind: "added" as const, name: "Bash", condition: "loose" as const, price: 4.49, quantity: 1 };

beforeEach(() => {
  vi.useFakeTimers();
  resetCartToast();
});
afterEach(() => {
  resetCartToast();
  vi.useRealTimers();
});

describe("the message", () => {
  it("is nothing until something is added", () => {
    expect(getSnapshot()).toBeNull();
    expect(getServerSnapshot()).toBeNull();
  });

  it("appears immediately", () => {
    showCartToast(BASH);
    expect(getSnapshot()).toMatchObject({ kind: "added", name: "Bash", price: 4.49 });
  });

  it("goes away on its own", () => {
    showCartToast(BASH);
    vi.advanceTimersByTime(CART_TOAST_MS - 1);
    expect(getSnapshot()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(getSnapshot()).toBeNull();
  });

  it("stays visible for two to three seconds", () => {
    expect(CART_TOAST_MS).toBeGreaterThanOrEqual(2000);
    expect(CART_TOAST_MS).toBeLessThanOrEqual(3000);
  });

  it("notifies its readers when it appears and when it goes", () => {
    const seen: (string | null)[] = [];
    const off = subscribe(() => seen.push(getSnapshot()?.name ?? null));
    showCartToast(BASH);
    vi.advanceTimersByTime(CART_TOAST_MS);
    off();
    expect(seen).toEqual(["Bash", null]);
  });
});

describe("adding several things quickly", () => {
  it("keeps one message, the latest", () => {
    // No queue: nobody should have to wait to read about the thing they
    // added three taps ago.
    showCartToast(BASH);
    showCartToast({ ...BASH, name: "Boomer", price: 9.49 });
    expect(getSnapshot()?.name).toBe("Boomer");
  });

  it("restarts the timer on every add", () => {
    showCartToast(BASH);
    vi.advanceTimersByTime(CART_TOAST_MS - 100);
    showCartToast({ ...BASH, name: "Boomer" });
    // The first timer must not fire and take the second message with it.
    vi.advanceTimersByTime(200);
    expect(getSnapshot()?.name).toBe("Boomer");
    vi.advanceTimersByTime(CART_TOAST_MS);
    expect(getSnapshot()).toBeNull();
  });

  it("gives two identical adds different identities", () => {
    showCartToast(BASH);
    const first = getSnapshot()!.id;
    showCartToast(BASH);
    expect(getSnapshot()!.id).not.toBe(first);
  });

  it("leaves no timer behind when dismissed", () => {
    showCartToast(BASH);
    dismissCartToast();
    expect(getSnapshot()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("what it says", () => {
  it("distinguishes a new line from one that grew", () => {
    expect(de.shop.toastAdded).toBe("Zum Warenkorb hinzugefügt");
    expect(de.shop.toastIncreased).toBe("Menge im Warenkorb erhöht");
    expect(de.shop.toastLine("Bash", "Lose", "€ 4,49")).toBe("Bash · Lose · € 4,49");
    expect(de.shop.toastQuantityLine(2, "Bash", "Lose")).toBe("2× Bash · Lose");
  });

  it("claims nothing about stock", () => {
    // Nothing is reserved and nothing is held: the cart is a list in this
    // browser (ADR-0043).
    const strings = [de.shop.toastAdded, de.shop.toastIncreased];
    for (const text of strings) {
      expect(text).not.toMatch(/reserv|zurückgelegt|garantiert|verfügbar/i);
    }
  });
});

describe("the component", () => {
  const toast = code(TOAST);

  it("is a polite live region that is always in the tree", () => {
    // A region that appears together with its message is not reliably
    // announced — the reader has to have been watching it already.
    expect(toast).toContain('role="status"');
    expect(toast).toContain('aria-live="polite"');
    const region = toast.indexOf('role="status"');
    expect(toast.indexOf("{toast ? (")).toBeGreaterThan(region);
  });

  it("owns no timer and no effect, so there is nothing to leak", () => {
    expect(toast).toContain("useSyncExternalStore");
    expect(toast).not.toContain("useEffect");
    expect(toast).not.toContain("setTimeout");
    expect(toast).not.toContain("useState");
  });

  it("never blocks the page", () => {
    expect(toast).toContain("pointer-events-none");
    expect(toast).toContain("fixed");
    expect(toast).not.toContain('role="dialog"');
    expect(toast).not.toContain("onClick");
  });

  it("sits above the round cart button, and out of the corner on desktop", () => {
    expect(toast).toContain("bottom-[calc(2.75rem+env(safe-area-inset-bottom)+4.5rem)]");
    expect(toast).toContain("md:bottom-6");
  });

  it("uses existing tokens, not a new colour", () => {
    expect(toast).toContain("bg-deep/95");
    expect(toast).toContain("ring-gold-line");
    expect(toast).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});

describe("the buy button no longer renames itself", () => {
  it("shows the price, before and after", () => {
    const action = code(ACTION);
    expect(action).toContain("{formatPrice(summary.price)}");
    expect(action).not.toContain("inCart");
    expect(action).not.toContain("setAdded");
  });

  it("and the figure page's button keeps its own label", () => {
    const panel = code(PANEL);
    expect(panel).toContain("{de.shop.addToCart}");
    expect(panel).not.toContain("inCart");
    expect(panel).not.toContain("setAdded");
  });

  it("confirms through the toast instead", () => {
    for (const path of [ACTION, PANEL]) {
      expect(code(path)).toContain("showCartToast({");
    }
  });

  it("reads the existing line from the cart store rather than counting again", () => {
    const action = code(ACTION);
    expect(action).toContain("const key = lineKey(skyId, offer.condition);");
    expect(action).toContain("cart.find((line) => keyOf(line) === key)");
    expect(action).toContain('kind: existing ? "increased" : "added"');
  });

  it("only confirms after a condition has actually been chosen", () => {
    // Opening the chooser is not an add.
    const action = code(ACTION);
    const opener = action.slice(action.indexOf("onClick={() => setChoosing(true)}"));
    expect(opener).not.toContain("showCartToast");
    expect(action.indexOf("showCartToast")).toBeLessThan(action.indexOf("if (choosing)"));
  });
});
