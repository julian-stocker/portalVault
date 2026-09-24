/**
 * DER FEHLER, DEN DIESE TESTS FESTHALTEN.
 *
 * SI-2026-001067, der ganz gewöhnliche Alltag: Drill Sergeant stornieren,
 * 4,04 € erstatten — dann Eruptor stornieren und 1,79 € erstatten wollen.
 * Der zweite Versuch scheiterte mit „Die Aufteilung ergibt nicht den
 * Erstattungsbetrag."
 *
 * Ursache: zwei Rechnungen, ein Formular. Der VORSCHLAG zog alle bisherigen
 * Erstattungen ab (5,83 − 4,04 = 1,79), die AUFTEILUNG zog nichts ab
 * (4,04 + 1,79 = 5,83). Drill Sergeant wurde ein zweites Mal angeboten.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  allocationsValid, openLineRefunds, openRefundTotal, unattributedRefund,
} from "./order-lines";
import { de } from "@/lib/i18n/de";

const ORDER_PAGE = readFileSync(
  "src/app/(business)/business/orders/[orderNumber]/page.tsx", "utf8");
const FORM = readFileSync("src/components/admin/refund-form.tsx", "utf8");

/* Die echten Zahlen der Bestellung. */
const DRILL = { id: 68, lineTotal: 4.04, quantity: 1, cancelled: 1 };
const ERUPTOR = { id: 69, lineTotal: 1.79, quantity: 1, cancelled: 1 };
const NINJA = { id: 70, lineTotal: 2.67, quantity: 3, cancelled: 0 };
const FIRST_REFUND = [
  { type: "line", orderLineId: 68, quantity: 1, amount: "4.04" },
];

describe("what is still owed per position", () => {
  it("offers a single cancelled position exactly once", () => {
    const open = openLineRefunds([DRILL, ERUPTOR, NINJA], []);
    expect(open).toEqual([
      { orderLineId: 68, quantity: 1, amount: 4.04 },
      { orderLineId: 69, quantity: 1, amount: 1.79 },
    ]);
    expect(openRefundTotal(open)).toBe(5.83);
  });

  /* GENAU DER GEMELDETE FALL. */
  it("does not offer a position that has already been repaid", () => {
    const open = openLineRefunds([DRILL, ERUPTOR, NINJA], FIRST_REFUND);
    expect(open).toEqual([{ orderLineId: 69, quantity: 1, amount: 1.79 }]);
    expect(openRefundTotal(open)).toBe(1.79);
  });

  it("leaves a position that was never cancelled out of it", () => {
    expect(openLineRefunds([NINJA], []).length).toBe(0);
  });

  it("offers nothing once everything has been repaid", () => {
    const open = openLineRefunds([DRILL, ERUPTOR], [
      ...FIRST_REFUND,
      { type: "line", orderLineId: 69, quantity: 1, amount: 1.79 },
    ]);
    expect(open).toEqual([]);
    expect(openRefundTotal(open)).toBe(0);
  });

  it("offers the remainder when a position was only partly repaid", () => {
    // 3 storniert à 0,89, eine davon erstattet.
    const line = { id: 70, lineTotal: 2.67, quantity: 3, cancelled: 3 };
    const open = openLineRefunds([line], [
      { type: "line", orderLineId: 70, quantity: 1, amount: 0.89 },
    ]);
    expect(open).toEqual([{ orderLineId: 70, quantity: 2, amount: 1.78 }]);
  });

  it("ignores allocations that belong to something other than a position", () => {
    // Versand und Kulanz sagen nichts darüber, was eine Figur wert war.
    const open = openLineRefunds([ERUPTOR], [
      { type: "shipping", orderLineId: null, quantity: null, amount: 5.49 },
      { type: "goodwill", orderLineId: null, quantity: null, amount: 2 },
    ]);
    expect(open).toEqual([{ orderLineId: 69, quantity: 1, amount: 1.79 }]);
  });

  it("still names a piece when an allocation left the quantity out", () => {
    const line = { id: 70, lineTotal: 2.67, quantity: 3, cancelled: 3 };
    const open = openLineRefunds([line], [
      { type: "line", orderLineId: 70, quantity: null, amount: 0.89 },
    ]);
    expect(open[0].amount).toBe(1.78);
    expect(open[0].quantity).toBeGreaterThan(0);
    expect(open[0].quantity).toBeLessThanOrEqual(3);
  });
});

