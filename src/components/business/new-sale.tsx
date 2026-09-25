/**
 * Creating an external sale by hand (ADR-0089, extended ADR-0092).
 *
 * WHAT THIS IS AND IS NOT FOR
 *
 * eBay and anything else sold away from SkyIsles. It cannot create an internal
 * sale, and not only because the form does not offer `skyisles`:
 * `seller_create_sale` refuses that channel outright. An internal sale exists
 * because an order was paid, never because somebody typed it.
 *
 * THE TEMPLATE IS LAYOUT, NOT STORAGE. `Vorlage: eBay` decides which inputs
 * appear, what they are called and which fee rows the form opens with. Every
 * value still lands in the structures that have existed since `0059`:
 * `sales.items_subtotal` / `shipping_charged` / `discount_amount`,
 * `sale_fees` with its `kind` and `settled_by`, `settlement_adjustments`,
 * and `sales.reported_payout_amount`. There is no eBay table and no eBay
 * column — see `sale-template.ts`.
 *
 * ONE PRESS, ONE TRANSACTION. This used to create the sale, then send the
 * amounts in a second call, and leave the fees and the payout to be typed
 * into Details afterwards. Its own comment admitted the hole: "a failure on
 * the second step leaves a sale to correct in Details". That is now
 * `seller_create_sale_with_details`, and a failure anywhere leaves nothing.
 *
 * THE PAYOUT IS COMPUTED BY THE IMPORTER'S OWN FUNCTION. `saleFormMoney`
 * calls `payoutView`, which calls `plannedPayout` — what reconstructed 292
 * workbook sales. So the figure on this screen is the figure the historical
 * reconciliation used and the one `sale_expected_payout()` will report the
 * moment the sale exists. Nothing recomputes a payout in a component.
 *
 * AND THE PANEL AND THE PAYLOAD ARE THE SAME OBJECT. They were built
 * separately at first, which is how a screen ends up showing a
 * reconciliation that the saved sale does not match.
 *
 * CREATING A SALE IS NOT A STOCK MOVEMENT. The parcel is often recorded
 * before it is packed. This writes a sale, its money and its items and
 * touches no inventory at all — `Ausbuchen`, on the individual item, is the
 * one action that does, and the screen says so before the form is submitted.
 */
"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";

import { ACTION_PRIMARY } from "@/components/ui/action";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import { createSaleWithDetails } from "@/lib/orderbook/sales-actions";
import { draftPayload, draftUnitCount, type DraftLine } from "@/lib/orderbook/draft";
import type { FigureChoice } from "@/lib/orderbook/figure-search";
import { parseMoney, parseSignedMoney } from "@/lib/orderbook/sales-money";
import {
  SALE_FEE_TYPES, SALE_TEMPLATES, extraFee, feeFromType, initialFees, invalidFees,
  saleFormMoney, saleTemplate, unlabelledFees, type FeeDraft, type SettledBy,
} from "@/lib/orderbook/sale-template";
import { FigureDraft } from "./figure-draft";
import { Field, FieldRow, FormSection, INPUT, MONEY, QuietRow } from "./form-section";

const copy = de.business.sales;
const create = copy.create;

/**
 * The switch that decides whether a cost reduces the payout.
 *
 * Two buttons rather than a select: it has exactly two states, both need to
 * be readable at a glance while reconciling, and a native select on a phone
 * opens a wheel for a binary choice.
 */
function SettledToggle({ value, onChange, disabled, name }: {
  value: SettledBy; onChange: (next: SettledBy) => void; disabled: boolean; name: string;
}) {
  return (
    <span className="flex shrink-0 gap-1" role="group" aria-label={`${create.settledBy}: ${name}`}>
      {(["channel", "external"] as const).map((mode) => (
        <button key={mode} type="button" disabled={disabled}
                aria-pressed={value === mode}
                onClick={() => onChange(mode)}
                className={`min-h-11 rounded-sky-md px-2 text-xs ring-1 disabled:opacity-50 sm:min-h-8 ${
                  value === mode ? "bg-surface font-medium ring-fg/40" : "text-muted ring-border/70"
                }`}>
          {mode === "channel" ? create.settledChannel : create.settledExternal}
        </button>
      ))}
    </span>
  );
}

