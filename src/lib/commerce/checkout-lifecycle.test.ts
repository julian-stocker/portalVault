import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import { watchPageShow, type PageShowLike } from "./checkout-lifecycle";
import { recallOpenOrder, rememberOpenOrder } from "./capability";

/**
 * B2.4 — returning to the checkout from the payment page.
 *
 * THE BUG THESE TESTS ARE FOR
 *
 * `window.location.assign()` sends the tab to Stripe and leaves this document
 * in the back/forward cache. Pressing Back restores it **with its React state
 * intact**: `redirecting` was true when the tab left, so the pay button came
 * back disabled and reading "Weiterleitung zur Zahlung", for an order that
 * existed and was still holding stock.
 *
 * No source assertion would have found that, and none of these pretends to.
 * What they do is execute the mechanism the fix rests on — the `pageshow`
 * subscription — and the storage that keeps the order reachable.
 */

/** A `window` stand-in whose `pageshow` listeners can be fired on demand. */
function fakeWindow() {
  const listeners = new Set<(event: PageShowLike) => void>();
  return {
    addEventListener: (_type: "pageshow", listener: (event: PageShowLike) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: "pageshow", listener: (event: PageShowLike) => void) => {
      listeners.delete(listener);
    },
    /** What the browser does when the document is shown again. */
    show: (persisted: boolean) => listeners.forEach((l) => l({ persisted })),
    count: () => listeners.size,
  };
}

/** The lock the component holds while a redirect is under way. */
function redirectLock() {
  const state = { redirecting: false, busy: false };
  return {
    state,
    startRedirect() {
      state.redirecting = true;
      state.busy = true;
    },
    reset() {
      state.redirecting = false;
      state.busy = false;
    },
  };
}

describe("a redirect that is under way stays locked", () => {
  it("stays locked while nothing shows the page again", () => {
    const win = fakeWindow();
    const lock = redirectLock();
    watchPageShow(win, lock.reset);

    lock.startRedirect();
    // The tab is on its way to Stripe. `pageshow` fires when a document is
    // *shown*, and this one is being hidden — so nothing unlocks it.
    expect(lock.state.redirecting).toBe(true);
    expect(lock.state.busy).toBe(true);
  });

  it("is not unlocked by subscribing alone", () => {
    const win = fakeWindow();
    const lock = redirectLock();
    lock.startRedirect();
    watchPageShow(win, lock.reset);
    expect(lock.state.redirecting).toBe(true);
  });
});

describe("showing the page again clears a stuck redirect", () => {
  it("unlocks on a back/forward cache restore", () => {
    const win = fakeWindow();
    const lock = redirectLock();
    watchPageShow(win, lock.reset);

    lock.startRedirect();
    win.show(true); // persisted: the bfcache case that caused the bug

    expect(lock.state.redirecting).toBe(false);
    expect(lock.state.busy).toBe(false);
  });

  it("unlocks on an ordinary show too, and that is deliberate", () => {
    /*
     * `persisted` is not branched on. Browsers have disagreed about when they
     * report it, and one that restores state while reporting `false` would
     * reproduce the bug in exactly the place a branch was meant to prevent it.
     * On a fresh load there is no stuck redirect, so resetting is a no-op.
     */
    const win = fakeWindow();
    const lock = redirectLock();
    watchPageShow(win, lock.reset);

    lock.startRedirect();
    win.show(false);

    expect(lock.state.redirecting).toBe(false);
  });

  it("reports persisted to the handler without deciding on it", () => {
    const win = fakeWindow();
    const seen: boolean[] = [];
    watchPageShow(win, (persisted) => seen.push(persisted));

    win.show(true);
    win.show(false);
    // An event object without the field at all, as an older browser may send.
    win.addEventListener("pageshow", () => {});
    expect(seen).toEqual([true, false]);
  });

  it("treats a missing persisted flag as not persisted, and still unlocks", () => {
    const win = fakeWindow();
    const lock = redirectLock();
    const seen: boolean[] = [];
    watchPageShow(win, (persisted) => {
      seen.push(persisted);
      lock.reset();
    });

    lock.startRedirect();
    // @ts-expect-error — deliberately the shape a browser without the field sends
    win.show(undefined);

    expect(seen).toEqual([false]);
    expect(lock.state.redirecting).toBe(false);
  });

  it("unsubscribes, so a remounted view leaves nothing behind", () => {
    const win = fakeWindow();
    const lock = redirectLock();
    const stop = watchPageShow(win, lock.reset);
    expect(win.count()).toBe(1);

    stop();
    expect(win.count()).toBe(0);

    lock.startRedirect();
    win.show(true);
    expect(lock.state.redirecting).toBe(true);
  });
});

