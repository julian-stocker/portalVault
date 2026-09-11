import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";

import { customerStatus, readMyOrders } from "./orders";
import { contactRow, hasContact, readContact, EMPTY_CONTACT } from "./contacts";
import { activeSection } from "@/lib/nav/sections";

/**
 * The account area, and the rules that keep it honest.
 *
 * `/settings` was a username field, a password field and a sign-out button in
 * one column, with nowhere to see an order and nowhere to keep an address.
 * Four named destinations replace it (ADR-0061).
 */

const source = (path: string) => readFileSync(path, "utf8");

describe("the account area is one place with four destinations", () => {
  const ROUTES = [
    "src/app/(app)/account/page.tsx",
    "src/app/(app)/account/profile/page.tsx",
    "src/app/(app)/account/contact/page.tsx",
    "src/app/(app)/account/orders/page.tsx",
    "src/app/(app)/account/security/page.tsx",
  ];

  it.each(ROUTES)("%s exists", (path) => {
    expect(existsSync(path)).toBe(true);
  });

  it("every one of them is behind a session check", () => {
    for (const path of ROUTES) {
      const page = source(path);
      expect(page, path).toContain("currentProfile()");
      expect(page, path).toContain("SIGN_IN_PATH");
    }
  });

  it("the middleware protects the whole area, not one page of it", () => {
    expect(source("src/lib/supabase/middleware.ts")).toContain('"/account"');
  });

  it("the navigation points at the hub", () => {
    expect(source("src/components/layout/site-nav.tsx")).toContain('href: "/account"');
  });

  it("the old path still resolves instead of 404ing", () => {
    // `/settings` is in bookmarks and in the onboarding flow.
    const settings = source("src/app/(app)/settings/page.tsx");
    expect(settings).toContain("permanentRedirect");
    expect(settings).toContain("/account");
  });

  it("the nav model knows the new routes", () => {
    expect(activeSection("/account")).toBe("account");
    expect(activeSection("/account/orders")).toBe("account");
    expect(activeSection("/account/orders/SI-2026-001042")).toBe("account");
    expect(activeSection("/settings")).toBe("account");
  });

  it("signing out sits on the account hub, not in the bar and not under security", () => {
    // A destructive-feeling control on every screen is one somebody
    // eventually hits by accident on a phone. But it is also not a *setting*:
    // „Konto & Sicherheit" is for changing something about the account, and
    // leaving is not a change to it (ADR-0062).
    expect(source("src/app/(app)/account/page.tsx")).toContain('action="/auth/signout"');
    expect(source("src/app/(app)/account/security/page.tsx")).not.toContain("/auth/signout");
    expect(source("src/components/layout/site-nav.tsx")).not.toContain("/auth/signout");
  });

  it("is a POST, so a prefetcher can never end somebody's session", () => {
    const hub = source("src/app/(app)/account/page.tsx");
    expect(hub).toContain('method="post"');
    expect(hub).not.toContain('href="/auth/signout"');
  });

  it("security keeps the password and is where account changes will land", () => {
    const security = source("src/app/(app)/account/security/page.tsx");
    expect(security).toContain("updatePasswordAction");
  });

  it("reuses the existing auth actions rather than growing parallel ones", () => {
    expect(source("src/app/(app)/account/profile/page.tsx")).toContain("setUsernameAction");
    expect(source("src/app/(app)/account/security/page.tsx")).toContain("updatePasswordAction");
  });
});

