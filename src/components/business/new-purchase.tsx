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
import { Field, FormSection, INPUT, MONEY } from "./form-section";

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
    <form onSubmit={submit} className="mt-6 flex flex-col gap-5">
      {error ? (
        <p role="alert" className="rounded-sky-md bg-surface px-3 py-2 text-sm ring-1 ring-border/70">{error}</p>
      ) : null}

      {/* 1. What the record is. One field, because a purchase has one fact
             of its own that is not money and not figures. */}
      <FormSection title={copy.newSections.purchase}>
        <div className="sm:max-w-xs">
          {/* Not `required`: empty is a real answer, and it means unknown.
              It used to say so in a sentence underneath; an empty optional
              date field does not need one. */}
          <Field label={copy.columns.date}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                   className={INPUT} />
          </Field>
        </div>
      </FormSection>

      {/* 2. What was in the parcel. */}
      <FormSection title={copy.newSections.figures}>
        <FigureDraft lines={lines} catalog={catalog} onChange={setLines} disabled={pending} />
      </FormSection>

      {/*
        3. What it cost, with the two numbers the parcel is judged by right
        beside it — `Marktwert` and `Faktor` only mean anything next to the
        price, and they move as it is typed.
      */}
      <FormSection title={copy.newSections.amount}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_1fr] sm:items-end">
          <Field label={copy.purchasePrice}>
            <input type="text" inputMode="decimal" required value={cost} placeholder="0,00"
                   onChange={(e) => setCost(e.target.value)} className={MONEY} />
          </Field>

          {units > 0 ? (
            <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-sm tabular-nums sm:pb-2.5">
              <div className="flex items-baseline gap-1.5">
                <dt className="text-xs text-muted">{figures.marketValue}</dt>
                <dd>{value.knownItems === 0 ? figures.noMarketValue : formatPrice(value.knownValue)}</dd>
              </div>
              <div className="flex items-baseline gap-1.5">
                <dt className="text-xs text-muted">{figures.factor}</dt>
                <dd>
                  {value.percent === null
                    ? "—"
                    : `${value.percent.toLocaleString("de-AT", { maximumFractionDigits: 1 })} %`}
                </dd>
              </div>
              {value.unknownItems > 0 ? (
                <p className="basis-full text-xs text-muted">{figures.missingPrices(value.unknownItems)}</p>
              ) : null}
            </dl>
          ) : null}
        </div>
      </FormSection>

      {/* 4. The optional tail. Set back, not hidden. */}
      <FormSection title={copy.newSections.note}>
        {/* No second `Notiz` above the box — the heading already said it. */}
        <input type="text" value={note} aria-label={copy.newSections.note}
               onChange={(e) => setNote(e.target.value)} className={INPUT} />

        {/*
          One checkbox, unticked. The normal case must not get slower because
          a rare one exists, so it is a single line rather than a mode the
          form has to be put into.
        */}
        <label className="flex items-center gap-2 pt-1" title={copy.testFlagHint}>
          <input type="checkbox" checked={isTest} onChange={(e) => setIsTest(e.target.checked)}
                 className="size-4 shrink-0" />
          <span className="text-sm">{copy.testFlag}</span>
        </label>
      </FormSection>

      <button type="submit" disabled={pending}
              className={`${ACTION_PRIMARY} min-h-11 w-full disabled:opacity-60 sm:w-auto sm:self-start`}>
        {copy.submitPurchase}
        {units > 0 ? ` · ${figures.units(units)}` : ""}
      </button>
    </form>
  );
}
