/**
 * DER ERSTATTUNGSVERTRAG (0111, ADR-0118).
 *
 * Diese Datei existiert wegen eines echten Vorfalls. Bei SI-2026-001009 wurde
 * eine Position über 0,76 € storniert, acht Sekunden später „Erstattung
 * bestätigt" geklickt — und bei Stripe ist nie etwas erstattet worden. Die
 * Bestellung sagte trotzdem „teilweise erstattet", die Kundenansicht zeigte
 * „−0,76 €", und der Nachrichtenkanal „Rückerstattung abgeschlossen".
 *
 * Kein Programmierfehler: eine Lücke im Vertrag. Es gab einen Zustand für zwei
 * Tatsachen — „jemand hat es eingetragen" und „der Zahlungsdienst hat
 * gezahlt".
 *
 * Geprüft wird in drei Formen, und das ist Absicht:
 *
 *   VERHALTEN    die reinen Funktionen von `refund.ts`, `refund-state.ts` und
 *                die Webhook-Entscheidung. Echte Aufrufe, echte Ergebnisse.
 *   VERTRAG      der Text der Migration. Eine Zusicherung, die in SQL steht,
 *                ist von hier aus nur dort nachlesbar — und nachbauen wäre
 *                eine zweite Wahrheit.
 *   VERDRAHTUNG  wer wen ruft, und in welcher Reihenfolge. Die Reihenfolge IST
 *                hier die Sicherheit: Anspruch vor Netz, Abgleich vor POST,
 *                Mail nach Bestätigung.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { migrationSource } from "@/test-support/migrations";
import { de } from "@/lib/i18n/de";
import {
  bookedRefundTotal, providerStatus, refundAction, refundIsVisibleToCustomer,
  settledRefundTotal, unsettledRefundTotal, PROVIDER_REFUND_STATES,
} from "./refund-state";
import { orderMoney } from "./order-money";
import {
  classifyRefundFailure, headroomCents, matchOwnRefund, parseRefundRequest,
  refundForm, refundKeyMode, refundedCents, selectRefundKey, statusForOutcome,
  type StripeRefund,
} from "../../../supabase/functions/refund-payment/refund.ts";
import {
  asRefund, decide, refundStatusMeaning,
  type StripeEventShape,
} from "../../../supabase/functions/stripe-webhook/event.ts";

const SQL = migrationSource("0111_stripe_refund_contract.sql");
const FUNCTION = readFileSync("supabase/functions/refund-payment/index.ts", "utf8");
const ACTION = readFileSync("src/lib/admin/refund-actions.ts", "utf8");
const LIST = readFileSync("src/components/admin/refund-list.tsx", "utf8");
const CONFIG = readFileSync("supabase/config.toml", "utf8");

/** Ausführbares SQL: ohne Zeilenkommentare, Stringliterale geleert. */
const exec = SQL
  .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Dasselbe ohne Stringliterale.
 *
 * Für die „fasst X nicht an"-Zusicherungen: eine `comment on function`-Zeile
 * nennt `sale_fees` und `order_reservations`, weil sie die Lesemodelle
 * beschreibt, die diese Migration unverändert übernimmt. Prosa darf die Idee
 * nennen, Schema darf sie nicht einführen — dieselbe Trennung wie in
 * `platform-seller-schema.test.ts`.
 */
const schema = exec.replace(/'(?:[^']|'')*'/g, "''");

/** Und die Function ohne ihre Kommentare: ihr Kopf nennt den Zahlungsschlüssel. */
const functionCode = FUNCTION
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");

/** Der Rumpf einer SQL-Funktion dieser Migration. */
function fn(name: string): string {
  const at = exec.indexOf(`create or replace function public.${name}(`);
  expect(at, `${name} fehlt`).toBeGreaterThan(-1);
  const open = exec.indexOf("as $$", at);
  return exec.slice(open, exec.indexOf("$$;", open));
}

const refund = (over: Partial<StripeRefund> = {}): StripeRefund =>
  ({ id: "re_1", amount: 76, status: "succeeded", ...over });

// ---------------------------------------------------------------------------
// 1. Ein erfolgreicher Provider-Refund
// ---------------------------------------------------------------------------

describe("1. ein erfolgreicher Erstattungsaufruf", () => {
  it("trägt Betrag, Zahlung und unsere eigene Kennung", () => {
    const form = refundForm({
      intentId: "pi_live_x", amountCents: 76,
      refundId: 1, orderId: 7, orderNumber: "SI-2026-001009",
    });
    expect(form.get("payment_intent")).toBe("pi_live_x");
    expect(form.get("amount")).toBe("76");
    /*
     * DIE METADATEN SIND DIE ZUORDNUNG. Ohne sie müsste ein Webhook über
     * Betrag und Zeit raten, welche Buchung gemeint ist — und bei zwei
     * Erstattungen gleicher Höhe wäre jede Antwort eine Wahrscheinlichkeit.
     */
    expect(form.get("metadata[order_refund_id]")).toBe("1");
    expect(form.get("metadata[order_number]")).toBe("SI-2026-001009");
    // `reason` bleibt bewusst leer: ein falsches Wort hat Folgen für Streitfälle.
    expect(form.get("reason")).toBeNull();
  });

  it("der Betrag in Cent kommt aus SQL, nicht aus JavaScript", () => {
    /*
     * `0.76 * 100` ist in JavaScript 76.00000000000001. `numeric(10,2)` auf
     * Cent zu bringen ist in SQL exakt — deshalb rechnet es die Datenbank.
     */
    expect(0.07 * 100).not.toBe(7);
    expect(fn("order_refund_submission")).toContain("(round(v_refund.amount * 100))::bigint");
    expect(FUNCTION).toContain("const amountCents = Number(claim.amount_cents);");
    expect(FUNCTION).not.toMatch(/amount\s*\*\s*100/);
  });

  it("und danach steht der Beweis an der Buchung", () => {
    expect(FUNCTION).toContain('p_confirmed_by: "api",');
    expect(fn("attach_order_refund")).toContain("provider_status       = 'succeeded'");
    expect(fn("attach_order_refund")).toContain("settled_at            = coalesce(settled_at, now())");
  });
});

// ---------------------------------------------------------------------------
// 2. Ein Stripe-Fehler wird nie als Erfolg dargestellt
// ---------------------------------------------------------------------------

