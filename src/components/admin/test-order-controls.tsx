/**
 * Archive and restore, for test orders only (ADR-0084).
 *
 * THE WORD MATTERS. This is not a delete button and the copy never lets it
 * read as one: archiving hides a finished test from this list and nothing
 * else. The order, its lines, its payment events and its fulfilment history
 * stay in the database, and `Wiederherstellen` brings the row back.
 *
 * The guard is not here. `seller_archive_test_orders()` refuses any request
 * naming a live order — the whole request — and a CHECK constraint on `orders`
 * refuses the archived state on a live row however it is reached. This
 * component only reports what the database said.
 */
"use client";

import { useState, useTransition } from "react";

import { archiveTestOrders, restoreTestOrders } from "@/lib/admin/test-order-actions";
import { de } from "@/lib/i18n/de";

type Action = "archive" | "restore";

export function TestOrderButton({
  orderNumbers,
  action,
  variant = "link",
}: {
  orderNumbers: readonly string[];
  action: Action;
  variant?: "link" | "button";
}) {
  const copy = de.business.testOrders;
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function run() {
    setMessage(null);
    startTransition(async () => {
      const result =
        action === "archive"
          ? await archiveTestOrders(orderNumbers)
          : await restoreTestOrders(orderNumbers);
      // On success the action revalidates the route and the rows re-render.
      if (!result.ok) setMessage(result.message);
    });
  }

  const label = pending ? copy.working : action === "archive" ? copy.archive : copy.restore;
  const className =
    variant === "button"
      ? "rounded-sky-sm bg-surface px-3 py-1 text-sm ring-1 ring-border/70 hover:ring-border-strong disabled:opacity-60"
      : "text-sm text-muted underline underline-offset-4 hover:text-foreground disabled:opacity-60";

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending || orderNumbers.length === 0}
        className={className}
      >
        {label}
      </button>
      {message === null ? null : <span className="text-xs text-danger">{message}</span>}
    </span>
  );
}
