/**
 * `placeOrder()` and the shown terms (ADR-0184, AP5): the action sends the
 * versions the checkout displayed, exactly as given, and names the database's
 * refusal. The refusal itself is the database's — see
 * `create-order-terms-0191.test.ts`.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const MOCK = vi.hoisted(() => ({
  calls: [] as { name: string; args: Record<string, unknown> }[],
  answer: { data: null as unknown, error: null as { code?: string } | null },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      MOCK.calls.push({ name, args });
      return MOCK.answer;
    },
    functions: { invoke: async () => ({ data: null, error: null }) },
  }),
}));

const { placeOrder } = await import("./actions");

const DRAFT = {
  email: "k@example.org",
  items: [{ skyId: "SKY-0001", condition: "loose" as const, quantity: 1 }],
  address: {
    firstName: "Erika", lastName: "Beispiel", street: "Weg", houseNumber: "1",
    postalCode: "10115", city: "Berlin", countryCode: "DE",
  },
  shippingMethod: "hermes" as const,
};
const CREDENTIALS = { requestId: "req-12345678", paymentToken: "a".repeat(64) };
const PLACED = [{ order_id: 7, order_number: "SI-000007", items_subtotal: "12.00", shipping_amount: "4.99", total_amount: "16.99" }];

afterEach(() => { MOCK.calls.length = 0; MOCK.answer = { data: null, error: null }; });

describe("the versions travel with the order", () => {
  it("sends exactly the versions the checkout showed — not this deployment's", async () => {
    MOCK.answer = { data: PLACED, error: null };
    const result = await placeOrder(DRAFT, CREDENTIALS, { agb: "2026-09-17", widerruf: "2026-09-17" });
    expect(result.ok).toBe(true);
    const call = MOCK.calls.find((c) => c.name === "create_order")!;
    expect(call.args).toMatchObject({ p_agb_version: "2026-09-17", p_widerruf_version: "2026-09-17" });
    // Eight named arguments: the coupled signature, never the old six.
    expect(Object.keys(call.args).sort()).toEqual([
      "p_address", "p_agb_version", "p_email", "p_items", "p_payment_token",
      "p_request_id", "p_shipping_method", "p_widerruf_version",
    ]);
  });

  it("LV002 — the terms changed: terms_changed, nothing else assumed", async () => {
    MOCK.answer = { data: null, error: { code: "LV002" } };
    expect(await placeOrder(DRAFT, CREDENTIALS, { agb: "2026-09-17", widerruf: "2026-09-17" }))
      .toEqual({ ok: false, reason: "terms_changed" });
  });

  it("LV001 — a version missing — is a broken client: failed", async () => {
    MOCK.answer = { data: null, error: { code: "LV001" } };
    expect(await placeOrder(DRAFT, CREDENTIALS, { agb: "2026-09-17", widerruf: "2026-09-17" }))
      .toEqual({ ok: false, reason: "failed" });
  });

  it.each([
    [{ agb: "", widerruf: "2026-11-11" }],
    [{ agb: "2026-11-11", widerruf: "latest" }],
    [undefined as unknown as { agb: string; widerruf: string }],
  ])("a malformed version is refused before the round trip: %j", async (shown) => {
    expect(await placeOrder(DRAFT, CREDENTIALS, shown)).toEqual({ ok: false, reason: "failed" });
    expect(MOCK.calls).toHaveLength(0);
  });
});

describe("the checkout", () => {
  const view = readFileSync("src/components/checkout/checkout-view.tsx", "utf8");
  const page = readFileSync("src/app/(public)/checkout/page.tsx", "utf8");

  it("gets the shown versions from the database when the page renders, and sends them", () => {
    // The versions in force (`legal_versions_public()`, 0191) — not this deployment's.
    expect(page).toContain("const versions = await fetchLegalVersions();");
    expect(page).toContain("terms={terms}");
    expect(page).toMatch(/versions\.status === "ok" \? \{ agb: versions\.versions\.agb, widerruf: versions\.versions\.widerruf \} : null/);
    expect(page).not.toMatch(/LEGAL_VERSIONS|SHOWN_TERMS/);
    expect(view).toMatch(/credentials\.current!,\s*terms,\s*\)/);
  });

  it("without the versions in force it places nothing and says why", () => {
    const submit = view.slice(view.indexOf("async function submit()"));
    // Refused before the round trip, before anything is sent.
    expect(submit.indexOf("if (!terms) {")).toBeLessThan(submit.indexOf("await placeOrder("));
    expect(submit.slice(submit.indexOf("if (!terms) {"), submit.indexOf("await placeOrder("))).toContain("de.checkout.errorTermsUnavailable");
    expect(view).toContain("disabled={!terms}");
    expect(view).toContain("copy.legalUnavailable");
  });

  it("says what happened on terms_changed — and keeps the basket", () => {
    expect(view).toContain('result.reason === "terms_changed"');
    expect(view).toContain("de.checkout.errorTermsChanged");
    // The basket is cleared only after an order exists.
    const submit = view.slice(view.indexOf("async function submit()"), view.indexOf("async function toPayment") > 0
      ? view.indexOf("async function toPayment") : undefined);
    const okBranch = submit.slice(submit.indexOf("if (result.ok) {"), submit.indexOf('if (result.reason === "invalid")'));
    expect(okBranch).toContain("clear();");
    expect(submit.slice(submit.indexOf('if (result.reason === "invalid")'))).not.toContain("clear()");
  });

  it("links the exact versions it sends, by version", () => {
    expect(view).toContain('legalTextPath("agb", terms.agb)');
    expect(view).toContain('legalTextPath("widerruf", terms.widerruf)');
    // A client component must not pull the archived texts into the bundle.
    expect(view).not.toContain("@/lib/legal/archive");
  });
});
