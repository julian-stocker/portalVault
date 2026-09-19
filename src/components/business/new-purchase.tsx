/**
 * Creating a purchase, figures and all (ADR-0088, ADR-0091).
 *
 * WHAT CHANGED, AND WHY. Until 0064 this form took three facts — when money
 * left, how much, and a note — and the figures were entered afterwards on the
 * detail page. The reasoning at the time was that the parcel is worked
 * through there anyway. In practice the owner knows what is in the box while
 * they are typing the amount, and being sent to a second screen to say so
 * made the ordinary case the slow one.
 *
 * So the figures are here now, and the draft lives in the browser until the
 * button is pressed: clicking a search result must not bring a half-made
 * purchase into being. One press, one transaction — see
 * `createPurchaseWithItems`.
 *
 * THE DATE MAY STILL BE UNKNOWN, and so may the figures. A parcel is often
 * entered before the invoice is found, and sometimes before it is unpacked.
 * An empty date writes NULL (0058); an empty figure list is equally allowed
 * and makes the purchase `Unvollständig` (0063). Neither is forced, because
 * forcing either would mean inventing a fact.
 *
 * AND BUYING IS STILL NOT STOCKING. Ten figures entered here move no stock at
 * all; `Einbuchen` on the individual item is what puts one on the shelf.
 */
"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { ACTION_PRIMARY } from "@/components/ui/action";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import { createPurchaseWithItems } from "@/lib/orderbook/actions";
import {
  draftPayload, draftUnitCount, draftValue, MAX_DRAFT_UNITS, type DraftLine,
} from "@/lib/orderbook/draft";
import type { FigureChoice } from "@/lib/orderbook/figure-search";
import { FigureDraft } from "./figure-draft";

const copy = de.business.orderbook;
const figures = copy.figures;

export function NewPurchase({ defaultTest = false, catalog = [] }: {
  /** Arrives as `?test=1` when the form was opened from the Test view. */
  defaultTest?: boolean;
  /** The canonical catalog, shipped once with the page. */
  catalog?: readonly FigureChoice[];
}) {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [cost, setCost] = useState("");
  const [note, setNote] = useState("");
  const [isTest, setIsTest] = useState(defaultTest);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /*
   * Live, and by the SAME arithmetic the database uses — `draftValue` calls
   * `valuePurchase`, which is what `purchase_market_value()` mirrors. So the
   * number on this screen is the number the purchase will show the moment it
   * exists, rather than an estimate that turns out to differ.
   *
   * A malformed amount values as 0 rather than NaN: the field is still being
   * typed, and `Faktor NaN` is not a thing to show anybody.
   */
  const amount = Number(cost.replace(",", "."));
  const value = useMemo(
    () => draftValue(Number.isFinite(amount) && amount >= 0 ? amount : 0, lines),
    [amount, lines],
  );
  const units = draftUnitCount(lines);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!Number.isFinite(amount) || amount < 0) {
      setError(de.admin.writeFailed);
      return;
    }
    if (units > MAX_DRAFT_UNITS) {
      setError(figures.limit(MAX_DRAFT_UNITS));
      return;
    }
    startTransition(async () => {
      const result = await createPurchaseWithItems(
        date.trim() || null, amount, draftPayload(lines), note.trim() || undefined, isTest,
      );
      if (!result.ok) setError(result.message);
      else router.push(`/business/orderbuch/${result.id}`);
    });
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
      {error ? (
        <p role="alert" className="rounded-sky-md bg-surface px-3 py-2 text-sm ring-1 ring-border/70">{error}</p>
      ) : null}

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">{copy.columns.date}</span>
        {/* Not `required`: empty is a real answer, and it means unknown. */}
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
               className="min-h-11 rounded-sky-md bg-surface px-3 ring-1 ring-border/70" />
        <span className="text-xs text-muted">{copy.undatedNew}</span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">{copy.columns.expenses}</span>
        <input type="text" inputMode="decimal" required value={cost} placeholder="0,00"
               onChange={(e) => setCost(e.target.value)}
               className="min-h-11 rounded-sky-md bg-surface px-3 tabular-nums ring-1 ring-border/70" />
      </label>

      <FigureDraft lines={lines} catalog={catalog} onChange={setLines} disabled={pending} />

      {/*
        One line, three numbers, and it only appears once there is something
        to count. `Marktwert` and `Faktor` are the two figures the owner
        judges a parcel by, so they belong beside the figures rather than on
        the next screen.
      */}
      {units > 0 ? (
        <div className="flex flex-col gap-0.5">
          <p className="text-sm tabular-nums">
            {figures.units(units)}
            {" · "}
            {figures.marketValue}{" "}
            {value.knownItems === 0 ? figures.noMarketValue : formatPrice(value.knownValue)}
            {" · "}
            {figures.factor}{" "}
            {value.percent === null
              ? "—"
              : `${value.percent.toLocaleString("de-AT", { maximumFractionDigits: 1 })} %`}
          </p>
          {value.unknownItems > 0 ? (
            <p className="text-xs text-muted">{figures.missingPrices(value.unknownItems)}</p>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted">{figures.emptyAllowed}</p>
      )}

      {/* Quieter than the figure workflow on purpose: it is a short
          operational remark, not the substance of the purchase. */}
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Notiz</span>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)}
               className="min-h-11 rounded-sky-md bg-surface px-3 text-sm ring-1 ring-border/70 sm:min-h-9" />
      </label>

      {/*
        One checkbox, unticked. The normal case must not get slower because a
        rare one exists, so it is a single line with its consequence spelt out
        beside it rather than a mode the form has to be put into.
      */}
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={isTest} onChange={(e) => setIsTest(e.target.checked)}
               className="mt-1 size-4" />
        <span className="text-sm">
          {copy.testFlag}
          <span className="block text-xs text-muted">{copy.testFlagHint}</span>
        </span>
      </label>

      {/* Said before the button, not after the surprise. */}
      <p className="text-xs text-muted">{copy.createStockHint}</p>
      <button type="submit" disabled={pending} className={`${ACTION_PRIMARY} min-h-11 w-auto disabled:opacity-60`}>
        {copy.newPurchase}
      </button>
    </form>
  );
}
