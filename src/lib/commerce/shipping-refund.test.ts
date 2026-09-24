/**
 * Die Versandkosten als eigene, ausdrückliche Erstattung (0097).
 *
 * DER ANLASS. SI-2026-001066: vollständiger Widerruf vor Versand, beide
 * Positionen storniert. Der Erstattungsbereich schlug 25,18 € Warenwert vor —
 * richtig —, aber die Hinsendekosten von 5,49 € gab es nur, indem der Operator
 * 30,67 € von Hand eintippt. Dann fiel die Aufteilung weg, und aus einer
 * sauber zugeordneten Rückabwicklung wurde eine unzugeordnete Zahlung.
 *
 * KEIN HAKEN IM VORAUS. Ob der Versand zu erstatten ist, hängt am Fall: beim
 * Widerruf ja (§ 357 Abs. 2 BGB), bei einem einzelnen Positionsstorno in der
 * Regel nicht — das Paket geht ja trotzdem raus. Keine Regel im System kann
 * das auseinanderhalten, also entscheidet der Mensch.
 *
 * KEINE MIGRATION. `order_refund_allocations` kennt `shipping` seit 0095:
 * `allocation_type = 'shipping'`, `order_line_id` NULL, `quantity` NULL —
 * genau die Form, die die CHECK-Bedingungen dort erzwingen.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { allocationsValid, openLineRefunds, openRefundTotal, openShippingRefund }
  from "./order-lines";
import { de } from "@/lib/i18n/de";

const FORM = readFileSync("src/components/admin/refund-form.tsx", "utf8");
const ORDER_PAGE = readFileSync(
  "src/app/(business)/business/orders/[orderNumber]/page.tsx", "utf8");
const MIGRATION = readFileSync(
  "supabase/migrations/0095_order_cancellation_and_returns.sql", "utf8");

/* Die echten Zahlen von SI-2026-001066. */
const SHIPPING = 5.49;
const LINES = [
  { id: 66, lineTotal: 2.69, quantity: 1, cancelled: 1, returned: 0 },
  { id: 67, lineTotal: 22.49, quantity: 1, cancelled: 1, returned: 0 },
];
const line = (id: number, amount: number) =>
  ({ type: "line", orderLineId: id, quantity: 1, amount });
const ship = (amount: number) =>
  ({ type: "shipping", orderLineId: null, quantity: null, amount });

describe("what is still owed for the shipping", () => {
  it("is the whole charge while nothing has been repaid", () => {
    expect(openShippingRefund(SHIPPING, [])).toBe(5.49);
  });

  it("is what is left after a partial shipping refund", () => {
    expect(openShippingRefund(SHIPPING, [ship(2)])).toBe(3.49);
    expect(openShippingRefund(SHIPPING, [ship(2), ship(1.49)])).toBe(2);
  });

  it("is nothing once the shipping has been repaid in full", () => {
    expect(openShippingRefund(SHIPPING, [ship(5.49)])).toBe(0);
    // Und auch dann nicht negativ, wenn mehr zugeordnet wurde als berechnet.
    expect(openShippingRefund(SHIPPING, [ship(9)])).toBe(0);
  });

  it("is untouched by line refunds", () => {
    expect(openShippingRefund(SHIPPING, [line(66, 2.69), line(67, 22.49)])).toBe(5.49);
  });

  it("is untouched by goodwill and other", () => {
    expect(openShippingRefund(SHIPPING, [
      { type: "goodwill", orderLineId: null, quantity: null, amount: 3 },
      { type: "other", orderLineId: null, quantity: null, amount: 1 },
    ])).toBe(5.49);
  });

  it("handles an order with no shipping at all", () => {
    expect(openShippingRefund(0, [])).toBe(0);
    expect(openShippingRefund(null, [])).toBe(0);
    expect(openShippingRefund("5.49", [])).toBe(5.49);
  });
});

describe("the two questions stay separate", () => {
  it("a shipping allocation does not settle a position", () => {
    const open = openLineRefunds(LINES, [ship(5.49)]);
    expect(open).toEqual([
      { orderLineId: 66, quantity: 1, amount: 2.69 },
      { orderLineId: 67, quantity: 1, amount: 22.49 },
    ]);
  });

  it("a line allocation does not settle the shipping", () => {
    expect(openLineRefunds(LINES, [line(66, 2.69), line(67, 22.49)])).toEqual([]);
    expect(openShippingRefund(SHIPPING, [line(66, 2.69), line(67, 22.49)])).toBe(5.49);
  });
});

describe("B4: the full reversal of SI-2026-001066", () => {
  const open = openLineRefunds(LINES, []);

  it("proposes the goods at 25,18 €", () => {
    expect(openRefundTotal(open)).toBe(25.18);
  });

  it("adds up to the whole payment once the shipping is ticked", () => {
    const shipping = openShippingRefund(SHIPPING, []);
    const total = Math.round((openRefundTotal(open) + shipping) * 100) / 100;
    expect(total).toBe(30.67);

    const allocations = [
      ...open.map((one) => ({
        type: "line" as const, orderLineId: one.orderLineId,
        quantity: one.quantity, amount: one.amount,
      })),
      { type: "shipping" as const, orderLineId: null, quantity: null, amount: shipping },
    ];
    // Dieselbe Pruefung, die Aktion und Datenbank anwenden.
    expect(allocationsValid(allocations, total)).toBe(true);
    expect(allocations.map((a) => a.amount)).toEqual([2.69, 22.49, 5.49]);
  });

  it("cannot pay the shipping twice", () => {
    // Nach der Erstattung oben ist nichts mehr offen — weder Ware noch Versand.
    const after = [line(66, 2.69), line(67, 22.49), ship(5.49)];
    expect(openLineRefunds(LINES, after)).toEqual([]);
    expect(openShippingRefund(SHIPPING, after)).toBe(0);
  });

  it("still adds up when only part of the shipping was repaid earlier", () => {
    const earlier = [ship(2)];
    const shipping = openShippingRefund(SHIPPING, earlier);
    expect(shipping).toBe(3.49);
    const open2 = openLineRefunds(LINES, earlier);
    const total = Math.round((openRefundTotal(open2) + shipping) * 100) / 100;
    expect(total).toBe(28.67);
    expect(allocationsValid([
      ...open2.map((o) => ({
        type: "line" as const, orderLineId: o.orderLineId, quantity: o.quantity, amount: o.amount,
      })),
      { type: "shipping" as const, orderLineId: null, quantity: null, amount: shipping },
    ], total)).toBe(true);
  });
});

