import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  draftPayload,
  MAX_ORDER_ITEMS,
  validateDraft,
  type DraftAddress,
  type OrderDraft,
} from "@/lib/commerce/order";
import {
  expiryFrom,
  holdsStock,
  RESERVATION_STATES,
  RESERVATION_TTL_MINUTES,
} from "@/lib/commerce/reservation";

/**
 * The draft, before it is worth a round trip (Phase A).
 *
 * Everything that decides money or availability is in SQL and is covered by
 * `schema.test.ts`. What is testable here is the shape of a checkout request
 * and — just as importantly — what it is structurally incapable of carrying.
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

const ADDRESS: DraftAddress = {
  firstName: "Julian",
  lastName: "Stocker",
  street: "Beispielweg",
  houseNumber: "7a",
  postalCode: "6020",
  city: "Köln",
  countryCode: "DE",
};

const DRAFT: OrderDraft = {
  email: "kunde@example.com",
  items: [{ skyId: "SKY-0007", condition: "loose", quantity: 1 }],
  address: ADDRESS,
  shippingMethod: "hermes",
};

describe("a complete draft", () => {
  it("has nothing wrong with it", () => {
    expect(validateDraft(DRAFT)).toEqual([]);
  });

  it("survives optional fields being absent", () => {
    expect(validateDraft({ ...DRAFT, address: { ...ADDRESS, company: undefined } })).toEqual([]);
  });
});

describe("what makes a draft unusable", () => {
  it("refuses an empty basket", () => {
    expect(validateDraft({ ...DRAFT, items: [] })).toContain("no_items");
  });

  it("refuses an absurd number of lines", () => {
    const items = Array.from({ length: MAX_ORDER_ITEMS + 1 }, (_, i) => ({
      skyId: `SKY-${String(i + 1).padStart(4, "0")}`,
      condition: "loose" as const,
      quantity: 1,
    }));
    expect(validateDraft({ ...DRAFT, items })).toContain("too_many_items");
  });

  it("refuses a malformed SKY-ID or an unknown condition", () => {
    expect(validateDraft({ ...DRAFT, items: [{ skyId: "bash", condition: "loose", quantity: 1 }] }))
      .toContain("invalid_item");
    expect(
      validateDraft({
        ...DRAFT,
        items: [{ skyId: "SKY-0007", condition: "sealed" as never, quantity: 1 }],
      }),
    ).toContain("invalid_item");
  });

  it("refuses quantities no cart line may hold", () => {
    for (const quantity of [0, -1, 1.5, 100]) {
      expect(validateDraft({ ...DRAFT, items: [{ ...DRAFT.items[0], quantity }] })).toContain(
        "invalid_quantity",
      );
    }
  });

  it("refuses the same article twice", () => {
    // The cart's identity rule (ADR-0043): two lines for one article could
    // never be reconciled against one reservation.
    const items = [
      { skyId: "SKY-0007", condition: "loose" as const, quantity: 1 },
      { skyId: "SKY-0007", condition: "loose" as const, quantity: 2 },
    ];
    expect(validateDraft({ ...DRAFT, items })).toContain("duplicate_item");
  });

  it("accepts the same figure in two conditions, which is two articles", () => {
    const items = [
      { skyId: "SKY-0007", condition: "loose" as const, quantity: 1 },
      { skyId: "SKY-0007", condition: "boxed" as const, quantity: 1 },
    ];
    expect(validateDraft({ ...DRAFT, items })).toEqual([]);
  });

  it("refuses a contact address that cannot be one", () => {
    for (const email of ["", "kunde", "kunde@", "@example.com"]) {
      expect(validateDraft({ ...DRAFT, email })).toContain("invalid_email");
    }
  });

  it("refuses an address missing anything a parcel needs", () => {
    for (const field of ["firstName", "lastName", "street", "houseNumber", "postalCode", "city"] as const) {
      const address = { ...ADDRESS, [field]: "  " };
      expect(validateDraft({ ...DRAFT, address })).toContain("incomplete_address");
    }
  });

  it("refuses any country but Germany", () => {
    // V1 delivers to Germany only. The database refuses the rest too — this
    // is so the form can say so before spending a round trip.
    for (const countryCode of ["", "D", "DEU", "12", "AT", "CH", "JP"]) {
      expect(validateDraft({ ...DRAFT, address: { ...ADDRESS, countryCode } })).toContain(
        "invalid_country",
      );
    }
  });

  it("accepts Germany however it is cased", () => {
    for (const countryCode of ["DE", "de", "De"]) {
      expect(validateDraft({ ...DRAFT, address: { ...ADDRESS, countryCode } })).toEqual([]);
    }
  });

  it("refuses a shipping method that does not exist", () => {
    for (const shippingMethod of ["", "post", "ups", "free_shipping"] as const) {
      expect(
        validateDraft({ ...DRAFT, shippingMethod: shippingMethod as never }),
      ).toContain("invalid_shipping_method");
    }
  });

  it("reports every problem at once, each only once", () => {
    const problems = validateDraft({
      email: "nope",
      items: [
        { skyId: "bad", condition: "loose", quantity: 1 },
        { skyId: "worse", condition: "loose", quantity: 1 },
      ],
      address: { ...ADDRESS, city: "" },
      shippingMethod: "hermes",
    });
    expect(problems).toContain("invalid_email");
    expect(problems).toContain("invalid_item");
    expect(problems).toContain("incomplete_address");
    expect(new Set(problems).size).toBe(problems.length);
  });
});

describe("which countries may be delivered to", () => {
  it("is one, and it is named in one place", () => {
    // Germany only in V1. The constant lives in shipping.ts and the database
    // enforces it again — the form check is a courtesy, not the gate.
    expect(code("src/lib/commerce/order.ts")).toContain("DELIVERY_COUNTRY");
    expect(code("src/lib/commerce/shipping.ts")).toContain('DELIVERY_COUNTRY = "DE"');
  });
});

describe("the payload carries intent, never money", () => {
  const payload = draftPayload(DRAFT);

  it("sends only what the customer chose", () => {
    expect(Object.keys(payload).sort()).toEqual([
      "p_address",
      "p_email",
      "p_items",
      "p_shipping_method",
    ]);
    expect(payload.p_shipping_method).toBe("hermes");
    expect(payload.p_items).toEqual([{ sky_id: "SKY-0007", condition: "loose", quantity: 1 }]);
  });

  it("has no field for a price, a total or a discount", () => {
    const serialised = JSON.stringify(payload).toLowerCase();
    for (const forbidden of ["price", "total", "amount", "discount", "subtotal", "available"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it("names a carrier but never what it costs", () => {
    // The whole point: choosing DHL and sending 0,00 € is impossible because
    // there is no parameter to send it in.
    expect(JSON.stringify(payload)).toContain("hermes");
    expect(Object.keys(payload)).not.toContain("p_shipping_amount");
  });

  it("trims what people type and normalises the country", () => {
    const messy = draftPayload({
      ...DRAFT,
      email: "  kunde@example.com  ",
      address: { ...ADDRESS, countryCode: "de", city: "  Köln " },
    });
    expect(messy.p_email).toBe("kunde@example.com");
    expect(messy.p_address.country_code).toBe("DE");
    expect(messy.p_address.city).toBe("Köln");
  });

  it("turns an empty optional into NULL rather than an empty string", () => {
    expect(draftPayload({ ...DRAFT, address: { ...ADDRESS, company: "  " } }).p_address.company).toBeNull();
  });
});

describe("the reservation vocabulary", () => {
  it("holds stock in exactly one of its three states", () => {
    expect(RESERVATION_STATES.filter(holdsStock)).toEqual(["active"]);
  });

  it("expires twenty minutes out", () => {
    const now = new Date("2026-09-07T12:00:00Z");
    expect(expiryFrom(now).toISOString()).toBe("2026-09-07T12:20:00.000Z");
    expect(RESERVATION_TTL_MINUTES).toBe(20);
  });
});

describe("the server action stays a wrapper", () => {
  const action = code("src/lib/commerce/actions.ts");
  /** Just placeOrder: the file also holds the shipping quote action. */
  const place = action.slice(action.indexOf("export async function placeOrder"));

  it("validates before it spends a round trip", () => {
    expect(place.indexOf("validateDraft(draft)")).toBeLessThan(place.indexOf("supabase.rpc("));
  });

  it("calls the one function that creates orders", () => {
    expect(place).toContain('supabase.rpc("create_order"');
  });

  it("asks the server what shipping costs instead of computing it", () => {
    // No price and no threshold appear in TypeScript at all: the rule lives
    // in shipping_amount_for(), and both display and charge read it.
    expect(action).toContain('supabase.rpc("shipping_quote"');
    expect(code("src/lib/commerce/shipping.ts")).not.toMatch(/5\.49|6\.49|75/);
    expect(action).not.toMatch(/5\.49|6\.49|\b75\b/);
  });

  it("sends nothing about money", () => {
    expect(action).toContain("...draftPayload(draft)");
    expect(action).not.toMatch(/p_price|p_total|p_amount|p_discount/);
  });

  it("never sets the reservation's expiry", () => {
    // Word boundaries: "THROTTLED" contains "ttl".
    expect(action).not.toMatch(/expires_at|reservation_ttl|\bttl\b|expiry/i);
  });

  it("tells being throttled apart from being broken", () => {
    // The article is fine and the basket is not lost — a different message.
    expect(action).toContain('reason: "too_many_checkouts"');
    expect(action).toContain('const THROTTLED = new Set(["53300", "too_many_connections"]);');
  });

  it("does not try to enforce the limit itself", () => {
    // It could not: this action reaches PostgREST with the public anon key and
    // the visitor's session, so a direct RPC call is the same database role.
    expect(action).not.toMatch(/max_open_checkouts|countActive|rateLimit|since\(/i);
  });

  it("tells a sold-out article apart from a broken server", () => {
    // One is about the goods and one is about us; the interface says
    // different things about each.
    expect(action).toContain('reason: "unavailable"');
    expect(action).toContain('reason: "failed"');
  });

  it("makes a double submit harmless", () => {
    // Since B2.2a the browser owns both identifiers and keeps them stable
    // across retries — the server minting a fresh id per call was the bug
    // that made a lost response create a second order.
    expect(action).toContain("p_request_id: credentials.requestId");
    expect(action).toContain("p_payment_token: credentials.paymentToken");
    expect(action).not.toContain("randomUUID()");
  });

  it("integrates no payment provider", () => {
    // It carries a payment capability, which is authorisation, not a payment.
    expect(action).not.toMatch(/stripe|mollie|paypal|checkout_session|webhook|payment_intent/i);
    expect(action).not.toMatch(/redirect|sk_live|sk_test/i);
  });

  it("does not require an account", () => {
    expect(action).not.toMatch(/if \(!user\)|requireUser|redirect\("\/login"\)/);
  });
});
