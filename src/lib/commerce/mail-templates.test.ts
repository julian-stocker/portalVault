import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  addressLines,
  conditionLabel,
  escapeHtml,
  goesToCustomer,
  idempotencyKey,
  isMailKind,
  money,
  paymentConfirmation,
  render,
  resolutionAlert,
  shippingConfirmation,
  type MailOrder,
} from "../../../supabase/functions/send-order-mail/templates.ts";

/**
 * The three mails, rendered.
 *
 * `order_mail_payload()` already withholds every identifier, and its contract
 * is checked in `mail-schema.test.ts`. This is the second look, at the last
 * place anything could appear: the string a customer actually receives. A
 * projection can be widened by accident; a rendered body is where that shows.
 */

const ORDER: MailOrder = {
  order_number: "SI-2026-001234",
  placed_at: "2026-09-11T10:00:00Z",
  customer_email: "kundin@example.com",
  currency: "EUR",
  items_subtotal: "24.48",
  shipping_amount: "5.49",
  discount_amount: "0.00",
  total_amount: "29.97",
  shipping_method: "Hermes S",
  tracking_number: "H1234567890",
  shipped_at: "2026-09-12T09:00:00Z",
  payment_status: "paid",
  needs_resolution: false,
  address: {
    first_name: "Ada",
    last_name: "Lovelace",
    company: "Analytical Engines & Co",
    street: "Hauptstraße",
    house_number: "7a",
    address_line_2: "Hinterhaus",
    postal_code: "10115",
    city: "Berlin",
    country_code: "DE",
  },
  lines: [
    { condition: "loose", name: "Spyro", quantity: 2, unit_price: "4.49", line_total: "8.98" },
    { condition: "boxed", name: "Bash", quantity: 1, unit_price: "15.50", line_total: "15.50" },
  ],
};

const ALL = [
  paymentConfirmation(ORDER),
  shippingConfirmation(ORDER),
  resolutionAlert(ORDER),
];

describe("nothing a mail may not carry appears in any of them", () => {
  /**
   * The list that matters. A capability in a mail would be a bearer token in
   * an inbox — forwardable, searchable and never expiring on its own
   * (ADR-0056).
   */
  const FORBIDDEN = [
    "cs_test_",
    "cs_live_",
    "session_id",
    "sessionId",
    "payment_token",
    "paymentToken",
    "capability",
    "client_hash",
    "request_id",
    "SKY-",
  ];

  it.each(ALL.map((mail, i) => [["payment", "shipping", "alert"][i], mail] as const))(
    "%s carries no token, session or internal id",
    (_name, mail) => {
      for (const forbidden of FORBIDDEN) {
        expect(mail.html, forbidden).not.toContain(forbidden);
        expect(mail.text, forbidden).not.toContain(forbidden);
        expect(mail.subject, forbidden).not.toContain(forbidden);
      }
    },
  );

  /** Open and click tracking are off at the provider; nothing here adds any. */
  it.each(ALL.map((mail, i) => [["payment", "shipping", "alert"][i], mail] as const))(
    "%s embeds no tracking pixel and no remote image",
    (_name, mail) => {
      expect(mail.html).not.toContain("<img");
      expect(mail.html).not.toContain("http://");
      // No link at all today: there is no page a guest could open that would
      // show them anything without the capability they do not have.
      expect(mail.html).not.toContain("<a ");
    },
  );
});

