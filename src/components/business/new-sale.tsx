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
  SALE_TEMPLATES, extraFee, initialFees, invalidFees, saleFormMoney,
  saleTemplate, unlabelledFees, type FeeDraft, type SettledBy,
} from "@/lib/orderbook/sale-template";
import { FigureDraft } from "./figure-draft";

const copy = de.business.sales;
const create = copy.create;

const INPUT = "min-h-11 w-full rounded-sky-md bg-surface px-3 text-sm ring-1 ring-border/70";
const MONEY = `ob-money ${INPUT} text-right tabular-nums`;

function Row({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

/** A section heading that costs one line, not a card. */
function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-1 text-sm font-medium">{children}</h2>;
}

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
      router.push(`/business/orderbuch/verkauf/${created.id}`);
    });
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
      <p className="text-sm text-muted">{create.hint}</p>

      {error ? (
        <p role="alert" className="rounded-sky-md bg-surface px-3 py-2 text-sm ring-1 ring-border/70">
          {error}
        </p>
      ) : null}

      {/* 1. Template. First, because it decides what the rest looks like. */}
      <Row label={create.template} hint={create.templateHint}>
        <select value={templateId} onChange={(e) => chooseTemplate(e.target.value)}
                disabled={pending} className={INPUT}>
          {SALE_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>{create.templateNames[t.id]}</option>
          ))}
        </select>
      </Row>

      {/* 2. Date and who it went to. Empty date is a real answer. */}
      <Row label={create.date} hint={create.dateHint}>
        <input type="date" value={soldAt} onChange={(e) => setSoldAt(e.target.value)}
               disabled={pending} className={INPUT} />
      </Row>
      <div className="grid grid-cols-2 gap-3">
        <Row label={create.country}>
          <input value={country} maxLength={2} disabled={pending}
                 onChange={(e) => setCountry(e.target.value.toUpperCase())}
                 className={`${INPUT} uppercase`} />
        </Row>
        <Row label={create.buyer}>
          <input value={buyer} onChange={(e) => setBuyer(e.target.value)}
                 disabled={pending} className={INPUT} />
        </Row>
      </div>
      <Row label={create.reference}>
        <input value={reference} onChange={(e) => setReference(e.target.value)}
               disabled={pending} className={INPUT} />
      </Row>

      {/* 3. Figures — the same picker the Einkauf uses. */}
      <FigureDraft lines={lines} catalog={catalog} onChange={setLines}
                   disabled={pending} hint={create.figuresHint} />

      {/* 4. What came in. */}
      <Heading>{create.incomeHeading}</Heading>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Row label={create.subtotalLabel}>
          <input value={subtotal} inputMode="decimal" disabled={pending}
                 onChange={(e) => setSubtotal(e.target.value)} className={MONEY} />
        </Row>
        <Row label={create.shippingLabel}>
          <input value={shipping} inputMode="decimal" disabled={pending}
                 onChange={(e) => setShipping(e.target.value)} className={MONEY} />
        </Row>
        {template.showsDiscount ? (
          <Row label={create.discountLabel}>
            <input value={discount} inputMode="decimal" disabled={pending}
                   onChange={(e) => setDiscount(e.target.value)} className={MONEY} />
          </Row>
        ) : null}
      </div>

      {/* 5. What it cost. Several rows, because a settlement has several. */}
      <Heading>{create.costHeading}</Heading>
      <ul className="flex flex-col gap-2">
        {fees.map((fee) => (
          <li key={fee.key} className="flex flex-wrap items-center gap-2">
            {fee.kind === "other" ? (
              <input value={fee.label} placeholder={create.feeLabelPlaceholder} disabled={pending}
                     onChange={(e) => setFees((f) => f.map((x) =>
                       x.key === fee.key ? { ...x, label: e.target.value } : x))}
                     className={`${INPUT} min-w-0 flex-1`} />
            ) : (
              <span className="min-w-0 flex-1 truncate text-sm">{fee.label}</span>
            )}
            <input value={fee.amount} inputMode="decimal" disabled={pending}
                   aria-label={fee.label || create.feeAddLabel}
                   onChange={(e) => setFees((f) => f.map((x) =>
                     x.key === fee.key ? { ...x, amount: e.target.value } : x))}
                   className={`${MONEY} w-24 shrink-0`} />
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
      <div className="flex flex-wrap items-center gap-x-4">
        <button type="button" disabled={pending}
                onClick={() => { const row = extraFee(key(), ""); setFees((f) => [...f, row]); }}
                className="min-h-11 text-xs text-muted underline underline-offset-2 sm:min-h-8">
          {create.feeAdd}
        </button>
        <span className="text-xs text-muted">{create.settledHint}</span>
      </div>

      {template.showsAdjustment ? (
        <div className="grid grid-cols-2 gap-3">
          <Row label={create.adjustment} hint={create.adjustmentHint}>
            <input value={adjustment} inputMode="decimal" disabled={pending}
                   onChange={(e) => setAdjustment(e.target.value)} className={MONEY} />
          </Row>
          <Row label={create.note}>
            <input value={adjustmentNote} disabled={pending}
                   onChange={(e) => setAdjustmentNote(e.target.value)} className={INPUT} />
          </Row>
        </div>
      ) : null}

      {/*
        6. The payout, computed (ADR-0095).

        One figure, by the same formula the historical import used — there is
        no second number to type in and nothing to reconcile it against. It
        moves the moment any amount above it does.
      */}
      <div className="rounded-sky-lg bg-surface/60 p-3 ring-1 ring-border/70">
        <dl className="flex items-baseline justify-between gap-3 text-sm">
          <dt className="text-muted">{create.expectedPayout}</dt>
          <dd className="ob-money tabular-nums">{formatPrice(money.payout)}</dd>
        </dl>
        <p className="mt-2 text-xs text-muted">{create.payoutHint}</p>
      </div>

      {/* 8. Note and classification. */}
      <Row label={create.note}>
        <input value={note} onChange={(e) => setNote(e.target.value)}
               disabled={pending} className={INPUT} />
      </Row>
      <label className="flex items-start gap-2">
        <input type="checkbox" checked={isTest} disabled={pending}
               onChange={(e) => setIsTest(e.target.checked)} className="mt-1 size-4" />
        <span className="text-sm">
          {create.testFlag}
          <span className="block text-xs text-muted">{create.testFlagHint}</span>
        </span>
      </label>

      {/* Said before the button, not after the surprise. */}
      <p className="text-xs text-muted">{create.stockHint}</p>

      <button type="submit" disabled={pending}
              className={`${ACTION_PRIMARY} min-h-11 disabled:opacity-60`}>
        {create.submit}
        {draftUnitCount(lines) > 0
          ? ` · ${de.business.orderbook.figures.units(draftUnitCount(lines))}`
          : ""}
      </button>
    </form>
  );
}