/**
 * EINE RETOURE IST AUCH GELD, DAS ZURÜCKGEHT.
 *
 * `openLineRefunds()` rechnete zuerst nur über `cancelled`. Ninja Stealth Elf
 * auf SI-2026-001067 zeigte, was das kostet: 1 von 3 storniert und mit 0,89 €
 * erstattet, danach 1 Stück zurückgenommen — und der Erstattungsbereich bot
 * nichts an, weil `owed` bei 0,89 € stehen blieb. Ein Stück war beim Kunden
 * weg und unbezahlt.
 *
 * Seither ist die Basis `settled = cancelled + returned`. Beide greifen auf
 * denselben Vorrat zu (`ordered − cancelled − returned` begrenzt in 0095
 * sowohl `cancellable` als auch `returnable`), also kann ein Stück nicht in
 * beiden Töpfen liegen.
 */
describe("cancelled and returned draw on the same money", () => {
  /* Die echten Zahlen der Position: 2,67 € auf 3 Stück, also 0,89 je Stück. */
  const NINJA = { id: 70, lineTotal: 2.67, quantity: 3 };
  const line = (cancelled: number, returned: number) => ({ ...NINJA, cancelled, returned });
  const alloc = (...amounts: number[]) => amounts.map((amount, index) => ({
    type: "line", orderLineId: 70, quantity: 1, amount,
    /* Mehrere Refunds derselben Position: je eine Zuordnung pro Vorgang. */
    _refund: index,
  }));

  it("1 storniert, nichts erstattet → ein Stück offen", () => {
    expect(openLineRefunds([line(1, 0)], [])).toEqual([
      { orderLineId: 70, quantity: 1, amount: 0.89 },
    ]);
  });

  it("1 storniert und erstattet → nichts offen", () => {
    expect(openLineRefunds([line(1, 0)], alloc(0.89))).toEqual([]);
  });

  /* DER GEMELDETE FALL — heutiger Staging-Zustand. */
  it("1 storniert und erstattet, 1 retour → genau ein Stück zusätzlich offen", () => {
    expect(openLineRefunds([line(1, 1)], alloc(0.89))).toEqual([
      { orderLineId: 70, quantity: 1, amount: 0.89 },
    ]);
  });

  it("1 storniert, 1 retour, beide erstattet → nichts offen", () => {
    expect(openLineRefunds([line(1, 1)], alloc(0.89, 0.89))).toEqual([]);
  });

  it("1 storniert, 2 retour, zwei Stück erstattet → ein Stück offen", () => {
    expect(openLineRefunds([line(1, 2)], alloc(0.89, 0.89))).toEqual([
      { orderLineId: 70, quantity: 1, amount: 0.89 },
    ]);
  });

  it("alle drei erstattet → nichts mehr offen", () => {
    expect(openLineRefunds([line(1, 2)], alloc(0.89, 0.89, 0.89))).toEqual([]);
  });

  it("rechnet nie über die bestellte Menge hinaus", () => {
    // Eine Projektion, die mehr meldet, als bestellt wurde, darf nicht mehr
    // Geld anbieten als die Position gekostet hat.
    for (const [cancelled, returned] of [[3, 3], [2, 5], [9, 9]]) {
      const open = openLineRefunds([line(cancelled, returned)], []);
      expect(open[0].amount, `${cancelled}/${returned}`).toBe(2.67);
      expect(open[0].quantity, `${cancelled}/${returned}`).toBeLessThanOrEqual(3);
    }
  });

  it("a return alone is enough — nothing has to be cancelled first", () => {
    expect(openLineRefunds([line(0, 1)], [])).toEqual([
      { orderLineId: 70, quantity: 1, amount: 0.89 },
    ]);
  });

  it("adds up to the line total exactly, one piece at a time", () => {
    // 1,00 € auf 3: kumulativ 0,33 / 0,34 / 0,33, in Summe genau 1,00 €.
    const uneven = { id: 1, lineTotal: 1.0, quantity: 3 };
    const parts: number[] = [];
    const paid: { type: string; orderLineId: number; quantity: number; amount: number }[] = [];
    for (const settled of [1, 2, 3]) {
      const open = openLineRefunds(
        [{ ...uneven, cancelled: 1, returned: settled - 1 }], paid);
      expect(open.length, `settled ${settled}`).toBe(1);
      parts.push(open[0].amount);
      paid.push({ type: "line", orderLineId: 1, quantity: 1, amount: open[0].amount });
    }
    expect(parts).toEqual([0.33, 0.34, 0.33]);
    expect(Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100).toBe(1.0);
    // Und danach ist die Position durch.
    expect(openLineRefunds([{ ...uneven, cancelled: 1, returned: 2 }], paid)).toEqual([]);
  });

  it("is not reduced by shipping or goodwill", () => {
    const open = openLineRefunds([line(1, 1)], [
      ...alloc(0.89),
      { type: "shipping", orderLineId: null, quantity: null, amount: 5.49 },
      { type: "goodwill", orderLineId: null, quantity: null, amount: 2 },
    ]);
    expect(open).toEqual([{ orderLineId: 70, quantity: 1, amount: 0.89 }]);
  });

  it("is not reduced by a refund nobody assigned to a position", () => {
    // Eine Erstattung ohne Aufteilung laesst sich keiner Position zuordnen
    // und wird deshalb nicht verrechnet, sondern ausgewiesen.
    expect(openLineRefunds([line(1, 1)], alloc(0.89))).toEqual([
      { orderLineId: 70, quantity: 1, amount: 0.89 },
    ]);
    expect(unattributedRefund([{ amount: 4.04 }, { amount: 0.89 }], alloc(0.89)))
      .toBe(4.04);
  });

  it("still writes nothing — a return never refunds by itself", () => {
    const LINES = readFileSync("src/lib/commerce/order-lines.ts", "utf8");
    const fn = LINES.slice(LINES.indexOf("export function openLineRefunds("));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    for (const forbidden of ["rpc(", "insert", "recordRefund", "await"]) {
      expect(body).not.toContain(forbidden);
    }
  });

  it("the order screen hands the returned quantity over", () => {
    expect(ORDER_PAGE).toContain("returned: line.returned ?? 0,");
  });
});

