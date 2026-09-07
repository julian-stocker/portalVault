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

const BASH = { kind: "added" as const, name: "Bash", condition: "loose" as const, price: 4.49 };

/** The name, for the members that carry one. Keeps the union honest. */
function nameOf(): string | null {
  const toast = getSnapshot();
  return toast && "name" in toast ? toast.name : null;
}

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
    const off = subscribe(() => seen.push(nameOf()));
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
    expect(nameOf()).toBe("Boomer");
  });

  it("restarts the timer on every add", () => {
    showCartToast(BASH);
    vi.advanceTimersByTime(CART_TOAST_MS - 100);
    showCartToast({ ...BASH, name: "Boomer" });
    // The first timer must not fire and take the second message with it.
    vi.advanceTimersByTime(200);
    expect(nameOf()).toBe("Boomer");
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

describe("what a refusal says", () => {
  it("is one sentence and carries no fields at all", () => {
    // The type gives it nowhere to put a count; these are the values.
    showCartToast({ kind: "denied" });
    expect(Object.keys(getSnapshot()!).sort()).toEqual(["id", "kind"]);
    showCartToast({ kind: "unchecked" });
    expect(Object.keys(getSnapshot()!).sort()).toEqual(["id", "kind"]);
  });

  it("names no stock level", () => {
    for (const text of [de.shop.toastDenied, de.shop.toastUnchecked]) {
      expect(text).not.toMatch(/\d/);
      expect(text).not.toMatch(/Lager|Bestand|St\u00fcck|verf\u00fcgbare?n?\s+\d/i);
    }
    expect(de.shop.toastDenied).toBe("Keine weitere Menge verf\u00fcgbar.");
    expect(de.shop.toastUnchecked).toBe("Menge konnte gerade nicht gepr\u00fcft werden.");
  });

  it("tells a refusal apart from a failed check", () => {
    // One is an answer, the other is the absence of one.
    expect(de.shop.toastUnchecked).not.toBe(de.shop.toastDenied);
  });

  it("replaces a confirmation, and is replaced by one", () => {
    showCartToast(BASH);
    showCartToast({ kind: "denied" });
    expect(getSnapshot()!.kind).toBe("denied");
    expect(nameOf()).toBeNull();
    showCartToast(BASH);
    expect(getSnapshot()!.kind).toBe("added");
  });

  it("goes away on the same timer", () => {
    showCartToast({ kind: "denied" });
    vi.advanceTimersByTime(CART_TOAST_MS);
    expect(getSnapshot()).toBeNull();
  });
});

describe("the component renders both shapes", () => {
  const toast = code(TOAST);

  it("shows a detail line only for the two confirmations", () => {
    expect(toast).toContain('toast.kind === "added" || toast.kind === "increased"');
    expect(toast).toContain("de.shop.toastLine(");
    expect(toast).toContain("de.shop.toastQuantityLine(");
  });

  it("shows a refusal as a sentence with no detail line", () => {
    expect(toast).toContain("de.shop.toastDenied");
    expect(toast).toContain("de.shop.toastUnchecked");
  });

  it("does not dress a refusal as an error", () => {
    expect(toast).not.toContain("text-danger");
    expect(toast).not.toContain('role="alert"');
    expect(toast).toContain('aria-live="polite"');
  });
});

describe("the buy button no longer renames itself", () => {
  it("has no label to swap to", () => {
    // The V10 removal, still gone: the i18n key that produced the temporary
    // "Im Warenkorb" does not exist.
    expect("inCart" in de.shop).toBe(false);
  });

  it("shows the price, before and after", () => {
    const action = code(ACTION);
    expect(action).toContain("{formatPrice(summary.price)}");
    expect(action).not.toContain("setAdded");
    expect(action).not.toContain("de.shop.addToCart}");
  });

  it("and the figure page's button keeps its own label", () => {
    const panel = code(PANEL);
    expect(panel).toContain("{de.shop.addToCart}");
    expect(panel).not.toContain("setAdded");
  });

  it("confirms through the shared add path, not from the button", () => {
    // Since V11 the toast is raised by useAddToCart, after the server has
    // answered — the buttons no longer decide anything themselves.
    for (const path of [ACTION, PANEL]) {
      const source = code(path);
      expect(source).toContain("useAddToCart()");
      expect(source).not.toContain("showCartToast");
    }
  });

  it("only adds after a condition has actually been chosen", () => {
    // Opening the chooser is not an add.
    const action = code(ACTION);
    const opener = action.slice(action.indexOf("onClick={() => setChoosing(true)}"));
    expect(opener).not.toContain("addOne(");
    expect(action.indexOf("await addOne({")).toBeLessThan(action.indexOf("if (choosing)"));
  });
});
