/**
 * Die Geldaufstellung einer Bestellung (0096).
 *
 * Der Anlass: der Bestellschirm zeigte „Bestellwert" und „Erstattet" und
 * beantwortete damit weder, was der Kunde überwiesen hat, noch, was davon
 * übrig bleibt. Zwei Fragen, zwei Blöcke — und eine Regel, die in jedem
 * einzelnen Test steht: ein Storno ist keine Erstattung.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { LABEL_KIND, orderMoney } from "./order-money";

const PAGE = readFileSync(
  "src/app/(business)/business/orders/[orderNumber]/page.tsx", "utf8");
const MIGRATION = readFileSync(
  "supabase/migrations/0096_order_line_status_and_costs.sql", "utf8");

/**
 * Jede Erstattung dieses Tests ist eine BESTÄTIGTE, sofern sie nichts anderes
 * sagt (0111).
 *
 * Die Rechentests prüfen Summieren, Runden und das Lesen der Zahlenstrings von
 * PostgREST — keiner davon handelt vom Geldfluss. Ohne diese Vorgabe würden
 * sie alle zu Tests über den Provider-Zustand, und die eigentliche Arithmetik
 * stünde nirgends mehr. Der Zustand selbst hat weiter unten seinen eigenen
 * Abschnitt.
 */
const money = (over: Partial<Parameters<typeof orderMoney>[0]> = {}) => orderMoney({
  itemsSubtotal: 8.5, shippingAmount: 5.49, discountAmount: 0,
  costs: [],
  ...over,
  refunds: (over.refunds ?? []).map((one) => ({ provider_status: "succeeded", ...one })),
});

describe("what the buyer paid", () => {
  it("is subtotal plus shipping minus discount", () => {
    expect(money().buyerPaid).toBe(13.99);
    expect(money({ discountAmount: 1.5 }).buyerPaid).toBe(12.49);
  });

  it("leaves the remaining amount alone until money is repaid", () => {
    // SI-2026-001067 nach A1: eine Position storniert, nichts erstattet.
    // Das Geld des Kunden liegt weiterhin vollständig hier.
    expect(money().remaining).toBe(13.99);
  });

  it("adds up several refunds", () => {
    const m = money({ refunds: [{ amount: 4.04 }, { amount: "1.79" }, { amount: 0.89 }] });
    expect(m.refunded).toBe(6.72);
    expect(m.remaining).toBe(7.27);
  });

  it("adds up a partial refund to the cent", () => {
    // Drittelung von 2.67: die klassische Stelle, an der Fließkomma driftet.
    const m = money({ refunds: [{ amount: 0.89 }, { amount: 0.89 }, { amount: 0.89 }] });
    expect(m.refunded).toBe(2.67);
    expect(m.remaining).toBe(11.32);
  });

  it("ignores a refund that is not a number", () => {
    expect(money({ refunds: [{ amount: null }, { amount: "x" }, { amount: 1 }] }).refunded)
      .toBe(1);
  });
});

describe("what the sale earned", () => {
  it("is the remaining amount minus the recorded costs", () => {
    const m = money({
      refunds: [{ amount: 4.04 }],
      costs: [{ kind: "marketplace", amount: 0.63 }, { kind: LABEL_KIND, amount: 5.49 }],
    });
    expect(m.remaining).toBe(9.95);
    expect(m.fees).toBe(0.63);
    expect(m.shippingLabel).toBe(5.49);
    expect(m.costs).toBe(6.12);
    expect(m.proceeds).toBe(3.83);
  });

  it("does not subtract the discount a second time", () => {
    // Der Rabatt steckt bereits im bezahlten Betrag.
    const m = money({ discountAmount: 2, costs: [{ kind: "payment", amount: 0.5 }] });
    expect(m.buyerPaid).toBe(11.99);
    expect(m.proceeds).toBe(11.49);
  });

  it("counts payment, marketplace and other as fees and only the label as the label", () => {
    const m = money({ costs: [
      { kind: "payment", amount: 0.5 },
      { kind: "marketplace", amount: 0.25 },
      { kind: "other", amount: 0.1 },
      { kind: LABEL_KIND, amount: 5.49 },
    ] });
    expect(m.fees).toBe(0.85);
    expect(m.shippingLabel).toBe(5.49);
  });

  it("reads sensibly with no refund, no fee and no label", () => {
    const m = money();
    expect(m.refunded).toBe(0);
    expect(m.costs).toBe(0);
    expect(m.proceeds).toBe(13.99);
    expect(m.proceeds).toBe(m.remaining);
  });

  it("does not hide costs that exceed what is left", () => {
    // Eine Erstattung fast in Höhe des Bestellwerts, das Etikett bleibt
    // bezahlt: das Ergebnis ist negativ, und das ist die Wahrheit.
    const m = money({ refunds: [{ amount: 13.0 }], costs: [{ kind: LABEL_KIND, amount: 5.49 }] });
    expect(m.proceeds).toBeCloseTo(-4.5, 10);
  });
});

