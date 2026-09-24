import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { ctaFor, isAbandoned, readPaymentState, resumeAction } from "./open-order";

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
    // Seit dem Paid-Bug entscheidet `resumeAction()` beide Faelle: die drei
    // Status ohne Zahlung und eine abgeschlossene Bestellung, nach der
    // niemand gefragt hat.
    const guard = effect.indexOf("resumeAction(");
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

/* ===================================================================== */
/**
 * EINE BEZAHLTE BESTELLUNG DARF DEN NÄCHSTEN EINKAUF NICHT BLOCKIEREN.
 *
 * Beobachtet auf Staging: `SI-2026-001066` war `paid` und `unfulfilled`. Ein
 * neuer Warenkorb, ein erneuter Klick auf „Zur Kasse" — und statt eines neuen
 * Checkouts erschien wieder die alte Bestellung mit „Für diese Bestellung ist
 * nichts mehr zu tun". Solange der Betreiber nicht versendet hatte, war kein
 * zweiter Einkauf möglich.
 *
 * Ursache: `isAbandoned()` war der einzige Weg, die Notiz im `sessionStorage`
 * loszuwerden, und es kennt nur die drei Status ohne Zahlung. `paid` fiel in
 * `SETTLED` — kein Knopf, aber die Notiz blieb, und das Panel ersetzt das
 * Formular.
 *
 * Die Unterscheidung ist nicht der Status, sondern WIE die Bestellung erreicht
 * wurde: benannt in der Adresse, oder nur in diesem Tab erinnert.
 */
describe("a settled order does not occupy the checkout", () => {
  it("is let go of when nobody asked for it", () => {
    for (const status of ["paid", "refunded", "partially_refunded"]) {
      // `undefined` ist genau das, was `/checkout` ohne `?order=` durchreicht.
      expect(resumeAction(status, false, undefined), status).toBe("forget");
    }
  });

  it("is still shown to somebody who asked for it by name", () => {
    // `/checkout?order=…` — die Adresse, an die Stripe eine abgebrochene
    // Zahlung zurückschickt, und die jemand nach der Zahlung aufrufen kann.
    for (const status of ["paid", "refunded", "partially_refunded"]) {
      expect(resumeAction(status, false, "SI-2026-001066"), status).toBe("resume");
    }
  });

  it("keeps an unfinished checkout, addressed or not", () => {
    expect(resumeAction("pending", false, undefined)).toBe("resume");
    expect(resumeAction("pending", false, "SI-2026-001066")).toBe("resume");
  });

  it("still lets go of the three statuses where nothing was charged", () => {
    for (const status of ["expired", "failed", "cancelled"]) {
      // Auch wenn danach gefragt wurde: es gibt dort nichts zu tun.
      expect(resumeAction(status, false, undefined), status).toBe("forget");
      expect(resumeAction(status, false, "SI-2026-001066"), status).toBe("forget");
    }
  });

  it("never lets go of a flagged order", () => {
    for (const status of ["pending", "paid", "expired", "failed", "cancelled"]) {
      expect(resumeAction(status, true, undefined), status).toBe("resume");
      expect(resumeAction(status, true, "SI-2026-001066"), status).toBe("resume");
    }
  });

  it("does not change what the button says", () => {
    // `cta` ist eine andere Frage und bleibt, wie sie war: bei Geld kein Knopf.
    expect(ctaFor("paid", 0, false)).toBe("none");
    expect(ctaFor("pending", 0, false)).toBe("start");
    expect(ctaFor("pending", 2, false)).toBe("retry");
  });

  it("and `isAbandoned` keeps its own meaning", () => {
    // „Nichts wurde belastet und nichts ist mehr möglich" — davon ist eine
    // bezahlte Bestellung weiterhin nicht betroffen.
    expect(isAbandoned("paid", false)).toBe(false);
    expect(isAbandoned("expired", false)).toBe(true);
  });

  /**
   * DER FEHLER IM ERSTEN FIX, ALS LAUFENDER TEST.
   *
   * `resumeAction()` bekam anfangs ein fertiges `addressed: boolean`, und der
   * Aufrufer bildete es mit `resumeOrderNumber !== ""`. `/checkout` ohne
   * Query reicht aber `undefined` durch — `undefined !== ""` ist `true`, also
   * galt jede bezahlte Bestellung als „benannt" und blieb stehen. Der alte
   * Test prüfte nur, dass dieser Ausdruck im Quelltext steht, und hat den
   * Fehler damit festgeschrieben statt ihn zu fangen.
   *
   * Seither nimmt die Funktion den Wert selbst. Diese Fälle sind die, die im
   * Browser tatsächlich ankommen.
   */
  it("lets go of a paid order for every address that names nothing", () => {
    for (const nothing of [undefined, null, "", "   "]) {
      expect(resumeAction("paid", false, nothing), String(nothing)).toBe("forget");
    }
  });

  it("the page hands over the order number itself, not a verdict about it", () => {
    // Der Wert wird durchgereicht; die Ableitung steht in `resumeAction()`.
    expect(VIEW).toContain(
      "state.paymentStatus, state.needsResolution, resumeOrderNumber)",
    );
    // Und niemand baut sich hier wieder selbst einen Wahrheitswert.
    expect(VIEW).not.toContain('resumeOrderNumber !== ""');
    expect(VIEW).not.toContain("Boolean(resumeOrderNumber)");
  });

  it("writes nothing while letting go", () => {
    const effect = VIEW.slice(VIEW.indexOf("const open = recallOpenOrder("));
    // Und nichts wird geschrieben oder gelöscht — nur die Notiz fällt weg.
    const block = effect.slice(effect.indexOf("resumeAction("), effect.indexOf("setPlaced({"));
    expect(block).toContain("forgetOpenOrder(principal)");
    expect(block).not.toContain("supabase");
    expect(block).not.toContain("rpc(");
  });
});
