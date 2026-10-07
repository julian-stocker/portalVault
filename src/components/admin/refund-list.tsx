/**
 * Die Erstattungen einer Bestellung, mit dem Zustand, der zählt (0111).
 *
 * DIE EINE STELLE, DIE BEIDES ZEIGT. Die Kundenansicht sieht nur bestätigtes
 * Geld — eine Buchung ohne Geldfluss ist eine Absicht des Betriebs und keine
 * Tatsache über ein fremdes Konto. Der Betrieb muss beides sehen, sonst bleibt
 * eine nicht ausgelöste Erstattung unsichtbar. Genau das war der Vorfall:
 * `order_refunds#1` über 0,76 € stand zwei Wochen da, und nichts auf dem
 * Bildschirm sagte, dass bei Stripe nie etwas passiert ist.
 *
 * FARBE IST NIE DER EINZIGE TRÄGER: jeder Zustand hat seinen Namen im Text,
 * seinen Satz im `title` und, wo es eine Handlung gibt, einen Knopf mit einem
 * Verb. „Zustand prüfen" bei einem offenen Vorgang ist bewusst nicht „erneut
 * auslösen" — es wird nachgesehen, bevor etwas gesendet wird.
 */
"use client";

import { useState, useTransition } from "react";

import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import { resumeRefund, submitRefund } from "@/lib/admin/refund-actions";
import {
  providerStatus, refundAction, settledRefundTotal, unsettledRefundTotal,
  type RefundFacts,
} from "@/lib/commerce/refund-state";

const copy = de.business.withdrawals;

export type RefundRow = RefundFacts & {
  id: number;
  occurred_at: string;
  reason?: string | null;
  provider_attempts?: number | null;
  failure_code?: string | null;
};

export function RefundList({ orderNumber, refunds }: {
  orderNumber: string;
  refunds: readonly RefundRow[];
}) {
  const [message, setMessage] = useState<string | null>(null);
  /** Welche Zeile gerade läuft. Eine Menge, damit zwei sich nicht sperren. */
  const [busy, setBusy] = useState<ReadonlySet<number>>(() => new Set());
  const [, startTransition] = useTransition();

  if (refunds.length === 0) return null;

  const settled = settledRefundTotal(refunds);
  const unsettled = unsettledRefundTotal(refunds);

  const run = (id: number, action: "submit" | "resume") => {
    if (busy.has(id)) return;
    setBusy((current) => new Set(current).add(id));
    setMessage(null);
    startTransition(async () => {
      try {
        const result = action === "resume"
          ? await resumeRefund(id, orderNumber)
          : await submitRefund(id, orderNumber);
        setMessage(result.ok
          ? (result.state === "booked" ? result.message : null)
          : result.message);
      } finally {
        setBusy((current) => { const next = new Set(current); next.delete(id); return next; });
      }
    });
  };

  return (
    <section className="mt-4 border-t border-border/60 pt-4">
      <h3 className="text-sm font-semibold">{copy.refundsHeading}</h3>

      <dl className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <span className="flex gap-1">
          <dt className="text-muted">{copy.refundSettledTotal}</dt>
          <dd className="tabular-nums">{formatPrice(settled)}</dd>
        </span>
        {/* Nur wenn es sie gibt: eine Null hier wäre eine Frage ohne Anlass. */}
        {unsettled > 0 ? (
          <span className="flex gap-1">
            <dt className="text-muted">{copy.refundUnsettledTotal}</dt>
            <dd className="tabular-nums text-amber-400">{formatPrice(unsettled)}</dd>
          </span>
        ) : null}
      </dl>

      <ul className="mt-2 flex flex-col gap-1.5">
        {refunds.map((refund) => {
          const state = providerStatus(refund);
          const action = refundAction(refund);
          const working = busy.has(refund.id);
          const attempts = Number(refund.provider_attempts ?? 0);
          return (
            <li key={refund.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="w-20 shrink-0 tabular-nums">{formatPrice(Number(refund.amount))}</span>
              <span className={`shrink-0 ${
                state === "succeeded" ? "text-emerald-400"
                  : state === "failed" ? "text-danger"
                    : state === "pending" ? "text-amber-400" : "text-muted"}`}
                    title={copy.providerStateHints[state]}>
                {copy.providerStates[state]}
              </span>
              {refund.provider_refund_id ? (
                <span className="shrink-0 text-muted">
                  {copy.providerRefundLabel} <code>{refund.provider_refund_id}</code>
                </span>
              ) : null}
              {state === "failed" && refund.failure_code ? (
                <span className="shrink-0 text-danger">{refund.failure_code}</span>
              ) : null}
              {attempts > 1 ? (
                <span className="shrink-0 text-muted">{copy.providerAttempt(attempts)}</span>
              ) : null}
              {action !== null ? (
                <button type="button" disabled={working}
                        onClick={() => run(refund.id, action)}
                        className="min-h-8 rounded-sky-md px-2 ring-1 ring-border/70 hover:ring-fg/30 disabled:opacity-50">
                  {action === "resume" ? copy.resumeRefund : copy.submitRefund}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>

      {message === null ? null : (
        <p role="alert" className="mt-2 text-sm">{message}</p>
      )}
    </section>
  );
}
