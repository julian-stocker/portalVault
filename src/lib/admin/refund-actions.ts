/**
 * Eine Rückerstattung auslösen (ADR-0086, neu gefasst in ADR-0118).
 *
 * WAS SICH GEÄNDERT HAT UND WARUM. Bis `0111` hat diese Datei eine Erstattung
 * nur BUCHGEHALTEN: Stripe wurde nicht gerufen, der Operator musste zusätzlich
 * ins Dashboard, und der Beweis — die Stripe-Erstattungs-ID — war ein
 * optionales Textfeld. Bei SI-2026-001009 ist genau das passiert, was so eine
 * Lücke erlaubt: die Buchung stand, die Bestellung sagte „teilweise
 * erstattet", die Kundenansicht zeigte „−0,76 €" — und bei Stripe war nichts
 * erstattet.
 *
 * JETZT LÖST SKYISLES SELBST AUS, in zwei Schritten, die beide hier stehen:
 *
 *   1. BUCHEN — `seller_record_refund()`, atomar, mit Aufteilung, wie bisher.
 *      Die Zeile entsteht als `provider_status = 'none'`: gebucht, kein Geld.
 *   2. AUSLÖSEN — die Edge Function `refund-payment`, die den Restricted Key
 *      hält (ADR-0051). Erst ihre Bestätigung macht die Zeile `succeeded`.
 *
 * WAS DIESE DATEI DESHALB NICHT MEHR TUT: behaupten. `orders.payment_status`
 * wird nicht hier gesetzt, sondern in der Datenbank aus den BESTÄTIGTEN
 * Erstattungen gespiegelt, und die Erstattungsmail geht nur hinaus, wenn der
 * Zahlungsdienst bestätigt hat.
 *
 * EIN TEILERFOLG IST EIN ERGEBNIS, KEIN FEHLER. Bucht Schritt 1 und scheitert
 * Schritt 2, existiert die Buchung — und die Oberfläche sagt genau das, mit
 * dem Knopf, es erneut zu versuchen. Das Gegenteil, „fehlgeschlagen" zu
 * melden, würde zu einer zweiten Buchung führen.
 *
 * THE MONEY IS THE SUM OF THE EVENTS (ADR-0083) gilt unverändert — nur zählen
 * jetzt die Ereignisse, die beim Zahlungsdienst wirklich stattgefunden haben.
 */
"use server";

import { revalidatePath } from "next/cache";

import { notify } from "@/lib/commerce/notify";

import { canOperateSeller } from "@/lib/auth/capabilities";
import { de } from "@/lib/i18n/de";
import { allocationsValid, type RefundAllocation } from "@/lib/commerce/order-lines";
import { createClient } from "@/lib/supabase/server";

/**
 * Was aus einem Erstattungsversuch zurückkommt.
 *
 * Vier Ausgänge statt zwei, weil es vier gibt. `settled` ist der einzige, nach
 * dem Geld unterwegs ist; `booked` heißt, die Buchung steht und der
 * Zahlungsdienst hat sie (noch) nicht angenommen — mit `message` als dem Satz,
 * der das erklärt, und `refundId` als dem Weg, es erneut zu versuchen.
 */
export type RefundResult =
  | { ok: true; state: "settled"; refundId: number; refundedTotal: string }
  | { ok: true; state: "booked"; refundId: number; message: string; retryable: boolean }
  | { ok: false; message: string };

/** Was `refund-payment` antwortet, so weit diese Datei es liest. */
type ProviderOutcome =
  | { kind: "settled"; providerRefundId: string; replayed?: boolean }
  | { kind: "failed"; code: string }
  | { kind: "unresolved"; code: string }
  | { kind: "refused"; reason: string };

/**
 * Den Zahlungsdienst bitten, eine gebuchte Erstattung auszuführen.
 *
 * Über die Edge Function, weil der Restricted Key ein Supabase-Secret ist und
 * dieses Deployment keinen Schlüssel hält, der Geld bewegen könnte (ADR-0051).
 * `action` unterscheidet den ersten Versuch von der Fortsetzung eines offenen:
 * ein offener Vorgang wird NACHGESEHEN, nicht blind wiederholt.
 */