describe("the form", () => {
  it("offers the shipping as a tick box, never pre-ticked", () => {
    expect(FORM).toContain("useState(false)");
    expect(FORM).toContain('type="checkbox"');
    expect(FORM).toContain("copy.refundShipping(formatPrice(openShipping))");
    expect(de.business.withdrawals.refundShipping("5,49 €")).toContain("5,49 €");
  });

  it("hides it when there is nothing left to repay for the shipping", () => {
    expect(FORM).toContain("{openShipping > 0 ?");
  });

  it("sends it in the shape the schema requires", () => {
    const block = FORM.slice(FORM.indexOf("withShipping && openShipping > 0"));
    expect(block).toContain('type: "shipping" as const');
    expect(block).toContain("orderLineId: null");
    expect(block).toContain("quantity: null");
  });

  it("keeps amount and split in step", () => {
    // Der Haken setzt den Betrag; ein von Hand geaenderter Betrag schickt
    // weiterhin gar keine Aufteilung statt einer falschen.
    expect(FORM).toContain("const sum = (suggested ?? 0) + (next ? openShipping : 0);");
    expect(FORM).toContain("Math.round(value * 100) === Math.round(target * 100)");
    expect(FORM).toContain(": [];");
  });
});

describe("the screen only asks where the contract was reversed", () => {
  it("offers the shipping on a cancelled order or an open withdrawal", () => {
    expect(ORDER_PAGE).toContain(
      'const reversed = order.fulfillment_status === "cancelled" || withdrawal !== null;');
    expect(ORDER_PAGE).toContain("const shippingOffer = reversed ? openShipping : 0;");
  });

  it("does not open the refund panel on an ordinary order just for shipping", () => {
    expect(ORDER_PAGE).toContain("{refundOpen > 0 || shippingOffer > 0 ? (");
  });
});

/**
 * DASS DIE ERSTATTUNG DEN WIDERRUF SCHLIESST, WIRD JETZT GESAGT.
 *
 * `seller_record_refund()` setzt `handled_at` auf dem mitgesendeten Widerruf,
 * seit 0047 und absichtlich: die Rückzahlung IST die Erledigung. Ungesagt war
 * es trotzdem — auf SI-2026-001066 wurde Widerruf #7 nebenbei geschlossen,
 * ohne dass jemand darauf geklickt hätte. Verhalten unverändert, nur der Satz
 * kommt dazu.
 */
describe("the refund says that it closes the withdrawal", () => {
  it("shows the sentence when a declaration travels with it", () => {
    expect(FORM).toContain("withdrawalId !== undefined && !withdrawalHandled");
    expect(FORM).toContain("copy.refundClosesWithdrawal");
    expect(de.business.withdrawals.refundClosesWithdrawal)
      .toBe("Mit dieser Rückerstattung wird der Widerruf als bearbeitet markiert.");
  });

  it("stays quiet when the declaration is already ticked off", () => {
    // `coalesce(handled_at, now())` behält das erste Datum — dann ändert die
    // Erstattung daran nichts, und der Satz wäre schlicht falsch.
    expect(FORM).toContain("withdrawalHandled = false");
  });

  it("stays quiet where there is no declaration at all", () => {
    // Die gewöhnliche Positionserstattung ohne Widerruf sagt nichts dazu.
    expect(FORM).toContain("withdrawalId !== undefined &&");
  });

  it("the order screen passes whether it is already handled", () => {
    expect(ORDER_PAGE).toContain(
      "withdrawalHandled={(withdrawal?.handled_at ?? null) !== null}");
  });

  it("changes nothing about the coupling itself", () => {
    const sql = readFileSync(
      "supabase/migrations/0095_order_cancellation_and_returns.sql", "utf8");
    const fn = sql.slice(sql.indexOf("create or replace function public.seller_record_refund"));
    expect(fn.slice(0, fn.indexOf("\n$$;")))
      .toContain("set handled_at = coalesce(w.handled_at, now()), handled_by = auth.uid()");
  });
});

describe("no migration was needed", () => {
  it("the schema has carried `shipping` since 0095", () => {
    expect(MIGRATION).toContain("check (allocation_type in ('line', 'shipping', 'goodwill', 'other'))");
    // Nur eine Positionszuordnung nennt eine Position und eine Menge.
    expect(MIGRATION).toContain("check ((allocation_type = 'line') = (order_line_id is not null))");
    expect(MIGRATION).toContain(
      "check (quantity is null or (allocation_type = 'line' and quantity > 0))");
  });

  it("nothing refunds by itself", () => {
    const lines = readFileSync("src/lib/commerce/order-lines.ts", "utf8");
    const fn = lines.slice(lines.indexOf("export function openShippingRefund"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    for (const forbidden of ["rpc(", "insert", "await", "recordRefund"]) {
      expect(body).not.toContain(forbidden);
    }
  });
});
