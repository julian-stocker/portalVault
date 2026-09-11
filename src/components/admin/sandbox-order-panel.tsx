/**
 * A test order, said out loud — and the one button that undoes its effect on
 * real stock.
 *
 * A sandbox order goes through the real inventory path on purpose: that is
 * what makes a production sandbox worth running. So it really did lower real
 * stock, and this is where it goes back.
 *
 * The correction is a new movement, never an edit (ADR-0037). The database
 * refuses any order that was not placed in sandbox, so this button cannot
 * reach a real customer's goods even if it were rendered by mistake.
 */
"use client";

import { useState, useTransition } from "react";

import { ACTION_NEUTRAL } from "@/components/ui/action";
import { revertSandboxStock } from "@/lib/admin/actions";
import { de } from "@/lib/i18n/de";

export function SandboxOrderPanel({
  orderNumber,
  stockReverted,
}: {
  orderNumber: string;
  stockReverted: boolean;
}) {
  const copy = de.admin.commerce;
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reverted = stockReverted || done;

  function revert() {
    setError(null);
    startTransition(async () => {
      const result = await revertSandboxStock(orderNumber);
      if (result.ok) setDone(true);
      else setError(result.message);
    });
  }

  return (
    <section className="mt-5 rounded-sky-lg bg-surface-raised p-5 ring-1 ring-border-strong">
      <h2 className="flex items-center gap-2 font-semibold">
        <span className="rounded-sky-sm bg-accent/20 px-2 py-0.5 text-xs tracking-wide text-foreground">
          {copy.sandboxBadge}
        </span>
        {copy.modeSandbox}
      </h2>
      <p className="mt-1 text-sm text-muted">{copy.sandboxOrderHint}</p>

      {reverted ? (
        <p className="mt-3 text-sm text-muted">
          {stockReverted ? copy.revertStockAlready : copy.revertStockDone}
        </p>
      ) : (
        <>
          <p className="mt-3 text-sm text-muted">{copy.revertStockHint}</p>
          <button type="button" disabled={pending} onClick={revert} className={`${ACTION_NEUTRAL} mt-3`}>
            {copy.revertStock}
          </button>
        </>
      )}

      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
    </section>
  );
}