async function askProvider(
  refundId: number, action: "submit" | "resume",
): Promise<ProviderOutcome> {
  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke("refund-payment", {
    body: { refund_id: refundId, action },
  });
  if (error) {
    /*
     * Eine Antwort, die wir nicht lesen können, ist KEIN Fehlschlag des
     * Geldflusses. `unresolved` lässt die Buchung offen und fortsetzbar —
     * `failed` würde zu einem zweiten Versuch einladen, und wenn der erste
     * doch durchkam, wäre das Geld zweimal unterwegs.
     *
     * Die Function antwortet bei einem unklaren Zustand mit 503, und
     * `functions.invoke` macht daraus einen Fehler. Deshalb wird hier der
     * Rumpf vorgezogen, wo es einen gibt.
     */
    const body = (data ?? null) as { kind?: string; code?: string; reason?: string } | null;
    if (body?.kind === "failed") return { kind: "failed", code: String(body.code ?? "unknown") };
    if (body?.kind === "refused") return { kind: "refused", reason: String(body.reason ?? "refused") };
    return { kind: "unresolved", code: String(body?.code ?? "provider_unreachable") };
  }
  const body = (data ?? {}) as Record<string, unknown>;
  if (body.kind === "settled" && typeof body.providerRefundId === "string") {
    return { kind: "settled", providerRefundId: body.providerRefundId,
             replayed: body.replayed === true };
  }
  if (body.kind === "failed") return { kind: "failed", code: String(body.code ?? "unknown") };
  if (body.kind === "refused") return { kind: "refused", reason: String(body.reason ?? "refused") };
  return { kind: "unresolved", code: String(body.code ?? "unknown") };
}

/** Der Satz zu einem Ausgang, der kein Geld bewegt hat. */
function providerMessage(outcome: Exclude<ProviderOutcome, { kind: "settled" }>): string {
  const copy = de.business.withdrawals;
  if (outcome.kind === "failed") return copy.providerRefused(outcome.code);
  if (outcome.kind === "refused") return copy.providerRefusedToTry(outcome.reason);
  return copy.providerUnresolved;
}

export async function recordRefund(input: {
  orderNumber: string;
  amount: number;
  reason?: string;
  withdrawalId?: number;
  providerRefundId?: string;
  /**
   * What the amount was for (0095).
   *
   * Optional, and 1:n — a repayment may cover one position, a part of one,
   * several, the shipping or goodwill. Where it is given, the parts must add
   * up to the amount exactly; the database checks that again before it writes
   * anything, so a half-allocated refund cannot exist.
   */
  allocations?: readonly RefundAllocation[];
}): Promise<RefundResult> {
  if (!(await canOperateSeller())) return { ok: false, message: de.admin.notAllowed };

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, message: de.business.withdrawals.amountInvalid };
  }
  const allocations = input.allocations ?? [];
  if (!allocationsValid(allocations, input.amount)) {
    return { ok: false, message: de.business.withdrawals.allocationsInvalid };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_record_refund", {
    p_order_number: input.orderNumber,
    p_amount: input.amount,
    p_reason: input.reason?.trim() || null,
    p_withdrawal_id: input.withdrawalId ?? null,
    p_provider_refund_id: input.providerRefundId?.trim() || null,
    p_allocations: allocations.length === 0 ? null : allocations.map((one) => ({
      type: one.type,
      order_line_id: one.orderLineId,
      quantity: one.quantity,
      amount: one.amount,
    })),
  });

  if (error) {
    const code = error.code ?? "";
    if (code === "42501") return { ok: false, message: de.admin.notAllowed };
    // The database refuses more than was paid, and an order that was never
    // paid. Both are facts about the order, not faults.
    if (code === "22023") return { ok: false, message: de.business.withdrawals.refundRefused };
    return { ok: false, message: de.business.withdrawals.refundFailed };
  }

  const row = (data ?? {}) as Record<string, unknown>;
  const refundId = typeof row.refund_id === "number" ? row.refund_id : null;
  if (refundId === null) {
    return { ok: false, message: de.business.withdrawals.refundFailed };
  }

  /*
   * SCHRITT 2 — UND ER IST EIN EIGENER AUFRUF, WEIL ER EIN EIGENES RISIKO IST.
   *
   * Hat der Operator eine fremde Erstattungs-ID mitgegeben, ist die Zeile
   * bereits `succeeded` und es gibt nichts auszulösen: das Geld ging
   * außerhalb von SkyIsles zurück. Sonst bittet jetzt die Edge Function den
   * Zahlungsdienst.
   */
  const booked = String(row.provider_status ?? "none");
  const outcome: ProviderOutcome = booked === "succeeded"
    ? { kind: "settled", providerRefundId: String(input.providerRefundId ?? "") }
    : await askProvider(refundId, "submit");

  const paths = () => {
    revalidatePath("/business/widerrufe");
    revalidatePath(`/business/orders/${input.orderNumber}`);
    revalidatePath("/business/orders");
  };

  if (outcome.kind !== "settled") {
    /*
     * DIE BUCHUNG STEHT, DAS GELD NICHT. Das ist kein Fehlschlag des Ganzen —
     * „fehlgeschlagen" zu melden würde zu einer zweiten Buchung führen. Der
     * Bildschirm sagt, was gilt, und bietet den erneuten Versuch an.
     */
    paths();
    return { ok: true, state: "booked", refundId,
             message: providerMessage(outcome),
             retryable: outcome.kind !== "refused" };
  }

  await announce(input.orderNumber, refundId);
  paths();
  return { ok: true, state: "settled", refundId,
           refundedTotal: String(row.refunded_total ?? "0") };
}

