/**
 * DER FEHLER, DEN DIESE TESTS FESTHALTEN.
 *
 * SI-2026-001067: Position „Drill Sergeant" über 0095 storniert. Der
 * Bestellschirm sagte „1 storniert", das Orderbuch im selben Moment
 * „Verschickt ✓". Der Grund war keine falsche Ableitung, sondern gar keine:
 * der Ledger druckte für jede Zeile einer internen Bestellung die Konstante
 * `outbooked`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { commerceLineIndicator, commerceLineStatus } from "./commerce-line-status";
import { saleItemStatus } from "./sales-view";
import { de } from "@/lib/i18n/de";

const LEDGER = readFileSync("src/components/business/sales-ledger.tsx", "utf8");
const SALE_RPC = readFileSync(
  "supabase/migrations/0096_order_line_status_and_costs.sql", "utf8");
const copy = de.business.sales;

describe("what became of one position of a shop order", () => {
  /**
   * DIE ZWEITE HÄLFTE DESSELBEN FEHLERS. SI-2026-001067 war `unfulfilled`,
   * und das Orderbuch zeigte für Eruptor und Ninja Stealth Elf „Verschickt
   * ✓" — weil Commerce beim Bezahlen ausbucht. Ausbuchen ist kein Versand.
   */
  it("does not call a paid position shipped", () => {
    const state = commerceLineStatus({ quantity: 3 }, "unfulfilled");
    expect(state.kind).toBe("open");
    expect(state.parts).toEqual([{ kind: "open", quantity: 3 }]);
    expect(state.closed).toBe(false);
  });

  it("calls it shipped once the parcel has gone", () => {
    for (const status of ["shipped", "completed"]) {
      expect(commerceLineStatus({ quantity: 3 }, status).kind, status).toBe("shipped");
    }
    for (const status of ["unfulfilled", "preparing", "cancelled", "", null, undefined]) {
      expect(commerceLineStatus({ quantity: 3 }, status).kind, String(status)).toBe("open");
    }
  });

  it("treats a missing projection as nothing happened", () => {
    // Eine Umgebung ohne 0096 liefert die Mengen nicht mit. Sie darf deshalb
    // nicht plötzlich alles als storniert anzeigen.
    for (const line of [
      { quantity: 1 },
      { quantity: 1, cancelled: null, returned: null },
      { quantity: 1, cancelled: undefined, returned: undefined },
    ]) {
      expect(commerceLineStatus(line, "shipped").kind).toBe("shipped");
    }
  });

  it("is terminal when the whole position was cancelled", () => {
    const state = commerceLineStatus({ quantity: 1, cancelled: 1 }, "unfulfilled");
    expect(state.kind).toBe("cancelled");
    expect(state.closed).toBe(true);
    expect(state.parts).toEqual([{ kind: "cancelled", quantity: 1 }]);
  });

  /* GENAU DER GEMELDETE FALL. */
  it("does not call a partly cancelled position cancelled", () => {
    const open = commerceLineStatus({ quantity: 3, cancelled: 1 }, "unfulfilled");
    expect(open.kind).toBe("mixed");
    expect(open.parts).toEqual([
      { kind: "cancelled", quantity: 1 },
      { kind: "open", quantity: 2 },
    ]);
    // Zwei Stück gehen noch raus: nicht abgeschlossen.
    expect(open.closed).toBe(false);

    // Dieselbe Position, nachdem das Paket raus ist.
    const sent = commerceLineStatus({ quantity: 3, cancelled: 1 }, "shipped");
    expect(sent.parts).toEqual([
      { kind: "cancelled", quantity: 1 },
      { kind: "shipped", quantity: 2 },
    ]);
  });

  it("shows three outcomes side by side when there are three", () => {
    const state = commerceLineStatus({ quantity: 3, cancelled: 1, returned: 1 }, "shipped");
    expect(state.kind).toBe("mixed");
    expect(state.parts.map((p) => `${p.quantity} ${p.kind}`))
      .toEqual(["1 cancelled", "1 returned", "1 shipped"]);
  });

  it("is terminal when everything came back", () => {
    expect(commerceLineStatus({ quantity: 2, returned: 2 }, "shipped").kind).toBe("returned");
    expect(commerceLineStatus({ quantity: 2, returned: 2 }, "shipped").closed).toBe(true);
  });

  it("never lets the parts add up to more than was ordered", () => {
    // Eine Projektion, die mehr meldet als bestellt wurde, ist ein Fehler —
    // aber kein Grund, eine unmögliche Zeile zu zeichnen.
    for (const line of [
      { quantity: 2, cancelled: 5, returned: 5 },
      { quantity: 2, cancelled: -1, returned: 3 },
      { quantity: 2, cancelled: 1.6, returned: 0 },
    ]) {
      const state = commerceLineStatus(line, "shipped");
      const total = state.parts.reduce((sum, part) => sum + part.quantity, 0);
      expect(total, JSON.stringify(line)).toBe(2);
      expect(state.parts.every((p) => p.quantity > 0)).toBe(true);
    }
  });

  /**
   * TERMINALITÄT IST EINE EIGENSCHAFT DER DATEN, NICHT DIESES BILDSCHIRMS.
   * `cancelled` wird aus einem append-only-Ledger summiert und kann nicht
   * sinken; es gibt deshalb keinen Versandzustand, der es überschreibt. Diese
   * Funktion bekommt den Versand gar nicht erst als Parameter.
   */
  /**
   * DER FULFILLMENT-STATUS ENTSCHEIDET NUR ÜBER DEN REST.
   *
   * Die stornierte und die zurückgenommene Menge kommen aus einem
   * append-only-Ledger; kein Versand nimmt sie zurück. Versenden macht aus
   * „offen" ein „verschickt" und sonst nichts.
   */
  it("cannot be overwritten by a later shipment", () => {
    for (const status of ["unfulfilled", "preparing", "shipped", "completed", "cancelled"]) {
      const whole = commerceLineStatus({ quantity: 1, cancelled: 1 }, status);
      expect(whole.kind, status).toBe("cancelled");

      const part = commerceLineStatus({ quantity: 3, cancelled: 1, returned: 1 }, status);
      expect(part.parts.find((p) => p.kind === "cancelled")?.quantity, status).toBe(1);
      expect(part.parts.find((p) => p.kind === "returned")?.quantity, status).toBe(1);
    }
  });
});

