"use client";

/**
 * Correcting whether a record is a test (0063).
 *
 * WHY A CORRECTION EXISTS AT ALL
 *
 * The flag is set when the record is created, and the moment somebody forgets
 * to tick it the alternative to correcting it is deleting a purchase — which
 * this product does not do, and should not start doing over a checkbox.
 *
 * WHAT IT MAY AND MAY NOT MOVE
 *
 * One boolean. The server functions behind it name no other column: not the
 * cost, not the amounts, not the items, not the channel, not the date, not
 * `source` and not `import_fingerprint`. Nothing about inventory is reachable
 * from here at all — no movement is written, reversed or relabelled, because
 * classifying a record says nothing about where its figures are.
 *
 * WHY THERE IS NO TOGGLE ON AN INTERNAL SALE
 *
 * Its answer belongs to the order. `orders.commerce_mode` is stamped when the
 * order is placed and frozen afterwards, so a sandbox checkout is a test for
 * ever and a live one can never be turned into one. The sale page states that
 * instead of offering a control the database would refuse.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { de } from "@/lib/i18n/de";
import { setPurchaseTest } from "@/lib/orderbook/actions";
import { setSaleTest } from "@/lib/orderbook/sales-actions";

const copy = de.business.orderbook;

export function TestFlag({ kind, id, isTest, expectedUpdatedAt }: {
  kind: "purchase" | "sale";
  id: number;
  isTest: boolean;
  /** 0062's concurrency token. Sales only — a purchase has none. */
  expectedUpdatedAt?: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const toggle = () => {
    setError(null);
    startTransition(async () => {
      const result = kind === "purchase"
        ? await setPurchaseTest(id, !isTest)
        : await setSaleTest(id, !isTest, expectedUpdatedAt ?? null);
      if (!result.ok) { setError(result.message); return; }
      // The server decides what the row now says: the lists, the counts and
      // the summaries all move with it.
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isTest ? (
        <span title={copy.status.testTitle}
              className="rounded-sky-md bg-surface px-2 py-0.5 text-xs font-medium text-muted ring-1 ring-border/70">
          {copy.status.testBadge}
        </span>
      ) : null}
      <button type="button" onClick={toggle} disabled={pending}
              className="min-h-11 text-sm text-muted underline underline-offset-2 hover:text-fg disabled:opacity-60">
        {pending ? copy.testSaving : isTest ? copy.unmarkTest : copy.markTest}
      </button>
      {error ? <p role="alert" className="w-full text-xs text-danger">{error}</p> : null}
    </div>
  );
}
