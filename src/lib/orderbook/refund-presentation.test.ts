/**
 * Wie Rückerstattungen im Business-Bereich aussehen (0097).
 *
 * DREI REGELN, UND ALLE DREI SIND REINE DARSTELLUNG:
 *
 *   1. Auf Deutsch heißt es „Rückerstattung", nicht „Refund". Die
 *      Arbeitsmappe darf ihre Spalte AD englisch abkürzen, der Bildschirm
 *      nicht.
 *   2. Ein Betrag, der abgeht, wird mit Minus geschrieben. „5,83 €" unter
 *      „Rückerstattung" liest sich sonst wie eine Einnahme.
 *   3. Rot ist der BETRAG, nie die Zeile. Die Beschriftung ist eine Tatsache,
 *      kein Alarm.
 *
 * WAS SICH NICHT ÄNDERT: die Datenbank. `order_refunds.amount` hat einen
 * CHECK auf `> 0`, jede Summe rechnet weiter mit positiven Zahlen, und keine
 * dieser Dateien fasst Logik an.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { formatDeduction, formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

const LEDGER = readFileSync("src/components/business/sales-ledger.tsx", "utf8");
const DETAILS = readFileSync("src/components/business/sale-details.tsx", "utf8");
const ORDER_PAGE = readFileSync(
  "src/app/(business)/business/orders/[orderNumber]/page.tsx", "utf8");
const WITHDRAWALS = readFileSync("src/app/(business)/business/widerrufe/page.tsx", "utf8");
const SCREENS = { LEDGER, DETAILS, ORDER_PAGE, WITHDRAWALS };

describe("the word", () => {
  it("is Rückerstattung everywhere the operator can read it", () => {
    expect(de.business.sales.columns.refund).toBe("Rückerstattung");
    expect(de.business.sales.detailsModal.refunds).toBe("Rückerstattungen");
    expect(de.business.sales.refunds).toBe("Rückerstattungen");
    expect(de.business.sales.addRefund).toBe("+ Rückerstattung");
    expect(de.admin.orders.finance.refunded).toBe("Rückerstattung");
  });

  it("is nowhere still Refund in the visible copy", () => {
    const visible = (value: unknown): string[] =>
      typeof value === "string" ? [value]
      : typeof value === "function" ? []
      : value !== null && typeof value === "object"
        ? Object.values(value).flatMap(visible)
        : [];
    for (const text of visible([de.business, de.admin])) {
      expect(text, text).not.toMatch(/\bRefunds?\b/);
    }
  });

  /* Intern bleibt alles, wie es heißt: Spalten, Typen, Funktionen. */
  it("renames nothing behind the screen", () => {
    expect(LEDGER).toContain("sale.refunded");
    expect(DETAILS).toContain("order_refunds" in {} ? "" : "refundsTotal(");
    expect(ORDER_PAGE).toContain("openLineRefunds(");
  });
});

describe("the sign", () => {
  it("writes a deduction with a minus", () => {
    expect(formatDeduction(5.83)).toBe(`−${formatPrice(5.83)}`);
    expect(formatDeduction(1.79)).toContain("−");
  });

  it("does not put a minus on nothing", () => {
    // „−0,00 €" behauptet eine Bewegung, die es nicht gab.
    expect(formatDeduction(0)).toBe(formatPrice(0));
    expect(formatDeduction(0)).not.toContain("−");
  });

  it("does not turn an already negative amount twice", () => {
    expect(formatDeduction(-2)).toBe(`−${formatPrice(2)}`);
  });

  it("keeps the dash for an unknown amount", () => {
    expect(formatDeduction(null)).toBe(formatPrice(null));
    expect(formatDeduction(Number.NaN)).toBe(formatPrice(Number.NaN));
  });

  it("uses the typographic minus, not a hyphen", () => {
    expect(formatDeduction(1).startsWith("−")).toBe(true);
    expect(formatDeduction(1).startsWith("-")).toBe(false);
  });

  it("is applied on every screen that shows a refund amount", () => {
    expect(LEDGER).toContain("formatDeduction(sale.refunded)");
    expect(DETAILS).toContain("formatDeduction(sale.refunded)");
    expect(DETAILS).toContain("formatDeduction(Number(refund.amount))");
    expect(DETAILS).toContain("formatDeduction(refundsTotal(refunds))");
    expect(ORDER_PAGE).toContain("formatDeduction(money.refunded)");
    expect(WITHDRAWALS).toContain("formatDeduction(refunded)");
  });

  it("does not hand-write the minus any more", () => {
    // Vorher stand „−{formatPrice(…)}" im JSX: zwei Schreibweisen für
    // dasselbe, und eine davon setzte auch bei 0 ein Minus.
    for (const [name, source] of Object.entries(SCREENS)) {
      expect(source, name).not.toContain("−{formatPrice(");
    }
  });
});

describe("the colour", () => {
  it("uses the token that already exists", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    expect(css).toContain("--color-danger: var(--danger)");
    for (const source of [LEDGER, DETAILS, ORDER_PAGE, WITHDRAWALS]) {
      expect(source).toContain("text-danger");
    }
  });

  it("invents no second red", () => {
    for (const [name, source] of Object.entries(SCREENS)) {
      expect(source, name).not.toMatch(/text-red-\d/);
      expect(source, name).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    }
  });

  it("colours the amount, not the row", () => {
    // Die Beschriftung bleibt `text-muted`, nur das `dd`/`span` wird rot.
    expect(ORDER_PAGE).toContain(
      '<dt className="text-muted">{copy.finance.refunded}</dt>');
    expect(ORDER_PAGE).toContain(
      '<dd className="tabular-nums text-danger">{formatDeduction(money.refunded)}</dd>');
    expect(DETAILS).toContain('negative ? " text-danger" : ""');
    expect(WITHDRAWALS).toContain(
      '<span className="tabular-nums text-danger">{formatDeduction(refunded)}</span>');
  });

  it("stays neutral where nothing was repaid", () => {
    // Die Spalte im Verkaufsbuch ist nur rot, wenn dort auch etwas steht.
    expect(LEDGER).toContain('sale.refunded > 0 ? "text-danger" : "text-muted"');
  });
});

describe("nothing but presentation changed", () => {
  it("negates no sum and no stored value", () => {
    const format = readFileSync("src/lib/format.ts", "utf8");
    const fn = format.slice(format.indexOf("export function formatDeduction"));
    expect(fn.slice(0, fn.indexOf("\n}"))).toContain("Math.abs(value)");
    // Die Geldrechnung selbst kennt kein Vorzeichen für Erstattungen.
    const money = readFileSync("src/lib/commerce/order-money.ts", "utf8");
    expect(money).toContain("refunded += Math.max(0, cents(one.amount))");
    expect(money).toContain("remaining = paid - refunded");
  });

  it("touches no refund, allocation, stock or fulfilment logic", () => {
    for (const [name, source] of Object.entries(SCREENS)) {
      expect(source, name).not.toContain("seller_record_refund");
      expect(source, name).not.toContain("apply_inventory_movement");
    }
  });
});
