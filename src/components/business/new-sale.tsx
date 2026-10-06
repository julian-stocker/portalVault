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
 * WAS EIN DRUCK AUF „ANLEGEN" AUSLÖST: EIN ATOMARER SCHRITT UND EIN
 * OPTIONALER ZWEITER.
 *
 * Erster Schritt, unverändert atomar: `seller_create_sale_with_details`
 * schreibt den Verkauf, seine Positionen, seine Gebühren und seine
 * Korrekturen in EINER Transaktion. Sie stehen oder fallen gemeinsam. Das
 * ist der Weg, der die alte Lücke geschlossen hat — früher entstand erst der
 * Verkauf, dann in einem zweiten Aufruf die Beträge, und Gebühren und
 * Auszahlung waren danach in Details nachzutragen.
 *
 * Zweiter Schritt, nur falls ein Erstattungsbetrag eingetragen wurde: eine
 * RÜCKERSTATTUNG, über `seller_add_sale_refund`. Sie gehört in
 * `sale_refunds` und nicht in `sale_fees` — zurückgegebenes Geld ist keine
 * Gebühr des Kanals —, und die Anlage-Funktion hat keinen Parameter dafür.
 *
 * SCHLÄGT NUR DER ZWEITE SCHRITT FEHL, BLEIBT DER VERKAUF BESTEHEN, und die
 * Oberfläche behandelt das ausdrücklich als PARTIELLEN ERFOLG: sie leitet
 * nicht weiter, sagt „angelegt, Rückerstattung nicht gespeichert", sperrt
 * den Absende-Knopf (ein zweiter Druck legte einen zweiten Verkauf an) und
 * verlinkt den bestehenden Verkauf zum Nachtragen. Kein automatischer
 * zweiter Versuch — er könnte doppelt erstatten.
 *
 * DAS DATUM IST PFLICHT. Nicht, weil die Spalte es verlangt (0059 lässt
 * `sold_at` bewusst null, für die undatierten Zeilen der Arbeitsmappe),
 * sondern weil ein neu getippter Verkauf ohne Datum ein Versehen ist: er
 * landet im Verkaufsbuch unter „ohne Datum" und fehlt in jeder Monatssumme.
 * Geprüft wird im Formular UND in der Server Action.
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
 * DAS ANLEGEN BERÜHRT DAS LAGER — ALS RESERVIERUNG, NICHT ALS ABGANG (0110).
 *
 * Der genaue Vertrag, Spalte für Spalte:
 *
 *   `reserved`   STEIGT. Pro Katalogposition, für die eine lose Einheit frei
 *                ist, entsteht ein External Hold (`order_reservations` mit
 *                `sale_item_id`). Die Figur verschwindet damit sofort aus
 *                `shop_offers()` — sie ist verkauft, nur noch nicht gepackt.
 *                Ist nichts frei, entsteht die Position trotzdem, dann ohne
 *                Reservierung.
 *   `quantity`   UNVERÄNDERT. Das Paket wird oft vor dem Packen erfasst.
 *                `Ausbuchen` an der einzelnen Position ist weiterhin die
 *                eine Handlung, die den Bestand senkt, und sie schreibt die
 *                `inventory_movements`-Zeile dazu.
 *
 * Eine Position ohne `sky_id` ist von beidem ausgenommen: kein Hold, keine
 * mögliche Bewegung (siehe unten). Der erklärende Satz für den Betreiber
 * steht neben der Positionsliste, wo der beschriebene Knopf ist, und nicht
 * hier unter dem Absende-Knopf.
 *
 * UND MANCHES IST KEINE FIGUR. Ein Portal, ein Spiel, ein Restposten gehört
 * zum Verkauf und zum Geld, aber in keinen Figurenkatalog. Findet die Suche
 * nichts, übernimmt sie den getippten Namen als `raw_name` ohne `sky_id` —
 * ohne Lagerbezug, ohne Reservierung, und per CHECK ohne jede Möglichkeit
 * einer Lagerbewegung. Siehe `free-items.ts`.
 */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";