describe("the payment confirmation says what was bought", () => {
  const mail = paymentConfirmation(ORDER);

  it("names the order", () => {
    expect(mail.subject).toContain("SI-2026-001234");
    expect(mail.html).toContain("SI-2026-001234");
  });

  it("lists every line with its condition, quantity and price", () => {
    for (const line of ORDER.lines) {
      expect(mail.html).toContain(line.name);
      expect(mail.text).toContain(line.name);
    }
    expect(mail.html).toContain("Lose");
    expect(mail.html).toContain("OVP");
    expect(mail.html).toContain("2 ×");
  });

  it("shows subtotal, shipping and total", () => {
    expect(mail.html).toContain("Zwischensumme");
    expect(mail.html).toContain("Versand");
    expect(mail.html).toContain("Gesamtbetrag");
    expect(mail.html).toContain(money("29.97"));
    expect(mail.text).toContain(money("29.97"));
  });

  it("names the shipping method and the delivery address", () => {
    expect(mail.html).toContain("Hermes S");
    expect(mail.html).toContain("Ada Lovelace");
    expect(mail.html).toContain("10115 Berlin");
    expect(mail.html).toContain("Deutschland");
  });

  it("says it is not an invoice", () => {
    expect(mail.html).toContain("Diese Bestellbestätigung ist keine Rechnung.");
    expect(mail.text).toContain("Diese Bestellbestätigung ist keine Rechnung.");
  });
});

describe("the invoice note belongs to the order confirmation alone", () => {
  /**
   * Found in the first real staging send: the shipping mail carried "Diese
   * Bestellbestätigung ist keine Rechnung." A shipping confirmation is not a
   * Bestellbestätigung, so the sentence described a document the reader was
   * not holding.
   */
  const NOTE = "Diese Bestellbestätigung ist keine Rechnung.";

  it("is in the payment confirmation", () => {
    const mail = paymentConfirmation(ORDER);
    expect(mail.html).toContain(NOTE);
    expect(mail.text).toContain(NOTE);
  });

  it("is in neither of the other two", () => {
    for (const mail of [shippingConfirmation(ORDER), resolutionAlert(ORDER)]) {
      expect(mail.html).not.toContain(NOTE);
      expect(mail.text).not.toContain(NOTE);
      // Not merely the exact sentence — nothing that calls itself one.
      expect(mail.html).not.toContain("Bestellbestätigung");
      expect(mail.text).not.toContain("Bestellbestätigung");
    }
  });

  it("no mail ever calls itself a Rechnung", () => {
    for (const mail of ALL) {
      expect(mail.subject).not.toContain("Rechnung");
      expect(mail.html.replace(NOTE, "")).not.toContain("Rechnung");
      expect(mail.text.replace(NOTE, "")).not.toContain("Rechnung");
    }
  });
});

describe("the shipping confirmation", () => {
  const mail = shippingConfirmation(ORDER);

  it("shows the tracking number as text and never as a link", () => {
    expect(mail.html).toContain("H1234567890");
    // Carriers disagree about URL shape and 0018 stores the number raw with no
    // carrier detection, so any link this code built would be a guess.
    expect(mail.html).not.toContain("href");
  });

  it("works without a tracking number", () => {
    const without = shippingConfirmation({ ...ORDER, tracking_number: null });
    expect(without.html).not.toContain("Sendungsnummer");
    expect(without.html).toContain("SI-2026-001234");
  });
});

describe("the operator alert", () => {
  const mail = resolutionAlert(ORDER);

  it("says what happened and what to decide", () => {
    expect(mail.subject).toContain("SI-2026-001234");
    expect(mail.html).toContain("keine Reservierung");
    expect(mail.html).toContain("nachbestellen oder erstatten");
  });

  /** It goes to the operator; a customer's address has no business in it. */
  it("carries no customer name, address or e-mail", () => {
    for (const personal of ["Ada", "Lovelace", "Hauptstraße", "kundin@example.com", "Berlin"]) {
      expect(mail.html, personal).not.toContain(personal);
      expect(mail.text, personal).not.toContain(personal);
    }
  });
});

