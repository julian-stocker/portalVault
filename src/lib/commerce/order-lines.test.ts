/**
 * STORNO, RETOURE UND FEHLBESTAND SIND DREI EREIGNISSE — UND GELD IST EIN VIERTES.
 *
 * Der Alltagsfall, an dem sich alles hier messen lässt: acht Figuren für
 * 27,04 €, eine davon zu 3,49 € stellt sich als nicht lieferbar heraus. Die
 * Bestellung wird NICHT storniert — eine Position wird storniert, die sieben
 * anderen gehen raus, und 3,49 € werden erstattet.
 *
 * Der gefährlichste Fehler dabei ist leise: aus „kann nicht geliefert werden"
 * ein „liegt wieder im Lager" zu machen. Deshalb steht die Unterscheidung
 * `restocked` / `shortfall` / `none` im Zentrum dieser Datei, und deshalb
 * entscheidet sie der Server aus einer technischen Tatsache plus einer
 * einzigen Frage an den Operator.
 */
import { shipBlocker } from "@/lib/admin/orders";
import { openLineRefunds, openRefundTotal } from "./order-lines";
import { describe, expect, it } from "vitest";

import {
  ALLOCATION_TYPES,
  allocationsValid,
  changesStock,
  lineQuantities,
  movementsFor,
  resolveStockOutcome,
  suggestedRefund,
  type RefundAllocation,
} from "./order-lines.ts";

describe("which stock outcome a cancellation has", () => {
  it("is none when the position was never booked out", () => {
    // Die physische Frage darf hier KEINEN Movement erzeugen — egal, was der
    // Operator antwortet.
    expect(resolveStockOutcome(false, "present")).toBe("none");
    expect(resolveStockOutcome(false, "missing")).toBe("none");
    expect(movementsFor("none")).toBe(0);
  });

  it("is restocked when it was booked out and the piece is there", () => {
    expect(resolveStockOutcome(true, "present")).toBe("restocked");
    expect(movementsFor("restocked")).toBe(1);
    expect(changesStock("restocked")).toBe(true);
  });

  it("is shortfall when it was booked out and the piece is not there", () => {
    expect(resolveStockOutcome(true, "missing")).toBe("shortfall");
    // Zwei Bewegungen: +return macht den Verkauf rückgängig, −correction
    // schreibt den Fehlbestand ab. Netto null.
    expect(movementsFor("shortfall")).toBe(2);
    expect(changesStock("shortfall")).toBe(false);
  });

  it("the operator is asked one question, and it has two answers", () => {
    // Kein „war nie ausgebucht" in der Auswahl: das ist ein technischer
    // Zustand, den der Server kennt.
    const answers: Parameters<typeof resolveStockOutcome>[1][] = ["present", "missing"];
    expect(answers).toHaveLength(2);
    for (const answer of answers) {
      expect(["none", "restocked", "shortfall"]).toContain(resolveStockOutcome(true, answer));
    }
  });
});

describe("what is left of a line", () => {
  it("counts nothing when nothing happened", () => {
    expect(lineQuantities(3, [])).toMatchObject({
      ordered: 3, cancelled: 0, returned: 0, fulfillable: 3, outstanding: 3, cancellable: 3,
    });
  });

  it("Bash x3, one cancelled, two to deliver", () => {
    const q = lineQuantities(3, [{ kind: "cancelled", quantity: 1 }]);
    expect(q.cancelled).toBe(1);
    expect(q.fulfillable).toBe(2);
    expect(q.cancellable).toBe(2);
  });

  it("adds repeated partial cancellations", () => {
    const q = lineQuantities(3, [
      { kind: "cancelled", quantity: 1 },
      { kind: "cancelled", quantity: 1 },
    ]);
    expect(q.cancelled).toBe(2);
    expect(q.fulfillable).toBe(1);
    expect(q.cancellable).toBe(1);
  });

  it("a return reduces what is outstanding, not what was fulfillable", () => {
    const q = lineQuantities(3, [{ kind: "returned", quantity: 1 }]);
    expect(q.fulfillable).toBe(3);
    expect(q.returned).toBe(1);
    expect(q.outstanding).toBe(2);
    expect(q.returnable).toBe(2);
  });

  it("cancelling and returning draw on the same three pieces", () => {
    const q = lineQuantities(3, [
      { kind: "cancelled", quantity: 1 },
      { kind: "returned", quantity: 1 },
    ]);
    expect(q.cancellable).toBe(1);
    expect(q.returnable).toBe(1);
  });

  it("never goes negative, whatever the ledger says", () => {
    const q = lineQuantities(1, [
      { kind: "cancelled", quantity: 1 },
      { kind: "returned", quantity: 1 },
    ]);
    expect(q.fulfillable).toBe(0);
    expect(q.outstanding).toBe(0);
    expect(q.cancellable).toBe(0);
  });
});

