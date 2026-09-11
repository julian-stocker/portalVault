import { describe, expect, it } from "vitest";

import { ctaFor, readPaymentState } from "./open-order";

/**
 * The observed bug: `/checkout` said "Zahlung erneut starten" to an account
 * that had never started a payment. These pin the three answers apart.
 */
describe("the payment button says what actually happened", () => {
  it("offers a first start when nothing has been attempted", () => {
    expect(ctaFor("pending", 0, false)).toBe("start");
  });

  it("offers a retry only once something has been attempted", () => {
    expect(ctaFor("pending", 1, false)).toBe("retry");
    expect(ctaFor("pending", 7, false)).toBe("retry");
    expect(ctaFor("failed", 2, false)).toBe("retry");
    // `expired` is the reservation, not the money: the order may still be
    // paid, and start_payment_attempt() is what decides.
    expect(ctaFor("expired", 1, false)).toBe("retry");
  });

  it("offers nothing at all once the money has arrived", () => {
    expect(ctaFor("paid", 0, false)).toBe("none");
    expect(ctaFor("paid", 3, false)).toBe("none");
  });

  it("offers nothing on a closed order", () => {
    for (const status of ["cancelled", "refunded", "partially_refunded"]) {
      expect(ctaFor(status, 1, false), status).toBe("none");
    }
  });

  it("offers nothing while a person has to look at it", () => {
    // start_payment_attempt() refuses a flagged order, so a button here could
    // only ever produce an error.
    expect(ctaFor("pending", 0, true)).toBe("none");
    expect(ctaFor("pending", 4, true)).toBe("none");
  });
});

describe("reading the row", () => {
  const ROW = {
    order_number: "SI-2026-001234",
    payment_status: "pending",
    needs_resolution: false,
    total_amount: "9.31",
    attempts: 0,
  };

  it("shapes a real row", () => {
    expect(readPaymentState(ROW)).toEqual({
      orderNumber: "SI-2026-001234",
      paymentStatus: "pending",
      needsResolution: false,
      totalAmount: 9.31,
      attempts: 0,
      cta: "start",
    });
  });

  it("returns nothing for a caller the database did not authorise", () => {
    // `order_payment_state()` returns no row at all in that case, which is
    // what keeps one account from being shown another's open order.
    for (const row of [null, undefined, {}, [], "SI-2026-001234", { order_number: "" }]) {
      expect(readPaymentState(row), JSON.stringify(row)).toBeNull();
    }
  });

  it("never invents an attempt count", () => {
    expect(readPaymentState({ ...ROW, attempts: undefined })?.attempts).toBe(0);
    expect(readPaymentState({ ...ROW, attempts: -1 })?.attempts).toBe(0);
    expect(readPaymentState({ ...ROW, attempts: "2" })?.attempts).toBe(0);
    expect(readPaymentState({ ...ROW, attempts: 2 })?.cta).toBe("retry");
  });

  it("treats a missing total as unknown rather than as zero", () => {
    expect(readPaymentState({ ...ROW, total_amount: null })?.totalAmount).toBeNull();
    expect(readPaymentState({ ...ROW, total_amount: "nonsense" })?.totalAmount).toBeNull();
  });
});