describe("the existing order stays the thing that gets paid", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    const backing = new Map<string, string>();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (k: string) => backing.get(k) ?? null,
        setItem: (k: string, v: string) => void backing.set(k, v),
        removeItem: (k: string) => void backing.delete(k),
      },
    });
  });

  it("is recoverable after a Back that carries no order number", () => {
    /*
     * Stripe's cancel_url returns to `/checkout?order=…`, but a browser Back
     * returns to `/checkout` with no query at all. If that Back was not served
     * from the bfcache, this lookup is the only thing between the customer and
     * an order that is holding their stock.
     */
    rememberOpenOrder({ orderId: 42, orderNumber: "SI-2026-001030" });
    expect(recallOpenOrder()).toEqual({ orderId: 42, orderNumber: "SI-2026-001030" });
  });

  it("still refuses an order number that is not this tab's", () => {
    // The number comes from the URL and is therefore suppliable by anyone.
    rememberOpenOrder({ orderId: 42, orderNumber: "SI-2026-001030" });
    expect(recallOpenOrder("SI-2026-000001")).toBeNull();
    expect(recallOpenOrder("SI-2026-001030")).toEqual({
      orderId: 42,
      orderNumber: "SI-2026-001030",
    });
  });

  it("recovers nothing when this tab placed nothing", () => {
    expect(recallOpenOrder()).toBeNull();
  });

  it("keeps the capability untouched by the reset", () => {
    // The lock is transient; the secret is not. Clearing it here would strand
    // the very order the reset exists to rescue.
    const lifecycle = readFileSync("src/lib/commerce/checkout-lifecycle.ts", "utf8")
      .split("\n")
      .filter((line) => {
        const t = line.trimStart();
        return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
      })
      .join("\n");
    // The header explains in prose that storage stays untouched; only the
    // statements are the contract.
    expect(lifecycle).not.toContain("forgetPaymentToken");
    expect(lifecycle).not.toContain("sessionStorage");
    expect(lifecycle).not.toContain("localStorage");
  });
});

describe("the checkout wires the reset up, and keeps its other guards", () => {
  const view = readFileSync("src/components/checkout/checkout-view.tsx", "utf8");

  it("subscribes to pageshow and clears exactly the lock", () => {
    expect(view).toContain("watchPageShow(window");
    expect(view).toContain("busy.current = false;");
    expect(view).toContain("setRedirecting(false);");
  });

  it("does not clear the order or the capability on the way back", () => {
    const reset = view.slice(view.indexOf("watchPageShow(window"), view.indexOf("Coming back from a cancelled payment"));
    expect(reset).not.toContain("setPlaced(null)");
    expect(reset).not.toContain("forgetPaymentToken");
    expect(reset).not.toContain("forgetOpenOrder");
    expect(reset).not.toContain("clear()");
  });

  it("still guards against a double click before the first await", () => {
    // Unchanged by this fix, and the reason two taps in one frame cannot both
    // place an order.
    expect(view).toContain("if (busy.current) return;");
    expect(view).toContain("busy.current = true;");
  });

  it("still disables the button while a redirect is running", () => {
    expect(view).toContain("disabled={redirecting}");
  });

  it("starts no second payment session of its own", () => {
    // Resuming hands the SAME order id back to create-payment, which returns
    // the open attempt and replays the same Stripe session.
    expect(view).toContain("startPayment(order.orderId, order.orderNumber)");
    expect(view).not.toContain("newCheckoutCredentials()\n");
  });
});
