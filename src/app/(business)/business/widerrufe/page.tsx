import type { Metadata } from "next";
import Link from "next/link";

import { RefundForm } from "@/components/admin/refund-form";
import { fetchWithdrawals, type SellerWithdrawal } from "@/lib/admin/withdrawals";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";

export const metadata: Metadata = { title: de.business.withdrawals.heading };
export const dynamic = "force-dynamic";

/**
 * Eingegangene Widerrufe (ADR-0086).
 *
 * WHAT THE OPERATOR MUST BE ABLE TO SEE, and why each of it is here:
 *
 *   the statutory moment of receipt   it decides whether the period was met,
 *                                     and it is the database's clock
 *   the declaration as it was made    § 356a Abs. 4 required us to confirm
 *                                     exactly this text; it must not drift
 *   whether the receipt was delivered a failed confirmation is the operator's
 *                                     problem to fix, not the consumer's
 *   what has been repaid so far       the sum of the refund events
 *
 * Deliberately plain. This is a workbench, and a withdrawal is rare enough
 * that the list will be short for a long time.
 */
export default async function WithdrawalsPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string }>;
}) {
  const { open } = await searchParams;
  const openOnly = open === "1";
  const withdrawals = await fetchWithdrawals(openOnly);
  const copy = de.business.withdrawals;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-8 pb-10 md:pt-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{copy.heading}</h1>
        <div className="flex gap-3 text-sm">
          <Link
            href="/business/widerrufe?open=1"
            className={openOnly ? "font-semibold underline underline-offset-4" : "text-muted"}
          >
            {copy.openOnly}
          </Link>
          <Link
            href="/business/widerrufe"
            className={openOnly ? "text-muted" : "font-semibold underline underline-offset-4"}
          >
            {copy.all}
          </Link>
        </div>
      </div>

      <p className="mt-2 text-sm text-muted">{copy.pageHint}</p>

      {withdrawals.length === 0 ? (
        <p className="mt-8 text-muted">{copy.empty}</p>
      ) : (
        <ul className="mt-8 flex flex-col gap-4">
          {withdrawals.map((entry) => (
            <WithdrawalRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </main>
  );
}

function WithdrawalRow({ entry }: { entry: SellerWithdrawal }) {
  const copy = de.business.withdrawals;
  const refunded = Number(entry.refunded_total);

  return (
    <li className="rounded-sky-lg bg-surface/80 p-5 ring-1 ring-border/70">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Link
          href={`/business/orders/${entry.order_number}`}
          className="font-medium tabular-nums underline-offset-4 hover:underline"
        >
          {entry.order_number}
        </Link>
        <span
          className={
            "text-xs " + (entry.handled_at === null ? "font-semibold text-danger" : "text-muted")
          }
        >
          {entry.handled_at === null ? copy.open : copy.handled}
        </span>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[max-content_1fr]">
        <dt className="text-muted">{copy.receivedAt}</dt>
        {/* The statutory timestamp, to the minute. */}
        <dd className="tabular-nums">{berlinDateTime(entry.received_at)}</dd>

        <dt className="text-muted">{copy.declaredBy}</dt>
        <dd>
          {entry.consumer_name}
          <span className="block text-xs text-muted">{entry.contact_email}</span>
        </dd>

        <dt className="text-muted">{copy.receipt}</dt>
        <dd className={entry.receipt_state === "failed" ? "font-semibold text-danger" : undefined}>
          {copy.receiptState[entry.receipt_state]}
        </dd>

        <dt className="text-muted">{copy.declaration}</dt>
        <dd className="whitespace-pre-line">{entry.declaration}</dd>
      </dl>

      {refunded > 0 ? (
        <p className="mt-3 text-sm">{copy.refundedSoFar(formatPrice(refunded))}</p>
      ) : null}

      <RefundForm orderNumber={entry.order_number} withdrawalId={entry.id} />
    </li>
  );
}

/** Date and time, as § 356a Abs. 4 records them. */
function berlinDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "–";
  return `${new Intl.DateTimeFormat("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }).format(date)} Uhr`;
}