describe("2. ein Fehler des Zahlungsdienstes", () => {
  it("eine ausdrückliche Ablehnung ist ein Nein", () => {
    const failure = classifyRefundFailure(400, { error: { code: "charge_already_refunded" } });
    expect(failure).toEqual({ code: "charge_already_refunded", unresolved: false });
  });

  it("ein Netzwerkabbruch ist KEIN Nein", () => {
    /*
     * Die wichtigste Unterscheidung des ganzen Vertrags. Wer eine verlorene
     * Antwort als „fehlgeschlagen" verbucht, lädt zu einem zweiten Versuch
     * ein — und wenn der erste doch durchkam, ist das Geld zweimal unterwegs.
     */
    expect(classifyRefundFailure(null, null).unresolved).toBe(true);
    expect(classifyRefundFailure(500, null).unresolved).toBe(true);
    expect(classifyRefundFailure(503, null).unresolved).toBe(true);
    expect(classifyRefundFailure(429, null).unresolved).toBe(true);
    // Und ein Schlüsselkonflikt ist unser Fehler, kein Nein von Stripe.
    expect(classifyRefundFailure(400, { error: { code: "idempotency_error" } }))
      .toEqual({ code: "idempotency_conflict", unresolved: true });
  });

  it("die Antwort nach außen trägt den Unterschied", () => {
    expect(statusForOutcome({ kind: "settled", providerRefundId: "re_1", replayed: false })).toBe(200);
    expect(statusForOutcome({ kind: "failed", code: "x" })).toBe(422);
    // 503: bitte später fortsetzen — nicht „erledigt" und nicht „gescheitert".
    expect(statusForOutcome({ kind: "unresolved", code: "x" })).toBe(503);
    expect(statusForOutcome({ kind: "refused", reason: "x" })).toBe(409);
  });

  it("eine sofort fehlgeschlagene Erstattung zählt nicht als Erfolg", () => {
    // Stripe kann 200 antworten UND `status: failed` liefern.
    expect(FUNCTION).toContain('if (created.status === "failed" || created.status === "canceled")');
    expect(FUNCTION).toContain('p_code: created.failure_reason ?? `provider_${created.status}`');
  });

  it("und die Datenbank macht `succeeded` ohne Beweis unmöglich", () => {
    expect(exec).toContain("constraint order_refunds_settled_needs_proof");
    expect(exec).toContain("check (provider_status <> 'succeeded'");
    expect(exec).toContain("or (provider_refund_id is not null");
  });
});

// ---------------------------------------------------------------------------
// 3. Retry und Doppelklick erzeugen keinen zweiten Refund
// ---------------------------------------------------------------------------

describe("3. zwei Klicks, eine Erstattung", () => {
  it("der Anspruch wird unter Zeilensperre genommen", () => {
    const claim = fn("submit_order_refund");
    expect(claim).toContain("for update");
    // Vor jeder Entscheidung, nicht danach.
    expect(claim.indexOf("for update")).toBeLessThan(claim.indexOf("provider_status = 'succeeded'"));
    expect(claim).toContain("'already_pending'");
    expect(claim).toContain("'already_settled'");
  });

  it("ein zweiter Klick erreicht den Zahlungsdienst nicht", () => {
    /*
     * `submit_order_refund` gibt `ok: false` zurück, und die Function kehrt
     * damit um — VOR der Schlüsselwahl und vor jedem `fetch`.
     */
    expect(FUNCTION).toContain("if (claim.ok !== true) {");
    expect(FUNCTION.indexOf("if (claim.ok !== true)"))
      .toBeLessThan(FUNCTION.indexOf("const chosen = selectRefundKey"));
    expect(FUNCTION.indexOf("if (claim.ok !== true)"))
      .toBeLessThan(FUNCTION.indexOf("fetch(STRIPE_REFUNDS"));
  });

  it("der Idempotenzschlüssel ist abgeleitet, nicht erzeugt", () => {
    /*
     * Aus der Zeilen-ID und der Versuchsnummer. Nicht aus Zeit, nicht aus
     * Zufall: ein Wiederholungsaufruf DESSELBEN Versuchs muss denselben
     * Schlüssel tragen, damit Stripe seine erste Antwort wiederholt.
     */
    expect(fn("submit_order_refund"))
      .toContain("'skyisles-refund-' || v_refund.id::text");
    expect(fn("submit_order_refund"))
      .toContain("case when v_next = 1 then '' else '-r' || v_next::text end");
    expect(FUNCTION).toContain('"Idempotency-Key": idempotencyKey,');
    expect(FUNCTION).not.toMatch(/Idempotency-Key[^\n]*Date\.now|crypto\.randomUUID/);
  });

  it("und er ist unveränderlich, sobald er endgültig ist", () => {
    const guard = fn("order_refunds_guard_proof");
    expect(guard).toContain("an idempotency key is written once");
    // Genau eine Ausnahme: der Platzhalter, den es nur innerhalb des Buchens gibt.
    expect(guard).toContain("old.idempotency_key like 'pending-%'");
    expect(guard).toContain("new.idempotency_key not like 'pending-%'");
    expect(exec).toContain("create unique index if not exists order_refunds_idempotency_unique");
  });

  it("ein zweiter Klick auf dieselbe Zeile fällt auch in der Oberfläche", () => {
    expect(LIST).toContain("if (busy.has(id)) return;");
    expect(LIST).toContain("setBusy((current) => new Set(current).add(id));");
  });

  it("ein nachträglich gescheiterter Refund wird nicht auf derselben Zeile wiederholt", () => {
    /*
     * Stripe hat angenommen (`re_…` steht an der Zeile), eine Bank hat die
     * Gutschrift Tage später zurückgewiesen. Ein zweiter Versuch darauf wäre
     * eine zweite Erstattung mit einer fremden Kennung daneben. Der richtige
     * Weg ist eine NEUE Buchung.
     */
    expect(fn("submit_order_refund"))
      .toContain("if v_refund.provider_refund_id is not null then");
    expect(fn("submit_order_refund")).toContain("'already_has_provider_refund'");
  });

  it("und eine zweite Provider-Kennung wird nie über eine erste geschrieben", () => {
    const attach = fn("attach_order_refund");
    expect(attach).toContain("'already_attached'");
    expect(attach).toContain("already carries a different provider id");
    expect(exec).toContain("create unique index if not exists order_refunds_provider_refund_unique");
  });
});

// ---------------------------------------------------------------------------
// 4. Ein unklarer Zustand bleibt reconciliierbar
// ---------------------------------------------------------------------------