/*
 * Seit 0097 beantwortet `shipBlocker()` diese Frage als einzige Stelle. Die
 * zweite Fassung (`shipBlock` in diesem Modul) war getestet und wurde von
 * nirgendwo aufgerufen — genau deshalb fielen die beiden Gründe auf dem
 * Bildschirm nicht auf.
 */
describe("whether an order may be shipped", () => {
  const shippable = { payment_status: "paid", fulfillment_status: "unfulfilled", needs_resolution: false };

  it("a partial cancellation does not block the parcel", () => {
    // Acht Figuren, eine storniert, sieben gehen raus.
    expect(shipBlocker({ ...shippable, withdrawalDeclared: false, fulfillableTotal: 7 }))
      .toBeNull();
  });

  it("a withdrawal blocks it, even with goods left", () => {
    expect(shipBlocker({ ...shippable, withdrawalDeclared: true, fulfillableTotal: 7 }))
      .toBe("withdrawn");
  });

  it("a fully cancelled order has nothing to send", () => {
    expect(shipBlocker({ ...shippable, withdrawalDeclared: false, fulfillableTotal: 0 }))
      .toBe("nothing_to_ship");
  });

  it("the withdrawal wins when both apply", () => {
    expect(shipBlocker({ ...shippable, withdrawalDeclared: true, fulfillableTotal: 0 }))
      .toBe("withdrawn");
  });

  /* DER FALL, DER DEN BILDSCHIRM GESPERRT HAT. */
  it("ships a partially refunded order, like the database does", () => {
    expect(shipBlocker({
      ...shippable, payment_status: "partially_refunded",
      withdrawalDeclared: false, fulfillableTotal: 7,
    })).toBeNull();
  });

  it("still refuses an order that was paid back in full", () => {
    expect(shipBlocker({ ...shippable, payment_status: "refunded", fulfillableTotal: 7 }))
      .toBe("not_paid");
  });

  /* Die beiden neuen Gründe sperren nur den Hinweg. */
  it("keeps the way back open for an order that already went out", () => {
    expect(shipBlocker({
      ...shippable, fulfillment_status: "shipped",
      withdrawalDeclared: true, fulfillableTotal: 0,
    })).toBeNull();
  });
});

describe("what a cancelled quantity suggests as a refund", () => {
  it("one of one is the whole line", () => {
    expect(suggestedRefund({ lineTotal: 3.49, quantity: 1 }, 1)).toBe(3.49);
  });

  it("one of three is a third, to the cent", () => {
    // 10,47 / 3 = 3,49
    expect(suggestedRefund({ lineTotal: 10.47, quantity: 3 }, 1)).toBe(3.49);
    expect(suggestedRefund({ lineTotal: 10.47, quantity: 3 }, 2)).toBe(6.98);
  });

  it("cancelling everything gives the line total back exactly", () => {
    // 10,00 / 3 ist 3,33… — die letzte Menge traegt den Rest.
    expect(suggestedRefund({ lineTotal: 10, quantity: 3 }, 3)).toBe(10);
    expect(suggestedRefund({ lineTotal: 10, quantity: 3 }, 1)).toBe(3.33);
  });

  it("suggests nothing for a nonsensical input", () => {
    expect(suggestedRefund({ lineTotal: 3.49, quantity: 1 }, 0)).toBe(0);
    expect(suggestedRefund({ lineTotal: 0, quantity: 1 }, 1)).toBe(0);
    expect(suggestedRefund({ lineTotal: Number.NaN, quantity: 1 }, 1)).toBe(0);
  });
});

/*
 * `refundState()` beantwortete diese Frage bis 0097 und wurde danach von
 * niemandem mehr aufgerufen — dieselbe Form toter Geldlogik, die beim
 * Versandgate zum Fehler geführt hat. Die Frage stellt jetzt
 * `openLineRefunds()`, positionsweise und gegen die Aufteilungen gerechnet.
 */
describe("where the order stands on money", () => {
  const line = { id: 1, lineTotal: 3.49, quantity: 1, cancelled: 0 };

  it("nothing owed and nothing paid back", () => {
    expect(openRefundTotal(openLineRefunds([line], []))).toBe(0);
  });

  it("3,49 EUR open after the cancellation", () => {
    expect(openRefundTotal(openLineRefunds([{ ...line, cancelled: 1 }], []))).toBe(3.49);
  });

  it("3,49 EUR documented, nothing open", () => {
    expect(openRefundTotal(openLineRefunds([{ ...line, cancelled: 1 }], [
      { type: "line", orderLineId: 1, quantity: 1, amount: 3.49 },
    ]))).toBe(0);
  });

  it("more repaid than the position was worth is not a negative debt", () => {
    expect(openRefundTotal(openLineRefunds([{ ...line, cancelled: 1 }], [
      { type: "line", orderLineId: 1, quantity: 1, amount: 5 },
    ]))).toBe(0);
  });
});