import { ACTION_PRIMARY } from "@/components/ui/action";
import { PendingButton } from "@/components/ui/pending";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import { createSaleWithDetails } from "@/lib/orderbook/sales-actions";
import {
  MAX_DRAFT_UNITS, draftPayload, draftUnitCount, type DraftLine,
} from "@/lib/orderbook/draft";
import {
  addFreeItem, freeItemCount, freeItemPayload, type FreeItemLine,
} from "@/lib/orderbook/free-items";
import type { FigureChoice } from "@/lib/orderbook/figure-search";
import { parseMoney, parseSignedMoney } from "@/lib/orderbook/sales-money";
import {
  SALE_COST_TYPES, SALE_TEMPLATES, extraFee, feeFromType, initialFees,
  initialRefunds, invalidFees, invalidRefunds, refundAmounts, refundDraft, saleFormMoney,
  saleTemplate, unlabelledFees, type FeeDraft, type RefundDraft, type SettledBy,
} from "@/lib/orderbook/sale-template";
import { FigureDraft } from "./figure-draft";
import { FreeItems } from "./free-items";
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
  /*
   * Positionen ohne Katalogzuordnung, getrennt von den Figuren gehalten.
   *
   * Ein `DraftLine` ist über seine SKY-ID identifiziert; diese hier haben
   * keine und bekommen auch keine erfundene. Siehe `free-items.ts`.
   */
  const [freeLines, setFreeLines] = useState<FreeItemLine[]>([]);
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
  /*
   * Die Rückerstattungszeilen. EIGENER ZUSTAND, und das ist der Punkt: so
   * kann keine von ihnen versehentlich in `p_fees` geraten. Sie stehen
   * trotzdem in derselben Liste wie die Gebühren, weil der Betreiber sie in
   * derselben Arbeit eintippt.
   */
  const [refunds, setRefunds] = useState<RefundDraft[]>(
    () => initialRefunds(saleTemplate("ebay"), (n) => `initR${n}`));
  /* Offen, während der Betreiber eine Kostenart wählt. */
  const [feeMenuOpen, setFeeMenuOpen] = useState(false);
  const [adjustment, setAdjustment] = useState("");
  const [adjustmentNote, setAdjustmentNote] = useState("");
  const [isTest, setIsTest] = useState(defaultTest);
  const [error, setError] = useState<string | null>(null);
  /*
   * Der Verkauf steht, die Rückerstattung nicht.
   *
   * Dann wird NICHT weitergeleitet: die Meldung muss gelesen werden, und der
   * Knopf muss gesperrt sein — ein zweiter Druck würde einen zweiten Verkauf
   * anlegen, nicht die fehlende Erstattung nachtragen.
   */
  const [partial, setPartial] = useState<number | null>(null);
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
    /* Dieselbe Regel für die Erstattungszeile: eingetippt bleibt stehen. */
    const keptRefunds = refunds.filter((r) => r.amount.trim() !== "");
    setRefunds(keptRefunds.length > 0
      ? keptRefunds
      : initialRefunds(saleTemplate(id), () => key()));
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
    /* Der Verkauf existiert schon — ein zweiter Druck legt keinen zweiten an. */
    if (partial !== null) return;

    /*
     * DAS DATUM ZUERST, UND AUCH HIER.
     *
     * Das Feld trägt `required`, also kommt ein leeres Datum normalerweise
     * nicht bis hierher. „Normalerweise" ist kein Verlass: die Prüfung steht
     * trotzdem, weil sie der deutsche Satz ist (die Browserblase ist der des
     * Browsers), und die eigentliche Sperre liegt ohnehin im Server —
     * `createSaleWithDetails` weist einen Verkauf ohne Datum ab.
     */
    if (soldAt.trim() === "") { setError(create.dateRequired); return; }

    // Validation still parses each field on its own, because the operator has
    // to be told which one is wrong — `saleFormMoney` coerces to keep the live
    // panel usable while typing, and that is the right behaviour for a display
    // and the wrong one for a save.
    if ([subtotal, shipping, discount].some((v) => parseMoney(v) === null)) {
      setError(create.invalidAmount); return;
    }
    /*
     * Figuren UND freie Positionen zählen gegen dieselbe Obergrenze: `p_items`
     * nimmt 200 Elemente, und `addFigure` kennt nur seine eigene Hälfte. Die
     * Summe ist deshalb hier zu prüfen — sonst käme als Antwort ein
     * `program_limit_exceeded` aus der Datenbank statt eines Satzes.
     */
    if (draftUnitCount(lines) + freeItemCount(freeLines) > MAX_DRAFT_UNITS) {
      setError(de.business.orderbook.figures.limit(MAX_DRAFT_UNITS)); return;
    }
    if (invalidFees(fees).length > 0) { setError(create.invalidAmount); return; }
    if (unlabelledFees(fees).length > 0) { setError(create.feeNeedsLabel); return; }
    if (invalidRefunds(refunds).length > 0) { setError(create.invalidAmount); return; }
    if (parseSignedMoney(adjustment) === null) { setError(create.invalidAmount); return; }

    startTransition(async () => {
      const created = await createSaleWithDetails({
        channel: template.channel,
        soldAt: soldAt.trim(),
        country: country.trim().toUpperCase() || null,
        reference: reference.trim() || null,
        buyer: buyer.trim() || null,
        note: note.trim() || null,
        isTest,
        // Exactly what the panel showed — the same object, not a second build.
        subtotal: money.subtotal, shipping: money.shipping, discount: money.discount,
        /*
         * Figuren und freie Positionen, ein Element pro physischem Stück.
         * Eine freie Position trägt `raw_name` und KEIN `sky_id`-Feld — die
         * Reservierung in `seller_add_sale_item` greift deshalb nicht, und
         * eine Lagerbewegung ist für sie per CHECK unmöglich.
         */
        items: [...draftPayload(lines), ...freeItemPayload(freeLines)],
        fees: money.fees,
        /*
         * Rückerstattungen gehen NICHT in `p_fees`. Sie werden nach dem
         * Anlegen über `seller_add_sale_refund` geschrieben; schlägt das
         * fehl, bleibt der Verkauf bestehen und sagt das auch.
         */
        refunds: refundAmounts(refunds),
        adjustments: money.adjustments,
      });
      if (!created.ok) { setError(created.message); return; }
      if (created.refund === "failed") { setPartial(created.id); return; }
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
        TEILERFOLG. Der Verkauf steht, die Rückerstattung nicht — und das
        Formular bleibt stehen, statt weiterzuleiten, damit dieser Satz
        gelesen wird. Der Weg nach vorn ist der Link: dort trägt der
        Betreiber die Erstattung am bestehenden Verkauf nach. Automatisch
        wird nichts wiederholt.
      */}
      {partial !== null ? (
        <div role="alert"
             className="flex flex-col gap-1 rounded-sky-md bg-surface px-3 py-2 text-sm ring-1 ring-border-strong">
          <p>{create.refundFailed}</p>
          <Link href={`/business/orderbuch/verkauf?verkauf=${partial}`}
                className="self-start text-xs underline underline-offset-2">
            {create.openCreatedSale}
          </Link>
        </div>
      ) : null}

      {/*
        1. WHAT THE SALE IS. Date and channel first, because the channel
        decides which fields the rest of the form even shows. The three
        optional identifiers sit under them, quieter, in one row.
      */}
      <FormSection title={create.sections.sale}>
        <FieldRow>
          <Field label={create.date}>
            {/* `required` ist die unmittelbare Rückmeldung; der verbindliche
                Satz steht in `submit`, und die eigentliche Sperre im
                Server. Bestehende undatierte Verkäufe sind davon nicht
                betroffen — hier wird nur ANGELEGT. */}
            <input type="date" value={soldAt} onChange={(e) => setSoldAt(e.target.value)}
                   required aria-required="true"
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

      {/*
        2. Figures — the same picker the Einkauf uses, plus the one thing the
        Einkauf solves elsewhere: a position that is not in the catalog at
        all. The search offers the typed name when it found nothing, and the
        result lands in its own list below the figures (`FreeItems`), because
        it has neither a series nor a market value and is not a Lagerposition.
      */}
      <FormSection title={create.sections.figures}>
        <FigureDraft lines={lines} catalog={catalog} onChange={setLines} disabled={pending}
                     onFree={(name) => setFreeLines((f) =>
                       addFreeItem(f, name, key(),
                                   MAX_DRAFT_UNITS - draftUnitCount(lines) - freeItemCount(f)))}>
          <FreeItems lines={freeLines} disabled={pending} onChange={setFreeLines}
                     budget={MAX_DRAFT_UNITS - draftUnitCount(lines)} />
        </FigureDraft>
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

          {/*
            DIE RÜCKERSTATTUNGSZEILE — gleiches Raster, andere Tabelle.

            Sie steht hier, weil der Betreiber sie in derselben Arbeit
            eintippt wie die Gebühren, und sie trägt bewusst KEINEN
            „Abgezogen von"-Schalter: eine Erstattung mindert nicht, was der
            Kanal einbehält. Die dritte Zelle bleibt deshalb leer statt zu
            verschwinden — sonst rutschte das × in die Spalte des Schalters
            und die Zeilen stünden nicht mehr untereinander.
          */}
          {refunds.map((refund) => (
            <li key={refund.key}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_auto_auto]">
              <span className="col-span-3 min-w-0 truncate text-sm sm:col-span-1"
                    title={create.refundHint}>
                {create.refundLabel}
              </span>
              <input value={refund.amount} inputMode="decimal" disabled={pending}
                     aria-label={create.refundLabel}
                     onChange={(e) => setRefunds((r) => r.map((x) =>
                       x.key === refund.key ? { ...x, amount: e.target.value } : x))}
                     className={`${MONEY} w-24 shrink-0 sm:w-full`} />
              <span aria-hidden="true" />
              <button type="button" disabled={pending}
                      aria-label={create.feeRemove(create.refundLabel)}
                      onClick={() => setRefunds((r) => r.filter((x) => x.key !== refund.key))}
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
            <ul aria-label={create.costTypeHeading}
                className="flex flex-col gap-1 rounded-sky-md p-2 ring-1 ring-border/70">
              {SALE_COST_TYPES.map((type) => (
                <li key={type.id}>
                  {/* `storage` entscheidet, in welche der beiden Listen die
                      Zeile geht — und damit in welche Tabelle sie später
                      geschrieben wird. Kein `if` auf einen Namen. */}
                  <button type="button" disabled={pending}
                          onClick={() => {
                            if (type.storage === "refund") {
                              const row = refundDraft(key());
                              setRefunds((r) => [...r, row]);
                            } else {
                              const row = feeFromType(key(), type.id);
                              setFees((f) => [...f, row]);
                            }
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

      {/*
        Nach einem Teilerfolg GESPERRT: der Verkauf existiert, und ein
        zweiter Druck würde einen zweiten anlegen statt die fehlende
        Rückerstattung nachzutragen.
      */}
      <PendingButton type="submit" pending={pending} disabled={partial !== null}
              pendingLabel={de.pending.saving}
              className={`${ACTION_PRIMARY} min-h-11 w-full gap-2 disabled:opacity-60 sm:w-auto sm:self-start`}>
        {create.submit}
        {draftUnitCount(lines) > 0
          ? ` · ${de.business.orderbook.figures.units(draftUnitCount(lines))}`
          : ""}
        {/* Freie Positionen sind keine Figuren und werden deshalb auch nicht
            als solche gezählt. */}
        {freeItemCount(freeLines) > 0
          ? ` · ${de.business.orderbook.figures.freeUnits(freeItemCount(freeLines))}`
          : ""}
      </PendingButton>
    </form>
  );
}