describe("the amount and the split cannot disagree", () => {
  it("adds up exactly, for every stage of this order", () => {
    const stages = [
      { lines: [DRILL, ERUPTOR, NINJA], allocations: [] },
      { lines: [DRILL, ERUPTOR, NINJA], allocations: FIRST_REFUND },
      { lines: [{ ...NINJA, cancelled: 2 }], allocations: [] },
      { lines: [{ ...NINJA, cancelled: 3 }],
        allocations: [{ type: "line", orderLineId: 70, quantity: 1, amount: 0.89 }] },
    ];
    for (const stage of stages) {
      const open = openLineRefunds(stage.lines, stage.allocations);
      const total = openRefundTotal(open);
      if (total <= 0) continue;
      // Dieselbe Prüfung, an der die Aktion den Vorgang abgewiesen hat.
      expect(allocationsValid(
        open.map((one) => ({
          type: "line" as const, orderLineId: one.orderLineId,
          quantity: one.quantity, amount: one.amount,
        })),
        total,
      ), JSON.stringify(stage)).toBe(true);
    }
  });

  it("adds up on a line whose share does not divide evenly", () => {
    // 1,00 € auf 3 Stück: 0,33 / 0,33 / 0,34 — die Summe muss stimmen.
    const line = { id: 1, lineTotal: 1.0, quantity: 3, cancelled: 3 };
    const open = openLineRefunds([line], [
      { type: "line", orderLineId: 1, quantity: 1, amount: 0.33 },
    ]);
    expect(open[0].amount).toBe(0.67);
    expect(allocationsValid(
      [{ type: "line", orderLineId: 1, quantity: open[0].quantity, amount: 0.67 }], 0.67,
    )).toBe(true);
  });
});

