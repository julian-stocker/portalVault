import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { paymentMethodLabel } from "./payment-method.ts";

/**
 * Womit bezahlt wurde — und was passiert, wenn es niemand weiß (0101).
 *
 * Der zweite Teil ist der wichtigere. Für jede Bestellung vor `0101` gibt es
 * keinen Schnappschuss, `SI-2026-001009` eingeschlossen: dort bleibt die
 * Zahlungsart unbekannt, und unbekannt heißt hier, dass nichts dasteht. Eine
 * geratene Kartenmarke neben einem echten Betrag wäre die schlechtere Lücke.
 */
describe("die gewöhnliche Karte", () => {
  it("nennt Marke und die letzten vier Ziffern", () => {
    expect(paymentMethodLabel({ type: "card", brand: "visa", last4: "4242" }))
      .toBe("Visa •••• 4242");
  });

  it("schreibt die Marken so, wie sie geschrieben werden", () => {
    expect(paymentMethodLabel({ type: "card", brand: "mastercard", last4: "1234" }))
      .toBe("Mastercard •••• 1234");
    expect(paymentMethodLabel({ type: "card", brand: "amex", last4: "0005" }))
      .toBe("American Express •••• 0005");
  });
});

describe("Wallet und Karte stehen nebeneinander", () => {
  it("Apple Pay mit der Karte dahinter", () => {
    expect(paymentMethodLabel({ type: "card", brand: "visa", last4: "4242", wallet: "apple_pay" }))
      .toBe("Apple Pay · Visa •••• 4242");
  });

  it("Google Pay ebenso", () => {
    expect(paymentMethodLabel({ type: "card", brand: "mastercard", last4: "9999", wallet: "google_pay" }))
      .toBe("Google Pay · Mastercard •••• 9999");
  });

  it("ein unbekanntes Wallet wird lesbar gemacht, nicht verschwiegen", () => {
    expect(paymentMethodLabel({ type: "card", brand: "visa", last4: "4242", wallet: "cash_app_pay" }))
      .toBe("Cash app pay · Visa •••• 4242");
  });
});

describe("was fehlt, wird nicht erfunden", () => {
  it("ohne Schnappschuss steht nichts da", () => {
    for (const nothing of [null, undefined, {}, "card", 7, { type: "" }]) {
      expect(paymentMethodLabel(nothing), String(nothing)).toBeNull();
    }
  });

  it("Karte ohne Marke bleibt Karte", () => {
    expect(paymentMethodLabel({ type: "card", last4: "4242" })).toBe("Karte •••• 4242");
  });

  it("Karte ohne letzte Ziffern nennt keine", () => {
    expect(paymentMethodLabel({ type: "card", brand: "visa" })).toBe("Visa");
  });

  it("unsinnige letzte Ziffern werden weggelassen, nicht gezeigt", () => {
    for (const bad of ["12", "abcd", "42424", ""]) {
      expect(paymentMethodLabel({ type: "card", brand: "visa", last4: bad }), bad).toBe("Visa");
    }
  });

  it("eine Zahlart ohne Karte nennt sich selbst", () => {
    expect(paymentMethodLabel({ type: "paypal" })).toBe("Paypal");
    expect(paymentMethodLabel({ type: "klarna" })).toBe("Klarna");
  });

  it("und keine Kartenangaben, wo keine Karte ist", () => {
    // Stripe schickt sie dort nicht; käme doch etwas, bliebe es draußen.
    expect(paymentMethodLabel({ type: "paypal", brand: "visa", last4: "4242" })).toBe("Paypal");
  });
});

describe("der Schnappschuss selbst", () => {
  const SQL = readFileSync("supabase/migrations/0101_payment_method_snapshot.sql", "utf8");

  it("wird genau einmal geschrieben", () => {
    expect(SQL).toContain("and method_recorded_at is null");
    expect(SQL).toContain("return 'already_recorded'");
  });

  it("lässt Stripe wiederholen, wenn die Ladung vor der Sitzung kommt", () => {
    expect(SQL).toContain("return 'unknown_intent'");
    const index = readFileSync("supabase/functions/stripe-webhook/index.ts", "utf8");
    expect(index).toContain('if (recorded === "unknown_intent")');
    expect(index).toContain('return respond(500, { error: "not_yet" });');
  });

  it("speichert vier Ziffern und niemals mehr", () => {
    expect(SQL).toContain("card_last4 ~ '^[0-9]{4}$'");
    // Keine Spalte, in die eine ganze Kartennummer passen soll.
    /* Als Spaltennamen, nicht als Zeichenfolge irgendwo im Fließtext — „PAN"
       steht in der Begründung, und das soll es auch. */
    for (const forbidden of ["card_number", "cvc", "exp_month", "exp_year", "card_pan"]) {
      expect(SQL, forbidden).not.toContain(forbidden);
    }
  });

  it("hält keinen Stripe-Schlüssel in der Webhook-Function", () => {
    const index = readFileSync("supabase/functions/stripe-webhook/index.ts", "utf8");
    expect(index).toContain('new Stripe("sk_unused_webhook_only")');
    expect(index).not.toContain("sessions.retrieve");
    expect(index).not.toContain("expand");
  });

  it("und ändert an bestehenden Bestellungen nichts", () => {
    // Reine ALTER TABLE ADD COLUMN plus zwei Funktionen. Kein UPDATE auf
    // Bestand, keine Rückrechnung, kein Erfinden für alte Zahlungen.
    expect(SQL).not.toMatch(/update public\.orders/);
    expect(SQL).not.toMatch(/insert into public\./);
    expect(SQL).toContain("add column if not exists provider_intent_id");
  });
});
