/**
 * What went out about this order, and what did not.
 *
 * Three mails exist; a row appears once one has been attempted. The state is
 * the EFFECTIVE one — `admin_order()` asks the same rule
 * `claim_order_mail()` does, so a claim that has been stale for days reads as
 * `unresolved` here exactly as it does to the guard.
 *
 * THE RETRY, AND THE ONE CASE THAT ASKS FIRST
 *
 *   sent        no button. Terminal, and Resend's idempotency window is 24
 *               hours — a later second send is a second message in the
 *               customer's inbox, and no flag makes that acceptable.
 *   failed      one button. The provider refused, so nothing was accepted and
 *               nothing can be duplicated.
 *   unresolved  a button that asks first, naming the ambiguity. It might have
 *               gone out.
 *   sending     no button while the claim is fresh; somebody is sending.
 */
"use client";

import { useState, useTransition } from "react";

import { ACTION_NEUTRAL, ACTION_PRIMARY } from "@/components/ui/action";
import { retryOrderMail, type MailKind } from "@/lib/admin/order-actions";
import { de } from "@/lib/i18n/de";

export type OrderMailRow = {
  kind: string;
  state: string;
  sent_at: string | null;
  attempts: number;
  last_error: string | null;
  updated_at: string | null;
};

/** The tone each state earns. Only the two that need a person are loud. */
function toneFor(state: string): string {
  if (state === "sent") return "text-success";
  if (state === "unresolved") return "font-semibold text-danger";
  if (state === "failed") return "font-semibold text-accent";
  return "text-muted";
}

function Row({ row, orderNumber }: { row: OrderMailRow; orderNumber: string }) {
  const copy = de.admin.orders.mail;
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const retryable = row.state === "failed" || row.state === "unresolved";

  function send(acknowledge: boolean) {
    setAsking(false);
    setMessage(null);
    startTransition(async () => {
      const result = await retryOrderMail(orderNumber, row.kind as MailKind, acknowledge);
      setMessage(
        result.ok ? (copy.outcome[result.outcome] ?? copy.outcome.unknown) : result.message,
      );
    });
  }

  return (
    <li className="rounded-sky-md bg-surface/60 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-medium">{copy.kind[row.kind] ?? row.kind}</span>
        <span className={toneFor(row.state)}>{copy.state[row.state] ?? row.state}</span>
      </div>

      <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted tabular-nums">
        {row.sent_at ? (
          <span>{copy.sentAt(new Date(row.sent_at).toLocaleString(de.locale))}</span>
        ) : null}
        <span>{copy.attempts(row.attempts)}</span>
        {row.last_error ? <span>{copy.lastError(row.last_error)}</span> : null}
      </p>

      {/* The one case that could deliver twice asks before it does. */}
      {asking ? (
        <div className="mt-3 rounded-sky-md bg-surface-raised p-3 ring-1 ring-danger/60">
          <p className="font-medium">{copy.confirmUnresolvedTitle}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">{copy.confirmUnresolvedBody}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => send(true)}
              disabled={pending}
              className={`${ACTION_PRIMARY} w-auto disabled:opacity-60`}
            >
              {copy.confirmUnresolvedYes}
            </button>
            <button
              type="button"
              onClick={() => setAsking(false)}
              className={`${ACTION_NEUTRAL} w-auto`}
            >
              {copy.confirmUnresolvedNo}
            </button>
          </div>
        </div>
      ) : retryable ? (
        <button
          type="button"
          onClick={() => (row.state === "unresolved" ? setAsking(true) : send(false))}
          disabled={pending}
          className={`${ACTION_NEUTRAL} mt-3 w-auto disabled:opacity-60`}
        >
          {pending ? copy.retrying : copy.retry}
        </button>
      ) : row.state === "sent" ? (
        // Deliberately a sentence rather than a disabled button: a control
        // nobody may use is better absent, and the reason is worth stating.
        <p className="mt-2 text-xs text-muted">{copy.sentIsFinal}</p>
      ) : null}

      {message ? (
        <p role="status" className="mt-2 text-xs text-muted">
          {message}
        </p>
      ) : null}
    </li>
  );
}

export function OrderMailPanel({
  orderNumber,
  mail,
}: {
  orderNumber: string;
  mail: readonly OrderMailRow[];
}) {
  const copy = de.admin.orders.mail;

  return (
    <>
      <h2 className="mt-8 text-lg font-semibold">{copy.heading}</h2>
      {mail.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{copy.empty}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {mail.map((row) => (
            <Row key={row.kind} row={row} orderNumber={orderNumber} />
          ))}
        </ul>
      )}
    </>
  );
}
