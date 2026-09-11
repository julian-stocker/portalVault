import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

import { DEFAULT_SHIPPING_METHOD } from "@/lib/commerce/shipping";
import { de } from "@/lib/i18n/de";

/**
 * The checkout screen (B1).
 *
 * This product has no renderer in its tests, so the interface is held to its
 * contract through its source — the same way the cart and the floating cart
 * are. What matters here is what the screen must **not** do: reserve anything
 * on load, compute a price of its own, show a VAT line, or claim that a
 * payment happened.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      // "{/*" as well: a JSX comment is prose too, and this file asserts on
      // words that legitimately appear when explaining why they are absent.
      return (
        !trimmed.startsWith("*") &&
        !trimmed.startsWith("//") &&
        !trimmed.startsWith("/*") &&
        !trimmed.startsWith("{/*")
      );
    })
    .join("\n");
}

const PAGE = "src/app/(public)/checkout/page.tsx";
const VIEW = "src/components/checkout/checkout-view.tsx";
const CART = "src/components/cart/cart-view.tsx";

const view = code(VIEW);

describe("the route exists and works signed out", () => {
  it("is mounted at /checkout", () => {
    expect(existsSync(PAGE)).toBe(true);
  });

  it("loads the shop but requires no session", () => {
    const page = code(PAGE);
    expect(page).toContain("fetchOffers()");
    // The session is read only to prefill a field; there is no redirect.
    expect(page).toContain("supabase.auth.getUser()");
    expect(page).not.toContain("redirect(");
    expect(page).not.toContain("/login");
  });

  it("prefills the contact address for a signed-in customer", () => {
    expect(code(PAGE)).toContain('email={data.user?.email ?? ""}');
    // Still a snapshot: the order carries what the form submitted.
    expect(view).toContain("email: contact");
  });
});

describe("opening the checkout reserves nothing", () => {
  it("calls no order or reservation function on load", () => {
    // Everything above the submit handler runs on render.
    const beforeSubmit = view.slice(0, view.indexOf("async function submit()"));
    expect(beforeSubmit).not.toContain("placeOrder(");
    expect(view).not.toMatch(/reserve_for_order|create_order/);
  });

  it("only asks what shipping would cost", () => {
    expect(view).toContain("shippingOptions(subtotal)");
  });

  it("places the order exactly once, from the submit handler", () => {
    expect((view.match(/await placeOrder\(/g) ?? [])).toHaveLength(1);
  });
});

describe("the cart leads here", () => {
  it("offers a checkout action", () => {
    const cart = code(CART);
    expect(cart).toContain('href="/checkout"');
    expect(cart).toContain("de.cart.toCheckout");
    expect(de.cart.toCheckout).toBe("Zur Kasse");
  });

  it("no longer says that ordering is impossible", () => {
    expect(code(CART)).not.toContain("de.cart.noCheckout");
  });
});

describe("shipping on screen", () => {
  it("preselects Hermes", () => {
    expect(view).toContain("useState<ShippingMethod>(DEFAULT_SHIPPING_METHOD)");
    expect(DEFAULT_SHIPPING_METHOD).toBe("hermes");
  });

  it("shows both methods, and keeps showing them when they are free", () => {
    // Hiding the choice because it costs nothing would remove the choice.
    expect(view).toContain("options.map((option)");
    expect(view).toContain("de.checkout.shippingFree");
    expect(view).not.toMatch(/options\.filter|amount\s*>\s*0\s*&&/);
  });

  it("takes every amount from the server", () => {
    expect(view).not.toMatch(/5\.49|6\.49|\b75\b/);
    expect(view).toContain("shippingOptions");
  });
});

describe("the summary states no tax", () => {
  it("shows subtotal, shipping and total, and nothing else", () => {
    expect(view).toContain("de.checkout.itemsSubtotal");
    expect(view).toContain("de.checkout.shipping");
    expect(view).toContain("de.checkout.total");
  });

  it("shows no net line, no VAT line and no 'inkl. MwSt.'", () => {
    // Under the small-business scheme no VAT is levied; a 0 % line would
    // state something untrue.
    // Word boundaries: "justify-between" contains "ust".
    expect(view).not.toMatch(/\bMwSt|\bUSt\b|\bnetto\b|\bbrutto\b|\bVAT\b|\btax\b/i);
    const strings = JSON.stringify(de.checkout);
    expect(strings).not.toMatch(/\bMwSt|\bUSt\b|Umsatzsteuer|\bnetto\b|\bbrutto\b/i);
  });
});

describe("nothing claims a payment happened unless the database says so", () => {
  it("uses the label that a payment obligation legally requires", () => {
    /*
     * § 312j Abs. 3 BGB. Until B2.3 this button created no obligation — it
     * reserved stock and nothing else — so the neutral wording was correct and
     * this test asserted it. B2.4 sends the customer straight to the payment
     * page, so the obligation now arises here and the label has to say so.
     */
    expect(de.checkout.submit).toBe("Zahlungspflichtig bestellen");
  });

  it("says plainly what the next step is", () => {
    expect(view).toContain("de.checkout.paymentFollows");
    expect(de.checkout.paymentFollows).toMatch(/weitergeleitet/);
  });

  it("claims money changed hands only where the database was asked", () => {
    /*
     * The rule that survives B2.4, and the one that matters.
     *
     * Everything the customer reads before and during checkout must stay free
     * of any claim that a payment succeeded. Only `result.confirmed*` may say
     * it, and that copy is shown solely for `viewFor(...) === "confirmed"` —
     * which comes from `order_payment_state()` and never from the redirect.
     */
    const { result, ...beforePayment } = de.checkout;
    const strings = JSON.stringify(beforePayment);
    for (const claim of [
      "erfolgreich bezahlt",
      "Zahlung erhalten",
      "Zahlung abgeschlossen",
      "Zahlung erfolgreich",
      "Zahlung bestätigt",
      "Vielen Dank für deinen Einkauf",
    ]) {
      expect(strings, claim).not.toContain(claim);
    }

    /*
     * And the waiting state must not quietly imply success.
     *
     * Checked against completed forms rather than against the word stem:
     * "Zahlung wird bestätigt" is the progressive and is exactly right for a
     * webhook still in flight, while "Zahlung bestätigt" would be a claim. A
     * cruder test would have forbidden the correct wording.
     */
    const waiting = `${result.awaitingTitle} ${result.awaitingHint}`;
    expect(waiting).not.toMatch(/\berhalten\b|\berfolgreich\b|\babgeschlossen\b/);
    expect(waiting).not.toMatch(/Zahlung bestätigt/);
    // It has to say, positively, that this is not settled yet.
    expect(waiting).toMatch(/wird|noch nicht/);
  });
});