describe("customer input never becomes markup", () => {
  it("escapes what a customer typed", () => {
    const hostile = {
      ...ORDER,
      address: { ...ORDER.address!, company: `<script>alert(1)</script> & "Co"` },
      lines: [{ ...ORDER.lines[0], name: "<b>Spyro</b>" }],
    };
    const mail = paymentConfirmation(hostile);
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<b>Spyro</b>");
    expect(mail.html).toContain("&lt;script&gt;");
  });

  it("escapes each character exactly once", () => {
    expect(escapeHtml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&#39;");
  });
});

describe("the small pieces", () => {
  it("formats money from the string PostgREST sends", () => {
    expect(money("4.49")).toContain("4,49");
    expect(money(0)).toContain("0,00");
    expect(money(null)).toBe("–");
    expect(money("nonsense")).toBe("–");
  });

  it("names the two conditions as a customer knows them", () => {
    expect(conditionLabel("loose")).toBe("Lose");
    expect(conditionLabel("boxed")).toBe("OVP");
  });

  it("drops empty address lines rather than printing blanks", () => {
    const lines = addressLines({
      ...ORDER.address!,
      company: null,
      address_line_2: null,
    });
    expect(lines).toEqual(["Ada Lovelace", "Hauptstraße 7a", "10115 Berlin", "Deutschland"]);
  });

  it("has no address at all when the order has none", () => {
    expect(addressLines(null)).toEqual([]);
    const mail = paymentConfirmation({ ...ORDER, address: null });
    expect(mail.html).not.toContain("Lieferadresse");
  });

  it("calls free shipping free", () => {
    const free = paymentConfirmation({ ...ORDER, shipping_amount: "0.00" });
    expect(free.html).toContain("Kostenlos");
  });
});

describe("the idempotency key", () => {
  /**
   * Stable per logical mail, never per attempt: Resend deduplicates on it for
   * 24 hours, which is the second guard behind the delivery row. A random key
   * would make that guard do nothing at all.
   */
  it("is the same on every call for the same mail", () => {
    expect(idempotencyKey("payment_confirmation", "SI-2026-001234")).toBe(
      idempotencyKey("payment_confirmation", "SI-2026-001234"),
    );
  });

  it("differs per kind and per order", () => {
    const keys = new Set([
      idempotencyKey("payment_confirmation", "SI-1"),
      idempotencyKey("shipping_confirmation", "SI-1"),
      idempotencyKey("resolution_alert", "SI-1"),
      idempotencyKey("payment_confirmation", "SI-2"),
    ]);
    expect(keys.size).toBe(4);
  });

  it("follows the documented shape and stays well under 256 characters", () => {
    const key = idempotencyKey("payment_confirmation", "SI-2026-001234");
    expect(key).toBe("skyisles/payment-confirmation/SI-2026-001234");
    expect(key.length).toBeLessThanOrEqual(256);
  });

  it("names the order by its number, never by an internal id", () => {
    expect(idempotencyKey("payment_confirmation", "SI-2026-001234")).not.toMatch(/\/\d+$/);
  });
});

describe("dispatch", () => {
  it("knows exactly three kinds", () => {
    expect(isMailKind("payment_confirmation")).toBe(true);
    expect(isMailKind("shipping_confirmation")).toBe(true);
    expect(isMailKind("resolution_alert")).toBe(true);
    expect(isMailKind("invoice")).toBe(false);
    expect(isMailKind(null)).toBe(false);
  });

  it("routes each kind to its own body", () => {
    expect(render("payment_confirmation", ORDER).subject).toContain("Zahlung bestätigt");
    expect(render("shipping_confirmation", ORDER).subject).toContain("unterwegs");
    expect(render("resolution_alert", ORDER).subject).toContain("geprüft werden");
  });

  it("sends only the alert to the operator", () => {
    expect(goesToCustomer("payment_confirmation")).toBe(true);
    expect(goesToCustomer("shipping_confirmation")).toBe(true);
    expect(goesToCustomer("resolution_alert")).toBe(false);
  });
});

describe("the templates are pure", () => {
  const SOURCE = readFileSync("supabase/functions/send-order-mail/templates.ts", "utf8");

  /** They are imported by a Deno function and by this test. Neither may break. */
  it("import nothing at all", () => {
    expect(SOURCE).not.toMatch(/^import /m);
    expect(SOURCE).not.toContain("Deno.");
    expect(SOURCE).not.toContain("fetch(");
  });

  it("hold no address, no key and no provider name", () => {
    expect(SOURCE).not.toMatch(/@(gmail|googlemail|outlook|gmx|web)\./i);
    expect(SOURCE).not.toContain("re_");
    expect(SOURCE).not.toContain("RESEND_API_KEY");
  });
});