describe("money nobody assigned to a position", () => {
  it("is reported, not netted away", () => {
    // Eine Erstattung ohne Aufteilung — jede vor 0095 ist so.
    expect(unattributedRefund([{ amount: 4.04 }], [])).toBe(4.04);
    // Und sie verändert den Vorschlag nicht: geraten wird nicht.
    expect(openRefundTotal(openLineRefunds([ERUPTOR], []))).toBe(1.79);
  });

  it("is zero when every refund is fully explained", () => {
    expect(unattributedRefund([{ amount: "4.04" }], FIRST_REFUND)).toBe(0);
  });

  it("is shown on the form", () => {
    expect(FORM).toContain("unattributed > 0");
    expect(de.business.withdrawals.unattributed("4,04 €")).toContain("4,04 €");
  });
});

describe("the screen", () => {
  it("takes the amount and the split from one list", () => {
    expect(ORDER_PAGE).toContain("const openLines = openLineRefunds(");
    expect(ORDER_PAGE).toContain("const refundOpen = openRefundTotal(openLines);");
    expect(ORDER_PAGE).toContain("cancelled={openLines.map(");
    // Und rechnet den Vorschlag nicht mehr selbst gegen alle Erstattungen.
    expect(ORDER_PAGE).not.toContain("refundState({");
  });

  it("puts the refund directly under the positions", () => {
    const lines = ORDER_PAGE.indexOf("<OrderLinesTable");
    const refund = ORDER_PAGE.indexOf("<RefundForm");
    const paid = ORDER_PAGE.indexOf("copy.finance.paidTitle");
    expect(lines).toBeGreaterThan(-1);
    expect(refund).toBeGreaterThan(lines);
    expect(refund).toBeLessThan(paid);
  });

  it("says confirm, not record", () => {
    expect(de.business.withdrawals.record).toBe("Erstattung bestätigen");
    expect(de.business.withdrawals.refundHeading).toBe("Erstattung bestätigen");
  });

  it("keeps the layout responsive", () => {
    // Die Zeile der Felder bricht weiterhin um, statt zu überlaufen.
    expect(FORM).toContain("flex flex-wrap items-end gap-3");
  });

  it("shows what the suggestion is made of", () => {
    expect(FORM).toContain("cancelled.map((one) => (");
    expect(FORM).toContain("copy.allocationLine(");
  });
});

describe("a cancellation is still not a refund", () => {
  it("writes nothing while working all of this out", () => {
    const block = ORDER_PAGE.slice(
      ORDER_PAGE.indexOf("const allocations = refunds.flatMap("),
      ORDER_PAGE.indexOf("const costs ="));
    for (const forbidden of ["rpc(", "insert", "recordRefund("]) {
      expect(block).not.toContain(forbidden);
    }
  });

  it("refuses a split that does not add up, before the database is asked", () => {
    // Der Schutz bleibt: er hat den falschen Vorschlag korrekt abgewiesen.
    expect(allocationsValid(
      [{ type: "line", orderLineId: 68, quantity: 1, amount: 4.04 },
       { type: "line", orderLineId: 69, quantity: 1, amount: 1.79 }],
      1.79,
    )).toBe(false);
  });
});