describe("the dot beside the row", () => {
  it("gives a cancelled position the grey arrow it has everywhere else", () => {
    // Derselbe Indikator wie bei einer stornierten Werkbuch-Position.
    expect(commerceLineIndicator(commerceLineStatus({ quantity: 1, cancelled: 1 })))
      .toEqual({ tone: "grey", glyph: "↩" });
  });

  it("keeps the tick only where the whole position really went out", () => {
    expect(commerceLineIndicator(commerceLineStatus({ quantity: 2 })))
      .toEqual({ tone: "green", glyph: "✓" });
    expect(commerceLineIndicator(commerceLineStatus({ quantity: 2, cancelled: 1 })).glyph)
      .not.toBe("✓");
  });
});

describe("the ledger acts on it", () => {
  it("no longer prints one constant for every line", () => {
    expect(LEDGER).toContain("commerceLineStatus({");
    expect(LEDGER).not.toContain('saleItemIndicator("outbooked", true)');
  });

  it("names the cancelled part with its quantity", () => {
    const join = (...parts: string[]) => parts.join(copy.commerceLine.separator);
    expect(join(copy.commerceLine.cancelledPart(1), copy.commerceLine.openPart(2)))
      .toBe("1 storniert · 2 offen");
    expect(join(copy.commerceLine.cancelledPart(1), copy.commerceLine.shippedPart(2)))
      .toBe("1 storniert · 2 verschickt");
    expect(join(copy.commerceLine.returnedPart(1), copy.commerceLine.shippedPart(2)))
      .toBe("1 retour · 2 verschickt");
  });

  /* Die Wörter, die der Ledger für eine ganze Position nimmt. */
  it("uses the vocabulary the ledger already has", () => {
    expect(copy.itemStates.open).toBe("Offen");
    expect(copy.itemStates.outbooked).toBe("Verschickt ✓");
    expect(copy.commerceLine.cancelled).toBe("Storniert");
    expect(LEDGER).toContain("copy.itemStates.open");
  });

  it("asks the order for its fulfillment state", () => {
    expect(LEDGER).toContain('String(order.fulfillment_status ?? "")');
  });

  /* Storno und Erstattung sind getrennte Vorgänge — auch im Wortlaut. */
  it("never calls a cancellation a refund", () => {
    for (const value of Object.values(copy.commerceLine)) {
      const text = typeof value === "function" ? value(1) : value;
      expect(String(text).toLowerCase()).not.toContain("erstatt");
    }
  });

  it("leaves the legacy ladder alone", () => {
    // `saleItemStatus` beantwortet weiterhin die Zeilen aus `sale_items`.
    expect(saleItemStatus(
      { movement_id: 7, returned_at: null, return_movement_id: null, sky_id: "SKY-0001" },
      true,
    )).toBe("outbooked");
    expect(LEDGER).toContain("saleItemActions(");
  });
});

describe("the projection the status is read from", () => {
  it("ships the quantities with an internal order's lines", () => {
    const fn = SALE_RPC.slice(
      SALE_RPC.indexOf("create or replace function public.seller_sale("),
      SALE_RPC.indexOf("comment on function public.seller_sale"));
    expect(fn).toContain("public.order_line_quantities(l.id) q");
    expect(fn).toContain("'cancelled', q.cancelled, 'returned', q.returned");
  });

  it("changes no signature, so it cannot become an overload", () => {
    expect(SALE_RPC).toContain("create or replace function public.seller_sale(p_id bigint)");
    expect(SALE_RPC).toContain("create or replace function public.admin_order(p_order_number text)");
  });

  it("writes nothing", () => {
    for (const forbidden of ["insert into", "update public.", "delete from", "drop table"]) {
      expect(SALE_RPC.toLowerCase()).not.toContain(forbidden);
    }
  });
});