export function NewSale({ defaultTest = false, catalog = [] }: {
  /** Arrives as `?test=1` when the form was opened from the Test view. */
  defaultTest?: boolean;
  catalog?: readonly FigureChoice[];
}) {
  const router = useRouter();
  const nextKey = useRef(0);
  const key = () => `f${nextKey.current++}`;

  const [templateId, setTemplateId] = useState("ebay");
  const template = saleTemplate(templateId);

  const [soldAt, setSoldAt] = useState("");
  const [country, setCountry] = useState("DE");
  const [buyer, setBuyer] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [subtotal, setSubtotal] = useState("");
  const [shipping, setShipping] = useState("");
  const [discount, setDiscount] = useState("");
  /*
   * The opening rows get their own key space, so the lazy initialiser never
   * has to touch the counter — reading a ref during render is a real rule
   * violation, not a lint opinion, and under concurrent rendering the
   * initialiser may run more than once.
   */
  const [fees, setFees] = useState<FeeDraft[]>(
    () => initialFees(saleTemplate("ebay"), (n) => `init${n}`));
  /* Offen, während der Betreiber eine Gebührenart wählt. */
  const [feeMenuOpen, setFeeMenuOpen] = useState(false);
  const [adjustment, setAdjustment] = useState("");
  const [adjustmentNote, setAdjustmentNote] = useState("");
  const [isTest, setIsTest] = useState(defaultTest);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /*
   * Switching template REPLACES the suggested rows but keeps anything typed.
   * A row with an amount in it is the operator's work, not the template's
   * furniture, so it survives — losing an entered fee because somebody
   * looked at the other layout would be the worst kind of data loss: silent.
   */
  function chooseTemplate(id: string) {
    setTemplateId(id);
    // Computed here rather than inside the updater: `key()` moves a ref, and
    // an updater may be replayed. An event handler runs exactly once.
    const kept = fees.filter((f) => f.amount.trim() !== "");
    const suggested = initialFees(saleTemplate(id), () => key())
      .filter((s) => !kept.some((k) => k.kind === s.kind && k.settledBy === s.settledBy));
    setFees([...kept, ...suggested]);
  }

  /*
   * ONE object, read by the panel below AND by the submit handler. Building
   * it twice is how a screen comes to show a reconciliation that the saved
   * sale does not match.
   */
  const money = useMemo(
    () => saleFormMoney({ subtotal, shipping, discount, fees, adjustment, adjustmentNote }),
    [subtotal, shipping, discount, fees, adjustment, adjustmentNote],
  );

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // Validation still parses each field on its own, because the operator has
    // to be told which one is wrong — `saleFormMoney` coerces to keep the live
    // panel usable while typing, and that is the right behaviour for a display
    // and the wrong one for a save.
    if ([subtotal, shipping, discount].some((v) => parseMoney(v) === null)) {
      setError(create.invalidAmount); return;
    }
    if (invalidFees(fees).length > 0) { setError(create.invalidAmount); return; }
    if (unlabelledFees(fees).length > 0) { setError(create.feeNeedsLabel); return; }
    if (parseSignedMoney(adjustment) === null) { setError(create.invalidAmount); return; }

    startTransition(async () => {
      const created = await createSaleWithDetails({
        channel: template.channel,
        soldAt: soldAt.trim() || null,
        country: country.trim().toUpperCase() || null,
        reference: reference.trim() || null,
        buyer: buyer.trim() || null,
        note: note.trim() || null,
        isTest,
        // Exactly what the panel showed — the same object, not a second build.
        subtotal: money.subtotal, shipping: money.shipping, discount: money.discount,
        items: draftPayload(lines),
        fees: money.fees,
        adjustments: money.adjustments,
      });
      if (!created.ok) { setError(created.message); return; }
      /*
       * ZURÜCK INS VERKAUFSBUCH, NICHT AUF EINE EIGENE SEITE.
       *
       * Der neue Verkauf wird dort sofort geöffnet — aufgeklappt mit seinen
       * Positionen und im bestehenden Bearbeitungsfenster. Alles, was danach
       * kommt (verschicken, stornieren, Gebühren nachtragen), passiert
       * ohnehin hier; eine zweite Detailoberfläche dafür wäre eine zweite
       * Oberfläche für denselben Zweck. `/verkauf/[id]` bleibt für
       * Direktaufrufe erreichbar.
       */
      router.push(`/business/orderbuch/verkauf?verkauf=${created.id}`);
    });
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-5 sm:gap-4">
      {error ? (
        <p role="alert" className="rounded-sky-md bg-surface px-3 py-2 text-sm ring-1 ring-border/70">
          {error}
        </p>
      ) : null}

      {/*
        1. WHAT THE SALE IS. Date and channel first, because the channel
        decides which fields the rest of the form even shows. The three
        optional identifiers sit under them, quieter, in one row.
      */}
      <FormSection title={create.sections.sale}>
        <FieldRow>
          <Field label={create.date}>
            <input type="date" value={soldAt} onChange={(e) => setSoldAt(e.target.value)}
                   disabled={pending} className={INPUT} />
          </Field>
          <Field label={create.channel}>
            <select value={templateId} onChange={(e) => chooseTemplate(e.target.value)}
                    disabled={pending} className={INPUT}>
              {SALE_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>{create.templateNames[t.id]}</option>
              ))}
            </select>
          </Field>
        </FieldRow>

        <QuietRow>
          <Field label={create.reference}>
            <input value={reference} onChange={(e) => setReference(e.target.value)}
                   disabled={pending} className={INPUT} />
          </Field>
          <Field label={create.buyer}>
            <input value={buyer} onChange={(e) => setBuyer(e.target.value)}
                   disabled={pending} className={INPUT} />
          </Field>
          <Field label={create.country}>
            <input value={country} maxLength={2} disabled={pending}
                   onChange={(e) => setCountry(e.target.value.toUpperCase())}
                   className={`${INPUT} uppercase`} />
          </Field>
        </QuietRow>
      </FormSection>

      {/* 2. Figures — the same picker the Einkauf uses. */}
      <FormSection title={create.sections.figures}>
        <FigureDraft lines={lines} catalog={catalog} onChange={setLines} disabled={pending} />
      </FormSection>

      {/* 3. What came in. Three narrow numbers, so three abreast once there
             is room for them. */}
      <FormSection title={create.sections.amounts}>
        <FieldRow columns={3}>
          <Field label={create.subtotalLabel}>
            <input value={subtotal} inputMode="decimal" disabled={pending}
                   onChange={(e) => setSubtotal(e.target.value)} className={MONEY} />
          </Field>
          <Field label={create.shippingLabel}>
            <input value={shipping} inputMode="decimal" disabled={pending}
                   onChange={(e) => setShipping(e.target.value)} className={MONEY} />
          </Field>
          {template.showsDiscount ? (
            <Field label={create.discountLabel}>
              <input value={discount} inputMode="decimal" disabled={pending}
                     onChange={(e) => setDiscount(e.target.value)} className={MONEY} />
            </Field>
          ) : null}
        </FieldRow>
      </FormSection>

      {/*
        4. WHAT IT COST.

        One fee is four controls — name, amount, who kept it, remove — and
        four controls do not fit across a 360px screen. So the row is a grid
        that stacks: the name takes the first line on a phone, the amount and
        the two-state switch share the second, and the remove button stays a
        44px target at the end of it. At `sm:` the four sit on one line, as
        they did.
      */}
      <FormSection title={create.sections.costs}>
        <ul className="flex flex-col gap-3 sm:gap-1.5">
          {fees.map((fee) => (
            <li key={fee.key}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_auto_auto]">
              {fee.kind === "other" ? (
                <input value={fee.label} placeholder={create.feeLabelPlaceholder} disabled={pending}
                       onChange={(e) => setFees((f) => f.map((x) =>
                         x.key === fee.key ? { ...x, label: e.target.value } : x))}
                       className={`${INPUT} col-span-3 min-w-0 sm:col-span-1`} />
              ) : (
                <span className="col-span-3 min-w-0 truncate text-sm sm:col-span-1">{fee.label}</span>
              )}
              <input value={fee.amount} inputMode="decimal" disabled={pending}
                     aria-label={fee.label || create.feeAddLabel}
                     onChange={(e) => setFees((f) => f.map((x) =>
                       x.key === fee.key ? { ...x, amount: e.target.value } : x))}
                     className={`${MONEY} w-24 shrink-0 sm:w-full`} />
              <SettledToggle value={fee.settledBy} disabled={pending} name={fee.label}
                             onChange={(next) => setFees((f) => f.map((x) =>
                               x.key === fee.key ? { ...x, settledBy: next } : x))} />
              <button type="button" disabled={pending}
                      aria-label={create.feeRemove(fee.label || create.feeAddLabel)}
                      onClick={() => setFees((f) => f.filter((x) => x.key !== fee.key))}
                      className="flex size-11 shrink-0 items-center justify-center rounded-sky-md text-sm ring-1 ring-border/70 hover:ring-fg/30 disabled:opacity-40 sm:size-8">
                ×
              </button>
            </li>
          ))}
        </ul>

        {/*
          „+ Gebühr" — die Arten, die ein Marktplatz tatsächlich abrechnet.
          Kein Auswahlfeld in der Zeile, sondern eine Auswahl VOR der Zeile:
          die Art bestimmt Name, Verrechnungskategorie und die Vorgabe für
          „Kanal"; danach ist es eine gewöhnliche Gebührenzeile wie jede
          andere — Betrag, Schalter, ×.
        */}
        <div className="flex flex-col gap-2 self-start">
          <div className="flex flex-wrap items-center gap-4">
            <button type="button" disabled={pending} aria-expanded={feeMenuOpen}
                    onClick={() => setFeeMenuOpen((open) => !open)}
                    className="min-h-11 text-xs text-muted underline underline-offset-2 sm:min-h-8">
              {create.feeAddFee}
            </button>
            <button type="button" disabled={pending}
                    onClick={() => { const row = extraFee(key(), ""); setFees((f) => [...f, row]); }}
                    className="min-h-11 text-xs text-muted underline underline-offset-2 sm:min-h-8">
              {create.feeAdd}
            </button>
          </div>

          {feeMenuOpen ? (
            <ul aria-label={create.feeTypeHeading}
                className="flex flex-col gap-1 rounded-sky-md p-2 ring-1 ring-border/70">
              {SALE_FEE_TYPES.map((type) => (
                <li key={type.id}>
                  <button type="button" disabled={pending}
                          onClick={() => {
                            const row = feeFromType(key(), type.id);
                            setFees((f) => [...f, row]);
                            setFeeMenuOpen(false);
                          }}
                          className="min-h-11 w-full rounded-sky-sm px-2 text-left text-sm hover:bg-fg/5 sm:min-h-9">
                    {create.feeTypes[type.id as keyof typeof create.feeTypes] ?? type.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {template.showsAdjustment ? (
          <FieldRow>
            <Field label={create.adjustment}>
              <input value={adjustment} inputMode="decimal" disabled={pending}
                     onChange={(e) => setAdjustment(e.target.value)} className={MONEY} />
            </Field>
            <Field label={create.note}>
              <input value={adjustmentNote} disabled={pending}
                     onChange={(e) => setAdjustmentNote(e.target.value)} className={INPUT} />
            </Field>
          </FieldRow>
        ) : null}
      </FormSection>

      {/*
        5. THE PAYOUT (ADR-0095).

        One figure, by the same formula the historical import used. It is the
        only boxed thing in the form because it is the answer rather than a
        question, and it is large because it is what the operator checks the
        statement against. Three lines explaining the formula used to sit
        under it; the number moves when any amount above it does, which
        teaches the formula faster than the sentence did.
      */}
      <div className="rounded-sky-lg bg-surface p-3 ring-1 ring-border-strong sm:px-4 sm:py-2.5">
        <dl className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">
            {create.sections.payout}
          </dt>
          <dd className="ob-money text-xl font-medium tabular-nums">{formatPrice(money.payout)}</dd>
        </dl>
      </div>

      {/* 6. The optional tail. */}
      <FormSection title={create.sections.note}>
        <input value={note} aria-label={create.sections.note}
               onChange={(e) => setNote(e.target.value)}
               disabled={pending} className={INPUT} />
        <label className="flex items-center gap-2 pt-1" title={create.testFlagHint}>
          <input type="checkbox" checked={isTest} disabled={pending}
                 onChange={(e) => setIsTest(e.target.checked)} className="size-4 shrink-0" />
          <span className="text-sm">{create.testFlag}</span>
        </label>
      </FormSection>

      <button type="submit" disabled={pending}
              className={`${ACTION_PRIMARY} min-h-11 w-full disabled:opacity-60 sm:w-auto sm:self-start`}>
        {create.submit}
        {draftUnitCount(lines) > 0
          ? ` · ${de.business.orderbook.figures.units(draftUnitCount(lines))}`
          : ""}
      </button>
    </form>
  );
}