describe("how a refund may be split", () => {
  const line = (amount: number, id = 1, quantity: number | null = 1): RefundAllocation =>
    ({ type: "line", orderLineId: id, quantity, amount });

  it("knows four kinds, and only one names a position", () => {
    expect([...ALLOCATION_TYPES]).toEqual(["line", "shipping", "goodwill", "other"]);
  });

  it("no allocation at all stays valid", () => {
    // Jede Zeile, die vor dieser Tabelle entstanden ist, bleibt gueltig.
    expect(allocationsValid([], 3.49)).toBe(true);
  });

  it("one position", () => {
    expect(allocationsValid([line(3.49)], 3.49)).toBe(true);
  });

  it("several positions", () => {
    expect(allocationsValid([line(3.49, 1), line(2.5, 2), line(1.01, 3)], 7)).toBe(true);
  });

  it("a position and the shipping", () => {
    expect(allocationsValid(
      [line(3.49), { type: "shipping", orderLineId: null, quantity: null, amount: 2.5 }],
      5.99,
    )).toBe(true);
  });

  it("refuses parts that do not add up", () => {
    expect(allocationsValid([line(3.49)], 3.5)).toBe(false);
    expect(allocationsValid([line(3.49), line(1, 2)], 3.49)).toBe(false);
  });

  it("refuses a line without a position, and a position without a line kind", () => {
    expect(allocationsValid(
      [{ type: "line", orderLineId: null, quantity: 1, amount: 3.49 }], 3.49)).toBe(false);
    expect(allocationsValid(
      [{ type: "goodwill", orderLineId: 4, quantity: null, amount: 3.49 }], 3.49)).toBe(false);
  });

  it("refuses a quantity where the kind has none, and a broken one where it does", () => {
    expect(allocationsValid(
      [{ type: "shipping", orderLineId: null, quantity: 1, amount: 3.49 }], 3.49)).toBe(false);
    expect(allocationsValid([line(3.49, 1, 0)], 3.49)).toBe(false);
    expect(allocationsValid([line(3.49, 1, 1.5)], 3.49)).toBe(false);
  });

  it("refuses an amount that is not money", () => {
    expect(allocationsValid([line(0)], 0)).toBe(false);
    expect(allocationsValid([line(-1)], -1)).toBe(false);
  });
});

/* ===================================================================== */
/**
 * DER ALLTAGSFALL, VON VORNE BIS HINTEN.
 *
 * 8 Figuren, 27,04 €. Ninjini zu 3,49 € ist nicht da.
 */
describe("eight figures, one of them missing", () => {
  const lines = [
    { id: 1, name: "Ninjini", ordered: 1, lineTotal: 3.49 },
    { id: 2, name: "Bash", ordered: 3, lineTotal: 10.47 },
    { id: 3, name: "Trigger Happy", ordered: 4, lineTotal: 13.08 },
  ];

  it("cancels one position without touching the rest", () => {
    const events = new Map<number, { kind: "cancelled" | "returned"; quantity: number }[]>([
      [1, [{ kind: "cancelled", quantity: 1 }]],
    ]);
    const fulfillable = lines.reduce(
      (sum, l) => sum + lineQuantities(l.ordered, events.get(l.id) ?? []).fulfillable, 0);
    expect(fulfillable).toBe(7);
    // Sieben Figuren wollen immer noch verschickt werden.
    expect(shipBlocker({
      payment_status: "paid", fulfillment_status: "unfulfilled", needs_resolution: false,
      withdrawalDeclared: false, fulfillableTotal: fulfillable,
    })).toBeNull();
  });

  it("suggests exactly the cancelled position's money", () => {
    expect(suggestedRefund({ lineTotal: 3.49, quantity: 1 }, 1)).toBe(3.49);
    expect(openRefundTotal(openLineRefunds(
      [{ id: 1, lineTotal: 3.49, quantity: 1, cancelled: 1 }], []))).toBe(3.49);
  });

  it("books nothing into stock, because the figure was never there", () => {
    const outcome = resolveStockOutcome(true, "missing");
    expect(outcome).toBe("shortfall");
    expect(movementsFor(outcome)).toBe(2);
    expect(changesStock(outcome)).toBe(false);   // netto 0
  });

  it("records the repayment against that very position", () => {
    const allocations: RefundAllocation[] =
      [{ type: "line", orderLineId: 1, quantity: 1, amount: 3.49 }];
    expect(allocationsValid(allocations, 3.49)).toBe(true);
    /* Und danach ist diese Position durch: sie wird nicht erneut angeboten. */
    expect(openLineRefunds(
      [{ id: 1, lineTotal: 3.49, quantity: 1, cancelled: 1 }], allocations)).toEqual([]);
  });
});