describe("money is counted in whole cents", () => {
  it("does not drift over many small amounts", () => {
    const refunds = Array.from({ length: 100 },
      () => ({ amount: 0.07, provider_status: "succeeded" }));
    expect(orderMoney({
      itemsSubtotal: 7, shippingAmount: 0, discountAmount: 0, refunds, costs: [],
    }).remaining).toBe(0);
  });

  it("rounds half away from zero, like round(numeric, 2)", () => {
    expect(money({ refunds: [{ amount: 0.005 }] }).refunded).toBe(0.01);
  });

  it("accepts the strings PostgREST returns for numeric", () => {
    const m = orderMoney({
      itemsSubtotal: "8.50", shippingAmount: "5.49", discountAmount: "0.00",
      refunds: [{ amount: "4.04", provider_status: "succeeded" }],
      costs: [{ kind: LABEL_KIND, amount: "5.49" }],
    });
    expect(m.buyerPaid).toBe(13.99);
    expect(m.remaining).toBe(9.95);
    expect(m.proceeds).toBe(4.46);
  });
});

describe("the two blocks on the order screen", () => {
  it("shows what was paid and what was earned, separately", () => {
    expect(PAGE).toContain("copy.finance.paidTitle");
    expect(PAGE).toContain("copy.finance.proceedsTitle");
    expect(PAGE).toContain("orderMoney({");
  });

  it("hides the rows that would only ever read zero", () => {
    expect(PAGE).toContain("{money.discountAmount > 0 ?");
    expect(PAGE).toContain("{money.refunded > 0 ?");
  });

  it("no longer prints the old two-number summary", () => {
    expect(PAGE).not.toContain("{copy.money.total}");
  });

  it("keeps the refund a separate act", () => {
    // Der Vorschlag aus den Stornos steht weiterhin als Aufgabe da und wird
    // nirgends als erstattet verbucht.
    expect(PAGE).toContain("{refundOpen > 0 ?");
    expect(PAGE).toContain("<RefundForm");
  });

  it("invents no cost the database has not recorded", () => {
    const fn = MIGRATION.slice(
      MIGRATION.indexOf("create or replace function public.order_sale_costs("),
      MIGRATION.indexOf("comment on function public.order_sale_costs"));
    expect(fn).toContain("from public.sales s");
    expect(fn).toContain("join public.sale_fees f on f.sale_id = s.id");
    expect(fn).not.toMatch(/0\.\d+\s*\*/);
  });

  it("keeps the cost reader away from every client role", () => {
    expect(MIGRATION).toContain(
      "revoke all on function public.order_sale_costs(bigint) from public, anon, authenticated;");
  });
});


/* ===================================================================== */
describe("gebucht ist nicht erstattet (0111)", () => {
  /*
   * DIE LÜCKE, DIE SI-2026-001009 GEKOSTET HAT, ALS RECHNUNG.
   *
   * Eine Erstattung, die nie beim Zahlungsdienst ausgelöst wurde, hat den
   * Erlös nicht gemindert. Sie hier mitzurechnen hätte die Einnahme um einen
   * Betrag kleiner gemacht, der nie ein Konto verlassen hat — und genau das
   * stand zwei Wochen im Bestellschirm.
   */
  const raw = (refunds: readonly { amount: unknown; provider_status?: string | null }[]) =>
    orderMoney({ itemsSubtotal: 8.5, shippingAmount: 5.49, discountAmount: 0,
                 refunds, costs: [] });

  it("zählt nur, was der Zahlungsdienst bestätigt hat", () => {
    expect(raw([{ amount: 4.04, provider_status: "succeeded" }]).refunded).toBe(4.04);
    expect(raw([{ amount: 4.04, provider_status: "none" }]).refunded).toBe(0);
    expect(raw([{ amount: 4.04, provider_status: "pending" }]).refunded).toBe(0);
    expect(raw([{ amount: 4.04, provider_status: "failed" }]).refunded).toBe(0);
  });

  it("und der verbleibende Betrag bleibt dann unverändert", () => {
    // Genau SI-2026-001009: gebucht, nicht erstattet, Geld vollständig da.
    expect(raw([{ amount: 0.76, provider_status: "none" }]).remaining).toBe(13.99);
    expect(raw([{ amount: 0.76, provider_status: "succeeded" }]).remaining).toBe(13.23);
  });

  it("ein fehlender Zustand gilt als NICHT erstattet", () => {
    /*
     * Die vorsichtige Richtung. Wo die Antwort unbekannt ist, darf die
     * Aufstellung keine Erstattung behaupten — die umgekehrte Vorgabe war der
     * Fehler, nicht ein Versehen in der Rechnung.
     */
    expect(raw([{ amount: 4.04 }]).refunded).toBe(0);
    expect(raw([{ amount: 4.04, provider_status: null }]).refunded).toBe(0);
  });

  it("mehrere Zeilen werden einzeln beurteilt", () => {
    expect(raw([
      { amount: 4.04, provider_status: "succeeded" },
      { amount: 1.79, provider_status: "none" },
      { amount: 0.89, provider_status: "succeeded" },
    ]).refunded).toBe(4.93);
  });
});
