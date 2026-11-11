/**
 * The Stripe overview says only what the Checkout code really does
 * (ADR-0184, AP7). Held against `buildSessionForm()`, not against memory.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DASHBOARD_ONLY, NOT_SENT_TO_STRIPE, SENT_TO_STRIPE, STRIPE_DASHBOARD_URL } from "./stripe-facts";

const SESSION = readFileSync("supabase/functions/create-payment/session.ts", "utf8");
const form = SESSION.slice(SESSION.indexOf("export function buildSessionForm"), SESSION.indexOf("return form;"));
const sets = [...form.matchAll(/form\.set\(\s*[`"]([a-z_]+)/g)].map((m) => m[1]);

describe("what SkyIsles sends", () => {
  it("every listed field is set by buildSessionForm()", () => {
    for (const fact of SENT_TO_STRIPE) {
      const field = fact.field === "success_url" ? "success_url" : fact.field;
      expect(sets, fact.field).toContain(field);
    }
  });

  it("…and nothing it sets is left off the list", () => {
    const listed = new Set(SENT_TO_STRIPE.map((f) => f.field));
    /* cancel_url travels with success_url (both are the return pages). */
    for (const field of sets.filter((f) => f !== "cancel_url")) expect(listed, field).toContain(field);
  });

  it("the shipping line is named as the code names it", () => {
    expect(SESSION).toContain("`Versand · ${order.shipping_method_name}`");
    expect(SENT_TO_STRIPE.find((f) => f.field === "line_items")!.detail).toContain("Versand · <Versandart>");
  });
});

describe("what SkyIsles does not send", () => {
  it("none of these is set — so the dashboard decides", () => {
    for (const fact of NOT_SENT_TO_STRIPE) {
      expect(form, fact.field).not.toMatch(new RegExp(`form\\.set\\(\\s*[\`"]${fact.field}`));
      expect(form, fact.field).not.toContain(`payment_intent_data[${fact.field}`);
    }
    expect(SESSION).not.toContain("statement_descriptor");
  });
});

describe("dashboard settings are unknown here, not guessed", () => {
  it("lists the five the operator asked about", () => {
    const labels = DASHBOARD_ONLY.map((f) => f.label).join(" | ");
    for (const word of ["Unternehmensname", "Statement Descriptor", "Zahlungsbelege", "Branding", "Zahlungsarten"]) {
      expect(labels, word).toContain(word);
    }
  });

  it("the module calls nothing and holds no secret", () => {
    const source = readFileSync("src/lib/identity/stripe-facts.ts", "utf8");
    for (const forbidden of ["fetch(", "api.stripe.com", "STRIPE_SECRET", "sk_live", "sk_test", "process.env"]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
    expect(STRIPE_DASHBOARD_URL).toBe("https://dashboard.stripe.com/settings");
  });
});