describe("4. Timeout und unklare Antwort", () => {
  it("die Buchung bleibt offen, nicht fehlgeschlagen", () => {
    /*
     * Im `catch` des POST wird NICHTS verbucht. Das ist der Unterschied
     * zwischen „fortsetzbar" und „bitte noch einmal erstatten".
     */
    const post = FUNCTION.slice(FUNCTION.indexOf("// ---- 5. Erstatten"),
                                FUNCTION.indexOf("// ---- 6. Anheften"));
    const rescue = post.slice(post.indexOf("} catch (error) {"),
                              post.indexOf("if (!created?.id)"));
    expect(rescue).toContain('kind: "unresolved"');
    expect(rescue).not.toContain("fail_order_refund");
    /*
     * Und `fail_order_refund` wird genau zweimal gerufen: bei einer
     * ausdrücklichen Ablehnung des POST und bei einer Erstattung, die Stripe
     * sofort als gescheitert zurückgibt. Nie aus einem `catch`.
     */
    expect((FUNCTION.match(/rpc\("fail_order_refund"/g) ?? [])).toHaveLength(2);
  });

  it("und `pending` ist ein Zustand mit einem Weg heraus", () => {
    const resume = fn("resume_order_refund");
    // Fortsetzen ist eine LESEOPERATION: derselbe Schlüssel, nichts geändert.
    expect(resume).toContain("'not_pending'");
    expect(resume).toContain("public.order_refund_submission(p_refund_id)");
    expect(exec).toMatch(/create or replace function public\.resume_order_refund[\s\S]{0,200}stable/);
    expect(refundAction({ amount: 1, provider_status: "pending" })).toBe("resume");
  });

  it("vor jedem Senden wird beim Zahlungsdienst NACHGESEHEN", () => {
    /*
     * Die Schicht, die auch nach Ablauf des Stripe-Idempotenzschlüssels hält
     * (dokumentiert 24 Stunden). Ohne sie wäre ein Versuch am nächsten Tag
     * eine zweite Erstattung.
     */
    expect(FUNCTION.indexOf("// ---- 4. Abgleich, lesend"))
      .toBeLessThan(FUNCTION.indexOf("// ---- 5. Erstatten"));
    expect(FUNCTION).toContain("payment_intent=${encodeURIComponent(intentId)}");
    expect(FUNCTION).toContain("const mine = matchOwnRefund(existing, refundId);");
    expect(FUNCTION).toContain("replayed: true");
  });

  it("der Abgleich findet die eigene Erstattung über die Metadaten", () => {
    const list = [
      refund({ id: "re_other", metadata: { order_refund_id: "9" } }),
      refund({ id: "re_mine", metadata: { order_refund_id: "1" } }),
    ];
    expect(matchOwnRefund(list, 1)?.id).toBe("re_mine");
    expect(matchOwnRefund(list, 5)).toBeNull();
    /*
     * NICHT über den Betrag: zwei Positionen desselben Preises ergeben zwei
     * gleich hohe Erstattungen, und die darf man nicht verwechseln.
     */
    expect(matchOwnRefund([refund({ id: "re_x", amount: 76 })], 1)).toBeNull();
  });

  it("und ein fremder Refund verbraucht den Spielraum", () => {
    const existing = [refund({ id: "re_dash", amount: 700, metadata: {} })];
    expect(refundedCents(existing)).toBe(700);
    expect(headroomCents(785, existing)).toBe(85);
    // Mehr als der Spielraum wird nicht gesendet.
    expect(FUNCTION).toContain("if (refundedCents(existing) + amountCents > paidCents)");
    expect(FUNCTION).toContain('reason: "provider_already_refunded"');
  });

  it("gescheiterte Erstattungen zählen beim Spielraum nicht mit", () => {
    const list = [refund({ amount: 100, status: "failed" }),
                  refund({ amount: 100, status: "canceled" }),
                  refund({ amount: 76, status: "pending" })];
    // `pending` zählt: eine angestoßene Erstattung ist unterwegs.
    expect(refundedCents(list)).toBe(76);
  });
});

// ---------------------------------------------------------------------------
// 5. Der Webhook ist idempotent
// ---------------------------------------------------------------------------

describe("5. ein mehrfach gelieferter Webhook", () => {
  const event = (type: string, object: unknown): StripeEventShape =>
    ({ id: "evt_1", type, livemode: false, data: { object } } as StripeEventShape);

  it("entprellt über denselben Index wie jedes Zahlungsereignis", () => {
    const record = fn("record_refund_event");
    expect(record).toContain("on conflict (provider, provider_event_id) do nothing");
    expect(record).toContain("'duplicate_event'");
  });

  it("und eine zweite Lieferung ändert nichts", () => {
    const record = fn("record_refund_event");
    expect(record).toContain("'already_settled'");
    expect(record).toContain("'already_failed'");
  });

  it("jede Erstattung einer Lieferung bekommt ihre eigene Kennung", () => {
    /*
     * `charge.refunded` trägt ALLE Erstattungen des Charges. Ohne den Zusatz
     * würde die zweite Teilerstattung als Duplikat der ersten verworfen.
     */
    const webhook = readFileSync("supabase/functions/stripe-webhook/index.ts", "utf8");
    expect(webhook).toContain("p_provider_event_id: `${decision.eventId}:${refund.id}`");
  });

  it("liest das Erstattungsobjekt eines `refund.*`-Ereignisses", () => {
    /*
     * DER ROBUSTE VERTRAG (ADR-0119). Beide Ereignisse tragen die Erstattung
     * SELBST — Kennung, Zustand, Betrag, Zahlung, Metadaten. Nichts daran
     * hängt an einer eingebetteten Unterliste, die eine API-Version mitliefert
     * oder eben nicht.
     */
    const object = {
      object: "refund", id: "re_a", amount: 404, status: "succeeded",
      payment_intent: "pi_1", metadata: { order_refund_id: "1" },
    };
    const decision = decide(event("refund.created", object), false);
    expect(decision.action).toBe("refunds");
    if (decision.action !== "refunds") throw new Error("unerwartet");
    expect(decision.refunds).toHaveLength(1);
    expect(decision.refunds[0]).toEqual({
      id: "re_a", amountCents: 404, status: "succeeded",
      paymentRef: "pi_1", failureReason: null, ownRefundId: 1,
    });
    // Und dasselbe Objekt unter `refund.updated`, damit eine spätere
    // Zurückweisung denselben Weg nimmt.
    expect(decide(event("refund.updated", { ...object, status: "failed",
                                            failure_reason: "declined" }), false).action)
      .toBe("refunds");
  });

  it("`charge.refunded` wird bewusst nicht mehr behandelt", () => {
    /*
     * Es trug die einzelnen Erstattungen nur, solange Stripe `refunds` in das
     * Charge-Objekt einbettete. Ohne die Liste gibt es keine `re_…` und damit
     * keinen Beweis zum Anheften; über den Betrag zuzuordnen wäre Raten, und
     * nachfragen kann diese Function nicht — sie hält keinen API-Schlüssel.
     */
    const charge = { object: "charge", id: "ch_1", payment_intent: "pi_1",
                     amount_refunded: 404 };
    expect(decide(event("charge.refunded", charge), false))
      .toEqual({ action: "ignore", reason: "not_a_handled_type" });
    const source = readFileSync("supabase/functions/stripe-webhook/event.ts", "utf8");
    expect(source).not.toContain("refundsOfCharge");
    // Und der Webhook hat weiterhin keinen Weg, bei Stripe nachzufragen.
    const webhook = readFileSync("supabase/functions/stripe-webhook/index.ts", "utf8");
    for (const forbidden of ["api.stripe.com", "STRIPE_SECRET", "STRIPE_REFUND_KEY"]) {
      expect(webhook, forbidden).not.toContain(forbidden);
    }
  });

  it("übersetzt die Zustände des Zahlungsdienstes vorsichtig", () => {
    expect(refundStatusMeaning("succeeded")).toBe("succeeded");
    expect(refundStatusMeaning("failed")).toBe("failed");
    expect(refundStatusMeaning("canceled")).toBe("failed");
    // Ein Zwischenstand ist weder Geld noch Nein.
    expect(refundStatusMeaning("pending")).toBe("pending");
    expect(refundStatusMeaning("requires_action")).toBe("pending");
    expect(refundStatusMeaning(null)).toBe("pending");
  });

  it("nimmt eine im Dashboard erzeugte Erstattung ohne Metadaten an", () => {
    const parsed = asRefund({ object: "refund", id: "re_dash", amount: 76,
                              status: "succeeded", charge: "ch_9" });
    expect(parsed?.ownRefundId).toBeNull();
    expect(parsed?.paymentRef).toBe("ch_9");
    // Und ordnet sie über Zahlung plus gleichen offenen Betrag zu.
    const record = fn("record_refund_event");
    expect(record).toContain("a.provider_intent_id = v_ref or a.provider_payment_id = v_ref");
    expect(record).toContain("(round(r.amount * 100))::bigint = p_amount_cents");
    // Lässt sich nichts zuordnen, ist das ein Befund und kein Nichts.
    expect(record).toContain("'unmatched_refund'");
  });

  it("und eine später zurückgewiesene Erstattung nimmt die Bestätigung zurück", () => {
    const fail = fn("fail_order_refund");
    expect(fail).toContain("provider_status = 'failed'");
    expect(fail).toContain("settled_at      = null");
    // Die Kennung bleibt: die hat es gegeben, das Geld nicht.
    expect(fail).not.toContain("provider_refund_id = null");
    expect(fn("order_refunds_guard_proof"))
      .toContain("old.provider_status = 'succeeded' and new.provider_status not in ('succeeded', 'failed')");
  });
});

// ---------------------------------------------------------------------------
// 6. Die Refund-ID wird gespeichert
// ---------------------------------------------------------------------------

describe("6. der Beweis wird festgehalten", () => {
  it("einmalig, einmal geschrieben, nie überschrieben", () => {
    expect(exec).toContain("create unique index if not exists order_refunds_provider_refund_unique");
    expect(fn("order_refunds_guard_proof")).toContain("a provider refund id is written once");
  });

  it("zusammen mit der Zahlung, gegen die erstattet wurde", () => {
    expect(fn("attach_order_refund")).toContain("provider_payment_ref  = coalesce(");
    expect(FUNCTION).toContain("p_payment_ref: ref,");
  });

  it("und die Betreibersicht zeigt sie", () => {
    expect(LIST).toContain("{refund.provider_refund_id}");
    expect(de.business.withdrawals.providerRefundLabel).toBe("Stripe:");
  });

  it("die Lücke von 0101 wird dabei nachgetragen", () => {
    /*
     * Bestellungen von vor `0101` tragen keine PaymentIntent-Kennung —
     * SI-2026-001009 ist eine davon. Die Function liest sie aus der
     * Checkout-Session und trägt sie nach, idempotent.
     */
    expect(FUNCTION).toContain('await rpc("attach_payment_intent"');
    expect(FUNCTION).toContain("if (intentId === null) {");
    expect(FUNCTION).toContain("STRIPE_SESSIONS}/${sessionId}");
  });
});

// ---------------------------------------------------------------------------
// 7./8. Teilerstattung und vollständige Erstattung
// ---------------------------------------------------------------------------

describe("7./8. Teil und Ganzes", () => {
  it("der Status wird gespiegelt, nicht gesetzt", () => {
    const mirror = fn("refresh_order_payment_status");
    expect(mirror).toContain("when v_settled <= 0 then 'paid'");
    expect(mirror).toContain("when v_settled >= v_order.total_amount then 'refunded'");
    expect(mirror).toContain("else 'partially_refunded'");
    // Nur aus BESTÄTIGTEN Erstattungen.
    expect(mirror).toContain("public.order_refunded_total(p_order_id)");
  });

  it("und nur ein bezahlter Zustand wird überhaupt angefasst", () => {
    const mirror = fn("refresh_order_payment_status");
    expect(mirror).toContain("not in ('paid', 'partially_refunded', 'refunded')");
    // Eine Erstattung belebt keine abgebrochene oder gescheiterte Zahlung.
    expect(mirror).toContain("return v_order.payment_status;");
  });

  it("die Obergrenze zählt Gebuchtes, die Anzeige Bestätigtes", () => {
    /*
     * Zwei Summen, und der Unterschied ist nötig: zweimal den ganzen Betrag zu
     * BUCHEN muss unmöglich bleiben, auch solange keine der Buchungen
     * ausgelöst ist — während die Anzeige nur Geld kennen darf.
     */
    expect(fn("seller_record_refund")).toContain("public.order_refunds_booked_total(v_order.id)");
    expect(fn("seller_record_refund")).toContain("if v_so_far + p_amount > v_paid then");
    expect(fn("submit_order_refund")).toContain("public.order_refunded_total(v_refund.order_id) + v_refund.amount");
    expect(fn("submit_order_refund")).toContain("'exceeds_payment'");
  });

  it("und die beiden Summen rechnen, was sie versprechen", () => {
    const rows = [
      { amount: 0.76, provider_status: "succeeded" },
      { amount: 1.5, provider_status: "none" },
      { amount: 0.5, provider_status: "pending" },
      { amount: 2, provider_status: "failed" },
    ];
    expect(settledRefundTotal(rows)).toBe(0.76);
    expect(bookedRefundTotal(rows)).toBe(4.76);
    expect(unsettledRefundTotal(rows)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 9. Kundenstatus, Kundenansicht und Mail erst nach Bestätigung
// ---------------------------------------------------------------------------

describe("9. nach außen erst, wenn Geld geflossen ist", () => {
  it("die Kundenansicht zählt nur bestätigte Erstattungen", () => {
    const view = fn("my_order");
    expect(view).toContain("'refunded_total',  public.order_refunded_total(v_order.id)");
    expect(view).toContain("'remaining_total', v_order.total_amount - public.order_refunded_total(v_order.id)");
    // Auch der Anteil einer einzelnen Position.
    expect(view).toContain("and r.provider_status = 'succeeded'");
    // Und keine Summe über alles mehr.
    expect(view).not.toMatch(/select sum\(r\.amount\) from public\.order_refunds r where r\.order_id = v_order\.id/);
  });

  it("die Nachrichtenzeile entsteht erst bei Bestätigung", () => {
    /*
     * `order_conversation()` (0098) und die Aufmerksamkeitszähler (0099) lesen
     * `refund_recorded`. Die BUCHUNG schreibt deshalb `refund_booked` — und
     * beide Funktionen bleiben unverändert, der Satz wird bloß wahr.
     */
    expect(fn("seller_record_refund"))
      .toContain("case when v_status = 'succeeded' then 'refund_recorded' else 'refund_booked' end");
    expect(fn("attach_order_refund")).toContain("'refund_recorded', 'provider'");
    expect(de.messages.events.refund_recorded("0,76 €"))
      .toBe("Rückerstattung über 0,76 € abgeschlossen.");
  });

  it("die Mail hängt an der Bestätigung, nicht an der Buchung", () => {
    // Sie sagt „Wir haben deine Erstattung angewiesen" — die schwerste Folge
    // des Vorfalls, weil es eine Zusage nach außen ist.
    expect(ACTION).toContain("async function announce(");
    expect(ACTION).toContain('kind: "refund_confirmation"');
    const create = ACTION.slice(ACTION.indexOf("export async function recordRefund"));
    expect(create.indexOf('if (outcome.kind !== "settled")'))
      .toBeLessThan(create.indexOf("await announce("));
  });

  it("und eine gebuchte Erstattung ist für die Kundschaft unsichtbar", () => {
    expect(refundIsVisibleToCustomer({ amount: 1, provider_status: "succeeded" })).toBe(true);
    for (const state of ["none", "pending", "failed"]) {
      expect(refundIsVisibleToCustomer({ amount: 1, provider_status: state }), state).toBe(false);
    }
    // Ein fehlender Zustand gilt als NICHT erstattet — die vorsichtige Richtung.
    expect(providerStatus({ amount: 1 })).toBe("none");
    expect(providerStatus({ amount: 1, provider_status: "nonsense" })).toBe("none");
    expect(refundIsVisibleToCustomer({ amount: 1 })).toBe(false);
  });

  it("auch die Geldaufstellung des Betriebs zählt nur bestätigtes Geld", () => {
    const booked = orderMoney({
      itemsSubtotal: 2.36, shippingAmount: 5.49, discountAmount: 0,
      refunds: [{ amount: 0.76, provider_status: "none" }], costs: [],
    });
    expect(booked.refunded).toBe(0);
    expect(booked.remaining).toBe(7.85);
  });

  it("vier Zustände, jeder mit Namen und Satz", () => {
    expect([...PROVIDER_REFUND_STATES]).toEqual(["none", "pending", "succeeded", "failed"]);
    for (const state of PROVIDER_REFUND_STATES) {
      expect(de.business.withdrawals.providerStates[state], state).toBeTruthy();
      expect(de.business.withdrawals.providerStateHints[state], state).toBeTruthy();
    }
    /*
     * Keiner der drei Sätze für einen Nicht-Geldfluss behauptet einen — und
     * jeder sagt ausdrücklich, dass die BUCHUNG bestehen bleibt. Das ist der
     * Satz, der eine zweite Buchung verhindert.
     */
    for (const text of [de.business.withdrawals.providerUnresolved,
                        de.business.withdrawals.providerRefused("x"),
                        de.business.withdrawals.providerRefusedToTry("x")]) {
      expect(text).toMatch(/Buchung/);
      expect(text).not.toMatch(/angewiesen|abgeschlossen/);
    }
  });
});

// ---------------------------------------------------------------------------
// 10. Das Orderbuch bleibt unberührt
// ---------------------------------------------------------------------------

describe("10. externe Verkäufe bleiben reine Buchhaltung", () => {
  it("0111 fasst `sale_refunds` nicht an", () => {
    /*
     * eBay erstattet außerhalb von SkyIsles — dort IST die Buchung die
     * Wahrheit, und es gibt keinen Provider, den man fragen könnte.
     */
    for (const forbidden of ["sale_refunds", "seller_add_sale_refund",
                             "seller_update_sale_refund", "seller_remove_sale_refund",
                             "sale_items", "sale_fees"]) {
      expect(schema, forbidden).not.toContain(forbidden);
    }
  });

  it("und die Erstattungsfunction kennt das Orderbuch nicht", () => {
    for (const forbidden of ["sale_refunds", "seller_add_sale_refund", "sale_id"]) {
      expect(FUNCTION, forbidden).not.toContain(forbidden);
    }
  });

  it("der Orderbuch-Pfad führt weiter über seine eigene Action", () => {
    const sales = readFileSync("src/lib/orderbook/sales-actions.ts", "utf8");
    expect(sales).toContain('supabase.rpc("seller_add_sale_refund"');
    expect(sales).not.toContain("refund-payment");
    expect(sales).not.toContain("provider_status");
  });
});

// ---------------------------------------------------------------------------
// 11. Bestand und Stornierung bleiben unberührt
// ---------------------------------------------------------------------------

describe("11. kein Bestand, keine Stornierung", () => {
  it("0111 fasst Lager, Reservierungen und Positionszustände nicht an", () => {
    for (const forbidden of ["shop_inventory", "inventory_movements",
                             "record_inventory_movement", "apply_inventory_movement",
                             "seller_cancel_order_line", "seller_receive_order_return"]) {
      expect(schema, forbidden).not.toContain(forbidden);
    }
    /*
     * `order_reservations` und `order_line_events` stehen hier NICHT auf der
     * Liste, und das ist kein Zugeständnis: `admin_order()` wird in dieser
     * Migration unverändert mit `create or replace` neu ausgegeben, und es
     * LIEST beide seit 0095/0096 — ob eine Position ausgebucht wurde, und ihre
     * Ereignisse. Gelesen, nirgends geschrieben. Das wird stattdessen geprüft.
     */
    for (const write of ["insert into public.order_reservations",
                         "update public.order_reservations",
                         "delete from public.order_reservations",
                         "insert into public.order_line_events",
                         "update public.order_line_events",
                         "insert into public.inventory_movements"]) {
      expect(schema, write).not.toContain(write);
    }
  });

  it("die Erstattungsfunction ebenso", () => {
    for (const forbidden of ["shop_inventory", "inventory_movements", "order_reservations",
                             "seller_cancel_order_line"]) {
      expect(FUNCTION, forbidden).not.toContain(forbidden);
    }
  });

  it("und `seller_record_refund` behält seine Signatur", () => {
    /*
     * Byteweise die aus 0095 — damit ist es dieselbe Funktion mit demselben
     * EXECUTE, und `create or replace` erhält Eigentümer und ACL. Ein neuer
     * Parameter wäre eine neue Überladung, und die alte bliebe daneben
     * stehen.
     */
    expect(exec).toContain(`create or replace function public.seller_record_refund(
  p_order_number text,
  p_amount       numeric,
  p_reason       text default null,
  p_withdrawal_id bigint default null,
  p_provider_refund_id text default null,`);
    expect(exec).not.toMatch(/grant execute on function public\.seller_record_refund/);
  });
});

// ---------------------------------------------------------------------------
// Der Schlüssel, die Welt und die Grenzen der Function
// ---------------------------------------------------------------------------

describe("der Schlüssel, die Endpunktliste und die Welt der Bestellung", () => {
  it("benutzt dieselben Stripe-Secrets wie die Zahlung — und keine neuen", () => {
    /*
     * Entschieden gegen ein eigenes Restricted-Key-Paar: es gibt genau einen
     * Sandbox- und genau einen Live-Aufbau, und ein zweites Paar hätte eine
     * zweite Rotation, eine zweite Ablaufstelle und eine zweite Art gebracht,
     * eine Erstattung an fehlender Konfiguration scheitern zu lassen.
     */
    expect(FUNCTION).toContain('Deno.env.get("STRIPE_SECRET_KEY_LIVE")');
    expect(FUNCTION).toContain('Deno.env.get("STRIPE_SECRET_KEY_SANDBOX")');
    expect(functionCode).not.toContain("STRIPE_REFUND_KEY");
  });

  it("und erreicht trotzdem nur die drei Endpunkte ihres Vertrags", () => {
    /*
     * DIE ZUSICHERUNG, DIE AN DIE STELLE DES ENGEREN SCHLÜSSELS TRITT.
     *
     * Der Schlüssel darf bei Stripe mehr, als diese Function tun soll — also
     * ist die Liste der erreichbaren Endpunkte selbst die Grenze. Ein vierter
     * fällt hier auf, bevor er deployt wird.
     */
    const urls = [...functionCode.matchAll(/https:\/\/api\.stripe\.com[^"'`\s]*/g)]
      .map((m) => m[0]);
    expect([...new Set(urls)].sort()).toEqual([
      "https://api.stripe.com/v1/checkout/sessions",
      "https://api.stripe.com/v1/refunds",
    ]);
    /*
     * Genau drei Aufrufe gegen Stripe: Session lesen, abgleichen, erstatten.
     * Gezählt am Authorization-Header, nicht an der URL-Form — ein vierter
     * Aufruf müsste ihn tragen, in welcher Schreibweise auch immer.
     */
    expect((functionCode.match(/headers: stripeHeaders/g) ?? []).length).toBe(2);
    expect((functionCode.match(/\.\.\.stripeHeaders/g) ?? []).length).toBe(1);
    // Und genau einer davon schreibt.
    const toStripe = functionCode.slice(functionCode.indexOf("const stripeHeaders ="));
    expect((toStripe.match(/method: "POST"/g) ?? []).length).toBe(1);
    /*
     * Und nichts davon ist eine Zahlung, eine Session-Erzeugung, ein
     * Kundenobjekt oder ein Payout — auch nicht als Pfadfragment.
     */
    for (const forbidden of ["payment_intents", "/charges", "/customers", "/payouts",
                             "/balance", "/transfers", "/prices", "/products",
                             "setup_intents", "/expire"]) {
      expect(functionCode, forbidden).not.toContain(forbidden);
    }
  });

  it("die Zahlung selbst bleibt die einzige Stelle, die Sessions erzeugt", () => {
    // `create-payment` POSTet auf Sessions, `refund-payment` liest nur eine.
    const create = readFileSync("supabase/functions/create-payment/index.ts", "utf8");
    expect(create).toContain('const STRIPE_API = "https://api.stripe.com/v1/checkout/sessions"');
    expect(functionCode).not.toMatch(/fetch\(STRIPE_SESSIONS,\s*\{[\s\S]{0,80}POST/);
    expect(functionCode).toContain("fetch(`${STRIPE_SESSIONS}/${sessionId}`, { headers: stripeHeaders })");
  });

  it("und kein Rückfall zwischen live und sandbox", () => {
    expect(selectRefundKey("live", { live: "sk_live_x", sandbox: "sk_test_y" }))
      .toEqual({ key: "sk_live_x" });
    expect(selectRefundKey("sandbox", { live: "sk_live_x", sandbox: "sk_test_y" }))
      .toEqual({ key: "sk_test_y" });
    // Ein Live-Schlüssel im Sandbox-Fach wäre ein Unfall mit echtem Geld.
    expect(selectRefundKey("sandbox", { sandbox: "sk_live_x" }))
      .toEqual({ problem: "refund_key_is_live_but_mode_is_sandbox" });
    // Staging hält nur den Sandbox-Schlüssel — und verweigert damit Live-Orders.
    expect(selectRefundKey("live", { sandbox: "sk_test_y" }))
      .toEqual({ problem: "missing_refund_key_for_live" });
    expect(selectRefundKey("closed", { live: "sk_live_x" }))
      .toEqual({ problem: "unknown_refund_mode:closed" });
    // Beide Formen bleiben lesbar: ein später eingeschränkter `rk_` passt ohne
    // Codeänderung.
    expect(refundKeyMode("sk_live_x")).toBe("live");
    expect(refundKeyMode("rk_live_x")).toBe("live");
    expect(refundKeyMode("sk_test_x")).toBe("test");
    expect(refundKeyMode("rk_test_x")).toBe("test");
    expect(refundKeyMode("pk_live_x")).toBe("unknown");
  });

  it("die Welt kommt aus der Bestellung, nie aus der Anfrage", () => {
    expect(fn("order_refund_submission")).toContain("'mode',            v_order.commerce_mode");
    expect(fn("submit_order_refund")).toContain("v_order.commerce_mode not in ('live', 'sandbox')");
    expect(FUNCTION).toContain("selectRefundKey(claim.mode,");
  });

  it("die Anfrage nennt eine Erstattungs-ID und sonst nichts", () => {
    /*
     * Der Kern des Sicherheitsmodells: ein manipulierter Aufruf kann keinen
     * Betrag wählen und keine Bestellung nennen.
     */
    expect(parseRefundRequest({ refund_id: 1 })).toEqual({ refundId: 1, action: "submit" });
    expect(parseRefundRequest({ refund_id: "7", action: "resume" }))
      .toEqual({ refundId: 7, action: "resume" });
    expect(parseRefundRequest({ refund_id: 1, amount: 999 }))
      .toEqual({ refundId: 1, action: "submit" });
    expect(parseRefundRequest({ refund_id: 0 })).toBeNull();
    expect(parseRefundRequest({ refund_id: -1 })).toBeNull();
    expect(parseRefundRequest({ refund_id: 1.5 })).toBeNull();
    expect(parseRefundRequest({ refund_id: 1, action: "delete" })).toBeNull();
    expect(parseRefundRequest({})).toBeNull();
    expect(parseRefundRequest(null)).toBeNull();
  });

  it("wer rufen darf, wird in der Function geprüft", () => {
    expect(CONFIG).toContain("[functions.refund-payment]");
    expect(CONFIG).toMatch(/\[functions\.refund-payment\][\s\S]{0,900}verify_jwt = false/);
    expect(FUNCTION).toContain('await rpc("can_operate_seller_for"');
    expect(FUNCTION).toContain('return respond(403, { error: "forbidden" });');
    // Und kein Geheimnis, das im Web-Deployment liegen müsste.
    expect(ACTION).not.toContain("process.env");
  });

  it("und die Berechtigung ist dieselbe Mitgliedschaft wie überall", () => {
    expect(fn("can_operate_seller_for"))
      .toContain("join public.seller_operators o on o.seller_id = s.id");
    expect(fn("can_operate_seller_for")).toContain("s.is_active");
    expect(fn("can_operate_seller_for")).toContain("o.is_enabled");
    expect(exec).toContain("revoke all on function public.can_operate_seller_for(uuid)");
  });

  it("alles Neue ist intern", () => {
    for (const name of ["order_refunded_total(bigint)", "order_refunds_booked_total(bigint)",
                        "refresh_order_payment_status(bigint)", "order_refund_submission(bigint)",
                        "submit_order_refund(bigint)", "resume_order_refund(bigint)",
                        "fail_order_refund(bigint, text)"]) {
      expect(exec, name).toContain(`revoke all on function public.${name}`);
    }
    expect(exec).toContain("revoke all on function public.attach_order_refund(bigint, text, text, text)");
    // Kein `grant` auf irgendetwas davon.
    expect(exec).not.toMatch(/grant execute on function public\.(submit|attach|fail|resume)_order_refund/);
  });
});

// ---------------------------------------------------------------------------
// Der Bestandsfall: order_refunds#1
// ---------------------------------------------------------------------------

describe("die bestehende Buchung wird nicht gelöscht, sondern ausgelöst", () => {
  it("jede Zeile bekommt einen abgeleiteten Schlüssel, auch die alte", () => {
    expect(exec).toContain(`update public.order_refunds
   set idempotency_key = 'skyisles-refund-' || id::text
 where idempotency_key is null;`);
  });

  it("eine Zeile mit fremder Kennung gilt als vom Menschen belegt", () => {
    expect(exec).toContain("provider_confirmed_by = coalesce(provider_confirmed_by, 'operator')");
    expect(exec).toContain("where provider_refund_id is not null");
  });

  it("und eine ohne bleibt `none` — ohne Sonderregel", () => {
    expect(exec).toContain("add column if not exists provider_status       text not null default 'none'");
    // Der einmalige Abgleich spiegelt den Status jeder betroffenen Bestellung.
    expect(exec).toContain("v_after  := public.refresh_order_payment_status(v_order.id);");
    expect(SQL).toContain("SI-2026-001009 geht von");
  });

  it("der Weg heraus ist der normale, nicht ein Reparaturskript", () => {
    expect(refundAction({ amount: 0.76, provider_status: "none" })).toBe("submit");
    expect(refundAction({ amount: 0.76, provider_status: "failed" })).toBe("submit");
    expect(refundAction({ amount: 0.76, provider_status: "succeeded" })).toBeNull();
    expect(ACTION).toContain("export async function submitRefund(");
    expect(ACTION).toContain("export async function resumeRefund(");
    expect(LIST).toContain("await submitRefund(id, orderNumber)");
    expect(de.business.withdrawals.submitRefund).toBe("Beim Zahlungsdienst auslösen");
  });

  it("und es entsteht dabei keine zweite Buchung", () => {
    /*
     * `submitRefund` ruft `seller_record_refund` NICHT. Dieselbe Zeile,
     * derselbe Betrag, dieselbe Aufteilung — ausgelöst wird, was dasteht.
     */
    const submit = ACTION.slice(ACTION.indexOf("async function runProvider("));
    expect(submit).not.toContain("seller_record_refund");
    expect(submit).toContain("askProvider(refundId, action)");
  });
});

// ---------------------------------------------------------------------------
// Die Mail, und wer sie auslösen darf (ADR-0119)
// ---------------------------------------------------------------------------

describe("ein Verkäufer-Operator darf die Mail zu seiner Handlung auslösen", () => {
  const MAIL = readFileSync("supabase/functions/send-order-mail/index.ts", "utf8");
  /** Nur ausführbarer Code: der Kopf dieser Datei erklärt den alten Zustand. */
  const mail = MAIL
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((l) => !l.trimStart().startsWith("//")).join("\n");

  it("DER FEHLER, GEGEN DEN DIESER ABSCHNITT SCHÜTZT", () => {
    /*
     * `refund_confirmation` ging nach einem erfolgreichen Provider-Refund
     * nicht hinaus: `authorise()` verlangte `is_shop_admin_for()`, und ein
     * Verkäufer-Operator ist seit ADR-0077 ausdrücklich KEIN Plattformadmin.
     * `notify()` schluckt den Fehlschlag, also fiel es erst beim ersten echten
     * Erstattungstest auf — auf Staging existierte keine einzige
     * `order_mail`-Zeile der vier betriebsgetriebenen Arten.
     *
     * Die Rolle wird jetzt BEIDES gefragt, in dieser Reihenfolge.
     */
    expect(mail).toContain('admin.rpc("is_shop_admin_for"');
    expect(mail).toContain('"can_operate_seller_for", { p_user_id: data.user.id }');
    expect(mail.indexOf("is_shop_admin_for"))
      .toBeLessThan(mail.indexOf("can_operate_seller_for"));
  });

  it("Plattformadmin bleibt erlaubt — und behält, was nur er darf", () => {
    expect(mail).toContain('if (!roleError && isAdmin === true) return { kind: "admin"');
    /*
     * `force` ist das Einzige, was an einer `unresolved`-Zustellung
     * vorbeikommt. Es bleibt beim Plattformadmin: ein Operator darf eine
     * unklare Zustellung nicht überstimmen.
     */
    expect(mail).toContain('const force = caller.kind === "admin" && body.force === true');
    expect(mail).not.toMatch(/caller\.kind === "operator"[^\n]*force/);
  });

  it("der berechtigte Operator ist erlaubt", () => {
    expect(mail).toContain('return { kind: "operator", userId: data.user.id };');
    expect(mail).toContain('| { kind: "operator"; userId: string }');
  });

  it("und die Berechtigung ist die engere Mitgliedschaft, nicht „angemeldet“", () => {
    /*
     * `can_operate_seller_for()` (0111) verlangt BEIDES: einen
     * freigeschalteten Operator UND einen aktiven Verkäufer — wortgleich mit
     * `can_operate_active_seller()` aus 0041. Ein abgeschalteter Operator,
     * einer eines inaktiven Verkäufers und ein gewöhnliches Konto kommen
     * nicht durch.
     */
    const body = fn("can_operate_seller_for");
    expect(body).toContain("join public.seller_operators o on o.seller_id = s.id");
    expect(body).toContain("s.is_active");
    expect(body).toContain("o.is_enabled");
    expect(body).toContain("o.user_id = p_user_id");
  });

  it("ein gewöhnliches angemeldetes Konto bleibt verboten", () => {
    /*
     * Weder Admin noch Operator: `authorise()` fällt am Ende auf `null`, und
     * `null` ist 401. Die Kundschaft erreicht nur `authoriseParty()` — die
     * zwei Nachrichtenhinweise, und nur für die EIGENE Bestellung.
     */
    const authorise = mail.slice(mail.indexOf("async function authorise("),
                                 mail.indexOf("async function authoriseParty("));
    expect(authorise.trimEnd().endsWith("return null;\n}")).toBe(true);
    expect(mail).toContain('if (!caller) return respond(401, { error: "not_authorised" });');
    // Und der Kundenpfad bleibt auf seine zwei Arten beschränkt.
    expect(mail).toContain('kind === "message_to_customer" || kind === "message_to_seller"');
  });

  it("für eine FREMDE Bestellung bleibt der Kundenpfad gesperrt", () => {
    // `authoriseParty()` prüft die Bestellung gegen das Konto, mit dem
    // Service-Role-Client — nicht mit dem Token des Aufrufers.
    const party = mail.slice(mail.indexOf("async function authoriseParty("));
    expect(party).toContain('.from("orders")');
    expect(party).toContain('.eq("order_number", orderNumber)');
  });

  it("die Verkäufergrenze liegt dort, wo sie liegen kann", () => {
    /*
     * EIN VERKÄUFER, UND DAS IST EINE ENTSCHEIDUNG (ADR-0021, ADR-0064).
     * `orders` trägt kein `seller_id` — es gibt also keine feinere Grenze zu
     * prüfen als „Operator des AKTIVEN Verkäufers", und genau die wird
     * geprüft. `platform-seller-schema.test.ts` hält fest, dass keine
     * Bestelltabelle einen Verkäufer bekommt; der Tag, an dem ein zweiter
     * realer Verkäufer existiert, ist der Tag, an dem diese Stelle mitwachsen
     * muss.
     */
    const commerce = migrationSource("0010_commerce_core.sql")
      .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
    expect(commerce).not.toMatch(/seller_id/i);
    expect(fn("can_operate_seller_for")).toContain("s.is_active");
  });

  it("refund_confirmation ist eine bekannte Mailart und hängt an einer `ref`", () => {
    const mailSql = migrationSource("0100_mail_event_identity.sql");
    expect(mailSql).toContain("'refund_confirmation'");
    // Je Ereignis, nicht je Bestellung: eine zweite Erstattung bekommt ihre
    // eigene Mail statt als Wiederholung der ersten zu gelten.
    expect(ACTION).toContain("notify({ orderNumber, kind: \"refund_confirmation\", ref: refundId })");
  });

  it("und die Idempotenz der Mail bleibt unberührt", () => {
    /*
     * Der Anspruch liegt in `claim_order_mail()` mit dem Schlüssel
     * (Bestellung, Art, ref), und Resend bekommt denselben Wert als
     * Idempotenzschlüssel. Ein wiederholter Aufruf erzeugt deshalb keine
     * zweite Mail — daran hat die Rollenänderung nichts verändert.
     */
    expect(mail).toContain('claim !== "claimed"');
    expect(mail).toContain("idempotencyKey: idempotencyKey(kind, order.order_number, ref)");
    expect(mail).not.toContain("order_mail_reset");
  });

  it("vor der Provider-Bestätigung gibt es weiterhin keine Erstattungsmail", () => {
    // Das Gate liegt in der Server Action, nicht in der Mailfunction: nur ein
    // `settled`-Ausgang ruft `announce()`.
    const create = ACTION.slice(ACTION.indexOf("export async function recordRefund"));
    expect(create.indexOf('if (outcome.kind !== "settled")'))
      .toBeLessThan(create.indexOf("await announce("));
    const provider = ACTION.slice(ACTION.indexOf("async function runProvider("));
    expect(provider.indexOf('if (outcome.kind !== "settled")'))
      .toBeLessThan(provider.indexOf("await announce("));
  });
});
