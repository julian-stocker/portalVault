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
import { de } from "@/lib/i18n/de";

export function RefundForm({
  orderNumber,
  withdrawalId,
}: {
  orderNumber: string;
  withdrawalId: number;
}) {
  const copy = de.business.withdrawals;
  const [amount, setAmount] = useState("");
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
      const result = await recordRefund({
        orderNumber,
        amount: Number(amount.replace(",", ".")),
        reason,
        withdrawalId,
        providerRefundId: providerId,
      });
      if (result.ok) setAmount("");
      else setMessage(result.message);
    });
  }

  return (
    <form onSubmit={submit} className="mt-4 border-t border-border/60 pt-4">
      <h3 className="text-sm font-semibold">{copy.refundHeading}</h3>
      <p className="mt-1 text-xs text-muted">{copy.refundHint}</p>

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

      {message === null ? null : (
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          {message}
        </p>
      )}
    </form>
  );
}