describe("submitting", () => {
  it("guards against a second tap in the same frame", () => {
    expect(view).toContain("const busy = useRef(false);");
    expect(view).toContain("if (busy.current) return;");
    const guard = view.indexOf("if (busy.current) return;");
    expect(guard).toBeLessThan(view.indexOf("await placeOrder("));
    expect(view).toContain("disabled={pending}");
  });

  it("releases the guard however the attempt ends", () => {
    expect(view).toContain("} finally {");
    expect(view).toContain("busy.current = false;");
  });

  it("relies on the server for real idempotency", () => {
    // The client guard stops a double tap; request_id is what makes a retry
    // safe, and that lives in the action and the database.
    const action = code("src/lib/commerce/actions.ts");
    expect(action).toContain("p_request_id");
  });
});

describe("what happens when it fails", () => {
  it("keeps the cart", () => {
    // clear() is reached only on the success path.
    const success = view.indexOf("if (result.ok)");
    const clear = view.indexOf("clear();");
    expect(clear).toBeGreaterThan(success);
    expect(view.slice(success, clear)).not.toContain("return;\n      }");
  });

  it("tells the three refusals apart", () => {
    expect(view).toContain("de.checkout.errorUnavailable");
    expect(view).toContain("de.checkout.errorThrottled");
    expect(view).toContain("de.checkout.errorFailed");
  });

  it("shows no database detail to a customer", () => {
    expect(view).not.toMatch(/error\.message|error\.code|supabase|postgres|PGRST/i);
    for (const message of Object.values(de.checkout.problem)) {
      expect(message).not.toMatch(/sql|constraint|null|violation|PGRST|42\d\d\d/i);
    }
  });

  it("names every draft problem in German", () => {
    for (const problem of [
      "no_items",
      "too_many_items",
      "invalid_item",
      "invalid_quantity",
      "duplicate_item",
      "invalid_email",
      "incomplete_address",
      "invalid_country",
      "invalid_shipping_method",
    ] as const) {
      expect(de.checkout.problem[problem], `${problem} has no message`).toBeTruthy();
    }
  });
});

describe("after a successful order", () => {
  it("clears the cart, because the stock is now really held", () => {
    expect(view).toContain("clear();");
  });

  it("shows the order number and the confirmed amounts", () => {
    expect(view).toContain("placed.orderNumber");
    expect(view).toContain("placed.totalAmount");
    expect(view).toContain("placed.shippingAmount");
  });

  it("shows amounts the server confirmed, not its own arithmetic", () => {
    // A guest order cannot be read back, so create_order() hands the figures
    // out of the transaction that decided them.
    const action = code("src/lib/commerce/actions.ts");
    expect(action).toContain("items_subtotal");
    expect(action).toContain("total_amount");
  });
});

describe("Germany only, without pretending to offer a choice", () => {
  it("shows the country as a fact rather than a one-option select", () => {
    expect(view).toContain("de.checkout.countryFixed");
    expect(view).not.toContain("<select");
  });

  it("submits DE and nothing else", () => {
    expect(view).toContain("countryCode: DELIVERY_COUNTRY");
  });
});
