"use client";

/**
 * Assigning the date of a purchase that arrived without one (ADR-0088).
 *
 * Thirteen imported purchases carry `purchased_at` NULL because the workbook's
 * date formula is `#REF!` — the cell it pointed at was deleted years ago. The
 * money was spent and the goods arrived; only the date is missing, and only
 * the owner can supply it.
 *
 * WHY THIS LIVES ON THE DETAIL PAGE AND NOT IN THE LEDGER ROW
 *
 * A date input in every row of an eighty-four-row ledger would cost the
 * density the ledger exists for, to serve thirteen rows. The ledger says
 * `Datum fehlt`; the purchase's own page is where it gets fixed.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ACTION_NEUTRAL } from "@/components/ui/action";
import { de } from "@/lib/i18n/de";
import { setPurchaseDate } from "@/lib/orderbook/actions";

const copy = de.business.orderbook;

export function PurchaseDate({ purchaseId, purchasedAt }: {
  purchaseId: number;
  purchasedAt: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(purchasedAt ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const save = (next: string | null) => {
    setError(null);
    startTransition(async () => {
      const result = await setPurchaseDate(purchaseId, next);
      if (!result.ok) { setError(result.message); return; }
      setOpen(false);
      // The server decides what the row now says — the ledger, the filters and
      // the summary all move with it.
      router.refresh();
    });
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
              className="min-h-11 text-sm text-muted underline underline-offset-2 hover:text-fg">
        {purchasedAt === null ? copy.setDate : copy.changeDate}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="purchase-date" className="sr-only">{copy.dateLabel}</label>
      <input id="purchase-date" type="date" value={value} disabled={pending}
             onChange={(event) => setValue(event.target.value)}
             className="min-h-11 rounded-sky-md bg-surface px-3 text-sm ring-1 ring-border/70" />
      <button type="button" disabled={pending || value === ""}
              onClick={() => save(value)}
              className={`${ACTION_NEUTRAL} min-h-11 w-auto disabled:opacity-50`}>
        {pending ? copy.dateSaving : copy.save}
      </button>
      {purchasedAt !== null ? (
        // Deliberate, not a reset: an owner who discovers the date was wrong
        // must be able to say "I do not know" rather than pick another guess.
        <button type="button" disabled={pending} onClick={() => save(null)}
                className="min-h-11 px-2 text-xs text-muted underline underline-offset-2">
          {copy.clearDate}
        </button>
      ) : null}
      <button type="button" disabled={pending} onClick={() => { setOpen(false); setError(null); }}
              className="min-h-11 px-2 text-xs text-muted underline underline-offset-2">
        {copy.remapCancel}
      </button>
      {error ? <p className="w-full text-xs text-danger">{error}</p> : null}
    </div>
  );
}
