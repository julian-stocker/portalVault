import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import {
  capabilityStorageKey,
  forgetOpenOrder,
  forgetPaymentToken,
  newPaymentToken,
  recallOpenOrder,
  recallPaymentToken,
  rememberOpenOrder,
  rememberPaymentToken,
} from "./capability";

/**
 * B2.4 — the capability has to survive a trip to another domain (ADR-0056).
 *
 * Until now it lived in memory for a few seconds. Persisting it is a real
 * widening of the attack surface, so the rules around it are worth asserting
 * rather than trusting: the right storage, one key per order, forgotten when
 * it stops answering anything, and never anywhere a URL or a log can see it.
 */

/** A minimal sessionStorage that can also be made to throw, as Safari does. */
function installStorage(): Map<string, string> {
  const backing = new Map<string, string>();
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
    },
  });
  return backing;
}

const ORDER = "SI-2026-001022";
const TOKEN = "a".repeat(64);

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("the capability round-trips through sessionStorage", () => {
  it("remembers and recalls a token for its own order", () => {
    installStorage();
    rememberPaymentToken(ORDER, TOKEN);
    expect(recallPaymentToken(ORDER)).toBe(TOKEN);
  });

  it("keys by order number, so two checkouts cannot collide", () => {
    const backing = installStorage();
    rememberPaymentToken(ORDER, TOKEN);
    rememberPaymentToken("SI-2026-001023", "b".repeat(64));

    expect(recallPaymentToken(ORDER)).toBe(TOKEN);
    expect(recallPaymentToken("SI-2026-001023")).toBe("b".repeat(64));
    expect(backing.size).toBe(2);
    expect(capabilityStorageKey(ORDER)).not.toBe(capabilityStorageKey("SI-2026-001023"));
  });

  it("returns null for an order it never stored", () => {
    installStorage();
    expect(recallPaymentToken("SI-2026-999999")).toBeNull();
  });

  it("refuses to store or return a malformed token", () => {
    const backing = installStorage();
    // A stored value that is not a 64-hex capability cannot be one of ours,
    // and sending it would only produce a pointless round trip.
    rememberPaymentToken(ORDER, "not-a-token");
    expect(backing.size).toBe(0);

    backing.set(capabilityStorageKey(ORDER), "nonsense");
    expect(recallPaymentToken(ORDER)).toBeNull();
  });

  it("forgets on request", () => {
    const backing = installStorage();
    rememberPaymentToken(ORDER, TOKEN);
    forgetPaymentToken(ORDER);
    expect(recallPaymentToken(ORDER)).toBeNull();
    expect(backing.size).toBe(0);
  });

  it("survives a browser that refuses storage entirely", () => {
    // Safari in private mode throws rather than returning null. A checkout
    // must not die because a browser declines to remember something.
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        },
        removeItem: () => {
          throw new Error("denied");
        },
      },
    });
    expect(() => rememberPaymentToken(ORDER, TOKEN)).not.toThrow();
    expect(recallPaymentToken(ORDER)).toBeNull();
    expect(() => forgetPaymentToken(ORDER)).not.toThrow();
  });

  it("generates tokens that match the stored shape", () => {
    installStorage();
    const fresh = newPaymentToken();
    rememberPaymentToken(ORDER, fresh);
    expect(recallPaymentToken(ORDER)).toBe(fresh);
  });
});

describe("the open order is remembered separately from the secret", () => {
  it("recalls only the order it was asked about", () => {
    installStorage();
    rememberOpenOrder({ orderId: 23, orderNumber: ORDER });
    expect(recallOpenOrder(ORDER)).toEqual({ orderId: 23, orderNumber: ORDER });
    // An order number from anywhere else — a guessed one, a shared link —
    // matches nothing and reveals nothing.
    expect(recallOpenOrder("SI-2026-000001")).toBeNull();
  });

  it("refuses a stored value that is not a usable id", () => {
    const backing = installStorage();
    for (const bad of ['{"orderNumber":"' + ORDER + '","orderId":0}', "{", '{"orderId":23}']) {
      backing.set("skyisles.pay.v1.open", bad);
      expect(recallOpenOrder(ORDER), bad).toBeNull();
    }
  });

  it("forgets on request", () => {
    installStorage();
    rememberOpenOrder({ orderId: 23, orderNumber: ORDER });
    forgetOpenOrder();
    expect(recallOpenOrder(ORDER)).toBeNull();
  });

  it("does not store the capability alongside it", () => {
    const backing = installStorage();
    rememberOpenOrder({ orderId: 23, orderNumber: ORDER });
    for (const value of backing.values()) {
      expect(value).not.toContain(TOKEN);
      expect(value).not.toMatch(/[0-9a-f]{64}/);
    }
  });
});

// ---------------------------------------------------------------------------

describe("the capability never leaves the places it is allowed to be", () => {
  const files = [
    "src/lib/commerce/capability.ts",
    "src/lib/commerce/start-payment.ts",
    "src/components/checkout/checkout-view.tsx",
    "src/components/checkout/payment-status.tsx",
    "src/app/(public)/checkout/erfolg/page.tsx",
    "src/app/(public)/checkout/page.tsx",
  ].map((path) => [path, readFileSync(path, "utf8")] as const);

  const code = (text: string) =>
    text
      .split("\n")
      .filter((line) => {
        const t = line.trimStart();
        return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
      })
      .join("\n");

  it("is never written to localStorage", () => {
    // sessionStorage dies with the tab; localStorage would outlive the
    // customer's visit on a shared computer.
    for (const [path, text] of files) {
      expect(code(text), path).not.toContain("localStorage");
    }
  });

  it("never reaches a URL or a query string", () => {
    for (const [path, text] of files) {
      const body = code(text);
      expect(body, path).not.toMatch(/searchParams\.set\([^)]*token/i);
      expect(body, path).not.toMatch(/[?&]token=/);
      expect(body, path).not.toMatch(/\$\{token\}/);
    }
  });

  it("never reaches a log line", () => {
    for (const [path, text] of files) {
      const body = code(text);
      expect(body, path).not.toMatch(/console\.[a-z]+\([^)]*token/i);
      expect(body, path).not.toMatch(/console\.[a-z]+\([^)]*credentials/i);
    }
  });

  it("is read in exactly two places", () => {
    // Starting a payment, and reading that payment's state back. A third
    // reader would be a third thing to audit.
    const readers = files.filter(
      ([path, text]) => path !== "src/lib/commerce/capability.ts" && code(text).includes("recallPaymentToken"),
    );
    expect(readers.map(([path]) => path).sort()).toEqual([
      "src/components/checkout/payment-status.tsx",
      "src/lib/commerce/start-payment.ts",
    ]);
  });
});
