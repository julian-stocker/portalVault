/**
 * Recording a repayment against a withdrawal (ADR-0086).
 *
 * IT DOES NOT MOVE MONEY, and the copy says so. The refund is issued in
 * Stripe, where the original payment lives and where it can actually be
 * authorised; this records the amount so the order, the monthly reports and
 * the customer's own page agree about what happened.
 *
 * The database refuses more than was paid and refuses an unpaid order, so the
 * worst a mistyped figure produces is a refusal rather than a wrong record.
 */
"use client";

import { useState, useTransition } from "react";

import { ACTION_PRIMARY } from "@/components/ui/action";
import { recordRefund } from "@/lib/admin/refund-actions";
import { formatPrice } from "@/lib/format";
import type { RefundAllocation } from "@/lib/commerce/order-lines";
import { de } from "@/lib/i18n/de";

export function RefundForm({
  orderNumber,
  withdrawalId,
  withdrawalHandled = false,
  suggested,
  cancelled = [],
  unattributed = 0,
  openShipping = 0,
}: {
  orderNumber: string;
  /** The declaration this repays, when it repays one. */
  withdrawalId?: number;
  /**
   * That declaration is already ticked off. Then the refund changes nothing
   * about it (`coalesce(handled_at, now())` keeps the first date), and
   * announcing it would be wrong.
   */
  withdrawalHandled?: boolean;
  /**
   * What the cancelled quantities come to (0095). Pre-fills the amount; the
   * operator may change it, because an order-level discount and the shipping
   * are not divisible by any rule this system knows.
   */
  suggested?: number;
  /**
   * The positions the suggestion is made of, so the refund can say WHAT it
   * was for. Passed straight through as allocations when the amount is left
   * as suggested; a changed amount records no allocation rather than a wrong
   * one — a split that does not add up is worse than none.
   */
  cancelled?: readonly {
    orderLineId: number; quantity: number; amount: number;
    /** The position's name, so the list reads like the table above it. */
    label?: string;
  }[];
  /**
   * Money repaid that no allocation explains (0097).
   *
   * Shown, never netted. Such a repayment cannot be assigned to a position
   * without guessing which one, and a split that adds up by guessing is
   * worse than one the operator had to look at.
   */
  unattributed?: number;
  /**
   * What is still owed for the shipping, already netted against earlier
   * `shipping` allocations (0097). Offered as a tick box, never pre-ticked:
   * whether the Hinsendekosten are owed is a legal judgement about THIS
   * order, and the screen must not make it.
   */
  openShipping?: number;
}) {
  const copy = de.business.withdrawals;
  const [withShipping, setWithShipping] = useState(false);
  const money = (value: number) => value.toFixed(2).replace(".", ",");
  /** What the parts come to right now — the figure the field is filled with. */
  const target = (suggested ?? 0) + (withShipping ? openShipping : 0);
  const [amount, setAmount] = useState(
    suggested !== undefined && suggested > 0 ? money(suggested) : "");
  const [reason, setReason] = useState("");
  const [providerId, setProviderId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const field =
    "rounded-sky-sm bg-surface px-3 py-1.5 text-sm ring-1 ring-border/70 " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current";

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const value = Number(amount.replace(",", "."));
      /*
       * Die Aufteilung reist nur mit, wenn der Betrag unverändert ist. Sonst
       * wäre sie eine Behauptung über Geld, das anders verteilt wurde — und
       * die Datenbank würde sie ohnehin zurückweisen.
       */
      const unchanged = target > 0 && Math.round(value * 100) === Math.round(target * 100);
      const allocations: RefundAllocation[] = unchanged
        ? [
            ...cancelled.map((one) => ({
              type: "line" as const,
              orderLineId: one.orderLineId,
              quantity: one.quantity,
              amount: one.amount,
            })),
            /* Der Versand ist keine Position: kein `order_line_id`, keine
               Menge — genau die Form, die das Schema seit 0095 dafür hat. */
            ...(withShipping && openShipping > 0
              ? [{
                  type: "shipping" as const,
                  orderLineId: null,
                  quantity: null,
                  amount: openShipping,
                }]
              : []),
          ]
        : [];

      const result = await recordRefund({
        orderNumber,
        amount: value,
        reason,
        withdrawalId,
        providerRefundId: providerId,
        allocations,
      });
      if (result.ok) setAmount("");
      else setMessage(result.message);
    });
  }

  return (
    <form onSubmit={submit} className="mt-4 border-t border-border/60 pt-4">
      <h3 className="text-sm font-semibold">{copy.refundHeading}</h3>
      <p className="mt-1 text-xs text-muted">{copy.refundHint}</p>

      {/*
        WAS DER VORSCHLAG ABDECKT — sichtbar, nicht versteckt. Der Betrag ist
        die Summe dieser Zeilen, und genau diese Zeilen reisen als Aufteilung
        mit. Bereits erstattete Positionen stehen nicht mehr darunter.
      */}
      {cancelled.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-0.5 text-xs text-muted">
          {cancelled.map((one) => (
            <li key={one.orderLineId} className="flex justify-between gap-3">
              <span>
                {copy.allocationLine(one.quantity, one.label ?? String(one.orderLineId))}
              </span>
              <span className="tabular-nums">{formatPrice(one.amount)}</span>
            </li>
          ))}
          {withShipping && openShipping > 0 ? (
            <li className="flex justify-between gap-3">
              <span>{copy.shippingAllocation}</span>
              <span className="tabular-nums">{formatPrice(openShipping)}</span>
            </li>
          ) : null}
        </ul>
      ) : null}

      {openShipping > 0 ? (
        <label className="mt-2 flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            checked={withShipping}
            onChange={(event) => {
              const next = event.target.checked;
              setWithShipping(next);
              /* Betrag und Aufteilung bleiben zusammen: was angehakt ist,
                 steht im Feld. Tippt der Operator danach etwas anderes,
                 reist wie bisher gar keine Aufteilung mit. */
              const sum = (suggested ?? 0) + (next ? openShipping : 0);
              setAmount(sum > 0 ? money(sum) : "");
            }}
            className="mt-0.5"
          />
          <span className="text-muted">
            {copy.refundShipping(formatPrice(openShipping))}
          </span>
        </label>
      ) : null}

      {unattributed > 0 ? (
        <p className="mt-2 text-xs text-muted">
          {copy.unattributed(formatPrice(unattributed))}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted">{copy.amount}</span>
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            className={`${field} w-28 tabular-nums`}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted">{copy.reason}</span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={`${field} w-44`}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted">{copy.providerId}</span>
          <input
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
            className={`${field} w-44`}
          />
        </label>
        <button type="submit" disabled={pending} className={ACTION_PRIMARY}>
          {pending ? copy.recording : copy.record}
        </button>
      </div>

      {/*
        WAS DER KNOPF SONST NOCH TUT (0097).
        `seller_record_refund()` setzt `handled_at` auf dem mitgesendeten
        Widerruf — seit 0047 so gewollt, denn die Rückzahlung IST die
        Erledigung. Ungesagt war es trotzdem: auf SI-2026-001066 wurde
        Widerruf #7 nebenbei geschlossen, ohne dass es jemand angeklickt
        hätte. Der Satz ändert nichts am Verhalten, er spricht es aus.
      */}
      {withdrawalId !== undefined && !withdrawalHandled ? (
        <p className="mt-2 text-xs text-muted">{copy.refundClosesWithdrawal}</p>
      ) : null}

      {message === null ? null : (
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          {message}
        </p>
      )}
    </form>
  );
}
