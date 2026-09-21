import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { ctaFor, isAbandoned, readPaymentState } from "./open-order";

/**
 * A checkout that cannot be finished must not occupy the checkout page.
 *
 * The observed bug: after a hold lapsed, `/checkout` kept reopening the same
 * order. It printed "Die Reservierung für diese Bestellung ist abgelaufen.
 * Bitte lege den Artikel erneut in den Warenkorb." — and refilling the cart
 * landed on that same order again, because the browser's note about it was
 * never dropped. The instruction was unactionable by construction.
 */

const VIEW = readFileSync("src/components/checkout/checkout-view.tsx", "utf8");
const MIGRATION = readFileSync("supabase/migrations/0021_commerce_mode.sql", "utf8");

describe("the premise: what the database will and will not accept", () => {
  /**
   * The rule the UI has to agree with, read from the function itself rather
   * than believed. If this ever stops being the first check, the client's
   * notion of "can never be paid again" needs revisiting with it.
   */
  it("start_payment_attempt refuses any order that is not pending", () => {
    const fn = MIGRATION.slice(
      MIGRATION.indexOf("create or replace function public.start_payment_attempt"),
    ).split("$$;")[0];
    expect(fn).toContain("if v_order.payment_status <> 'pending' then");
    expect(fn).toContain("and cannot be paid");

    // And the hold check is a SEPARATE, later refusal — the two are different
    // reasons, which is exactly what the old comment conflated.
    expect(fn.indexOf("payment_status <> 'pending'")).toBeLessThan(
      fn.indexOf("the hold on order"),
    );
  });
});

describe("an order that can never be paid again is let go", () => {
  it("names the three statuses where nothing was charged", () => {
    for (const status of ["expired", "failed", "cancelled"]) {
      expect(isAbandoned(status, false), status).toBe(true);
    }
  });

  it("keeps everything where money is involved", () => {
    for (const status of ["paid", "refunded", "partially_refunded"]) {
      expect(isAbandoned(status, false), status).toBe(false);
    }
  });

  it("keeps an order that is still payable", () => {
    expect(isAbandoned("pending", false)).toBe(false);
  });

  /**
   * A flagged order is one where money may already be with us and a person is
   * looking at it. It stays visible whatever its status says — letting go of
   * it would hide a problem from the only person who noticed it.
   */
  it("never lets go of a flagged order", () => {
    for (const status of ["expired", "failed", "cancelled", "pending", "paid"]) {
      expect(isAbandoned(status, true), status).toBe(false);
    }
  });

  it("does not invent a status it has never seen", () => {
    for (const status of ["", "EXPIRED", "stale", "unknown"]) {
      expect(isAbandoned(status, false), status).toBe(false);
    }
  });

  it("agrees with the button: nothing to let go of still has no button", () => {
    for (const status of ["expired", "failed", "cancelled"]) {
      expect(ctaFor(status, 1, false), status).toBe("none");
    }
  });

  it("reads straight through from a database row", () => {
    const view = readPaymentState({
      order_number: "SI-2026-001063",
      payment_status: "expired",
      needs_resolution: false,
      total_amount: "19.31",
      attempts: 1,
    });
    expect(view).not.toBeNull();
    expect(view!.cta).toBe("none");
    expect(isAbandoned(view!.paymentStatus, view!.needsResolution)).toBe(true);
  });
});

describe("the checkout page acts on it", () => {
  it("does not resume an order it has let go of", () => {
    const effect = VIEW.slice(VIEW.indexOf("const open = recallOpenOrder("));
    const guard = effect.indexOf("isAbandoned(state.paymentStatus, state.needsResolution)");
    const resume = effect.indexOf("setPlaced({");
    expect(guard).toBeGreaterThan(-1);
    // Before the resume, or it would not prevent anything.
    expect(guard).toBeLessThan(resume);
    // And it drops both notes, not just one.
    const block = effect.slice(guard, resume);
    expect(block).toContain("forgetOpenOrder(principal)");
    expect(block).toContain("forgetPaymentToken(principal, open.orderNumber)");
  });

  /**
   * The sweeper turns a lapsed order into `expired` within five minutes
   * (pg_cron, every five minutes). Until it runs the order still reads
   * `pending`, so
   * the guard above would resume it. This closes that window from the other
   * side: the database has just said 409, which is the same fact arriving
   * earlier.
   */
  it("lets go the moment the database refuses the payment", () => {
    const fn = VIEW.slice(VIEW.indexOf("async function toPayment("));
    const body = fn.slice(0, fn.indexOf("\n  }"));
    expect(body).toContain('outcome.reason === "not_payable"');
    expect(body).toContain("forgetOpenOrder(principal)");
    expect(body).toContain("setPlaced(null)");
  });

  it("carries the reason back to the form instead of dropping it", () => {
    // The error is rendered above the form too, not only inside the panel.
    const form = VIEW.slice(VIEW.indexOf("  return (\n    <form"));
    expect(form).toContain("{paymentError ? (");
    expect(form).toContain('role="alert"');
  });

  /**
   * NOTHING IS WRITTEN AND NOTHING IS DELETED. The fix is entirely about what
   * this browser remembers; the order, its attempts and its reservations stay
   * exactly as the database left them.
   */
  it("writes nothing to the order to achieve any of it", () => {
    const effect = VIEW.slice(
      VIEW.indexOf("const open = recallOpenOrder("),
      VIEW.indexOf("const entries = resolveCart("),
    );
    expect(effect).not.toContain('.from("orders")');
    expect(effect).not.toContain("release_order_reservations");
    expect(effect).not.toContain("expire_stale_checkouts");
  });
});