describe("what a customer sees about their own order", () => {
  it("folds the two state axes into one word", () => {
    expect(customerStatus("pending", "unfulfilled", false)).toBe("awaiting_payment");
    expect(customerStatus("paid", "unfulfilled", false)).toBe("paid");
    expect(customerStatus("paid", "shipped", false)).toBe("shipped");
    expect(customerStatus("paid", "completed", false)).toBe("shipped");
    expect(customerStatus("cancelled", "cancelled", false)).toBe("closed");
    expect(customerStatus("expired", "unfulfilled", false)).toBe("closed");
  });

  it("says a flagged order is being looked at, whatever else is true", () => {
    expect(customerStatus("paid", "shipped", true)).toBe("needs_attention");
    expect(customerStatus("pending", "unfulfilled", true)).toBe("needs_attention");
  });

  it("drops a row with no order number rather than rendering a blank one", () => {
    expect(readMyOrders([{ order_number: "" }, null, 7])).toEqual([]);
    expect(readMyOrders("nonsense")).toEqual([]);
  });

  it("reads a real row", () => {
    const [row] = readMyOrders([
      {
        order_number: "SI-2026-001042",
        placed_at: "2026-09-11T10:00:00Z",
        payment_status: "paid",
        fulfillment_status: "shipped",
        needs_resolution: false,
        total_amount: "9.31",
        line_count: 2,
        commerce_mode: "sandbox",
      },
    ]);
    expect(row).toEqual({
      orderNumber: "SI-2026-001042",
      placedAt: "2026-09-11T10:00:00Z",
      totalAmount: 9.31,
      lineCount: 2,
      commerceMode: "sandbox",
      status: "shipped",
    });
  });
});

describe("saved contact details", () => {
  it("turns blanks into NULL rather than storing an empty string", () => {
    const row = contactRow({ ...EMPTY_CONTACT, firstName: "  Ada  ", city: "   " });
    expect(row.first_name).toBe("Ada");
    expect(row.city).toBeNull();
    expect(row.company).toBeNull();
  });

  it("normalises the country the way the CHECK expects", () => {
    expect(contactRow({ ...EMPTY_CONTACT, countryCode: "de" }).country_code).toBe("DE");
    expect(contactRow({ ...EMPTY_CONTACT, countryCode: "" }).country_code).toBe("DE");
  });

  it("reads a row back, with missing fields as empty strings", () => {
    expect(readContact({ first_name: "Ada", city: null })).toMatchObject({
      firstName: "Ada",
      city: "",
      countryCode: "DE",
    });
    expect(readContact(null)).toBeNull();
  });

  it("knows when there is nothing worth prefilling", () => {
    expect(hasContact(null)).toBe(false);
    expect(hasContact(EMPTY_CONTACT)).toBe(false);
    // The country alone is a default, not something somebody entered.
    expect(hasContact({ ...EMPTY_CONTACT, countryCode: "DE" })).toBe(false);
    expect(hasContact({ ...EMPTY_CONTACT, city: "Berlin" })).toBe(true);
  });
});

describe("the client half reaches no server module", () => {
  /**
   * The build said so: a `"use client"` component that imports a module
   * reaching `@/lib/supabase/server` drags the server client into the browser
   * bundle. Same split as `commerce-model.ts` / `commerce.ts`.
   */
  it("the model is pure", () => {
    const model = source("src/lib/account/contact-model.ts");
    expect(model).not.toContain("@/lib/supabase/server");
    expect(model).not.toContain('from "react"');
  });

  it("the form imports the model, never the reader", () => {
    const form = source("src/components/account/contact-form.tsx");
    expect(form).toContain('from "@/lib/account/contact-model"');
    expect(form).not.toContain('from "@/lib/account/contacts"');
  });
});

describe("the checkout prefills but never delegates", () => {
  const view = source("src/components/checkout/checkout-view.tsx");

  it("takes the saved details as a starting value only", () => {
    expect(view).toContain("...(contact ?? {})");
    // What is submitted is what is in the form, and `create_order()` is what
    // snapshots it. The saved row is never sent to the database as an order.
    expect(view).toContain("const { email: contactEmail, ...address } = fields;");
  });

  it("offers to save a default only to an account", () => {
    expect(view).toContain("saveDefaultAllowed ? (");
    expect(view).toContain("saveAsDefault && saveDefaultAllowed");
  });

  it("saves the default after the order and never instead of it", () => {
    const submit = view.slice(view.indexOf("if (result.ok)"), view.indexOf("await toPayment"));
    expect(submit.indexOf("setPlaced(result.order)")).toBeLessThan(submit.indexOf("saveContact("));
    // Not awaited: a failure to remember an address must not cost the order.
    expect(submit).toContain("void saveContact(");
  });

  it("defaults the checkbox to off", () => {
    // Keeping somebody's postal address is their decision, not something
    // that happens to them.
    expect(view).toContain("useState(false)");
  });
});