/**
 * Eine bereits gebuchte Erstattung beim Zahlungsdienst auslösen.
 *
 * Der Weg für zwei Lagen, die es beide gibt: eine Buchung, deren Auslösung
 * nie passiert ist (`none` — so steht `order_refunds#1` aus dem Vorfall da),
 * und eine, die der Zahlungsdienst ausdrücklich abgelehnt hat (`failed`).
 *
 * KEINE ZWEITE BUCHUNG. Dieselbe Zeile, derselbe Betrag, dieselbe Aufteilung,
 * keine weitere Stornierung und keine Lagerbewegung — ausgelöst wird, was
 * schon dasteht.
 */
export async function submitRefund(refundId: number, orderNumber: string): Promise<RefundResult> {
  return runProvider(refundId, orderNumber, "submit");
}

/**
 * Einen offenen Vorgang fortsetzen.
 *
 * `pending` heißt: wir haben gesendet und wissen die Antwort nicht. Hier wird
 * deshalb NACHGESEHEN, bevor etwas gesendet wird — die Function liest die
 * Erstattungen der Zahlung und erstattet nur, wenn dort keine mit unserer
 * Kennung liegt.
 */
export async function resumeRefund(refundId: number, orderNumber: string): Promise<RefundResult> {
  return runProvider(refundId, orderNumber, "resume");
}

async function runProvider(
  refundId: number, orderNumber: string, action: "submit" | "resume",
): Promise<RefundResult> {
  if (!(await canOperateSeller())) return { ok: false, message: de.admin.notAllowed };
  if (!Number.isSafeInteger(refundId) || refundId < 1) {
    return { ok: false, message: de.business.withdrawals.refundFailed };
  }

  const outcome = await askProvider(refundId, action);

  revalidatePath("/business/widerrufe");
  revalidatePath(`/business/orders/${orderNumber}`);
  revalidatePath("/business/orders");

  if (outcome.kind !== "settled") {
    return { ok: true, state: "booked", refundId,
             message: providerMessage(outcome),
             retryable: outcome.kind !== "refused" };
  }
  await announce(orderNumber, refundId);
  return { ok: true, state: "settled", refundId, refundedTotal: "" };
}

/**
 * DER HINWEIS AN DIE KUNDSCHAFT (0100) — und erst jetzt (0111).
 *
 * Die Mail sagt „Wir haben deine Erstattung angewiesen". Bis `0111` ging sie
 * beim BUCHEN hinaus, also auch dann, wenn nie Geld floss; das war die
 * schwerste Folge des Vorfalls, weil es eine Zusage nach außen ist. Jetzt
 * hängt sie an der Bestätigung des Zahlungsdienstes.
 *
 * `ref` ist die Erstattung selbst, damit eine zweite Erstattung derselben
 * Bestellung eine eigene Mail bekommt statt als Wiederholung der ersten zu
 * gelten. Ohne die Handlung scheitern zu lassen: was nicht hinausging, steht
 * in `order_mail`.
 */
async function announce(orderNumber: string, refundId: number): Promise<void> {
  await notify({ orderNumber, kind: "refund_confirmation", ref: refundId });
}
