/**
 * Creating a purchase, figures and all (ADR-0088, ADR-0091, erweitert 0115/0116).
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
 * WAS 0115/0116 HINZUFÜGT: DER KOPF DES EINKAUFS.
 *
 * Bisher war ein Einkauf Datum, Betrag und Notiz. Erfasst wird jetzt auch,
 * WO gekauft wurde (`platform`), BEI WEM (`seller_name`), WIE bezahlt wurde
 * (`payment_method`), unter welcher Anzeigen- oder Bestellnummer
 * (`external_ref`) — und die Kosten in ihren drei Teilen (Entscheidung D9):
 *
 *     Gesamtkosten = Kaufpreis + Versand + Käuferschutz
 *
 * DIE VORLAGE IST LAYOUT, NICHT SPEICHER — dieselbe Regel wie bei
 * `sale-template.ts`. „Vorlage: Kleinanzeigen" entscheidet, ob das
 * Käuferschutzfeld offen steht und welche Zahlungsart vorbelegt ist. Jeder
 * Wert landet trotzdem in den Spalten aus `0115`; es gibt keine
 * Kleinanzeigen-Tabelle und keine Kleinanzeigen-Spalte.
 *
 * UND DIE SUMME FOLGT DEN TEILEN, NICHT UMGEKEHRT. `purchaseCosts` rundet
 * erst die Teile und addiert dann — genau wie `purchases_cost_split_adds_up`
 * in der Datenbank rechnet. Eine andere Reihenfolge wäre einen Cent daneben,
 * und der CHECK würde den ganzen Einkauf ablehnen.
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
import { useMemo, useRef, useState, useTransition } from "react";

import { ACTION_PRIMARY } from "@/components/ui/action";
import { PendingButton } from "@/components/ui/pending";
import { formatPrice } from "@/lib/format";
import { rangedNumber } from "@/lib/format-number";
import { de } from "@/lib/i18n/de";
import { createPurchaseWithItems } from "@/lib/orderbook/actions";
import { draftUnitCount, MAX_DRAFT_UNITS } from "@/lib/orderbook/draft";
import type { FigureChoice } from "@/lib/orderbook/figure-search";
import {
  purchaseDateProblem, type PurchaseDateProblem,
} from "@/lib/orderbook/purchase-date-rule";
import {
  PURCHASE_DRAFT_STATES, newDraftToken, purchaseDraftPayload, purchaseDraftStateCounts,
  purchaseDraftValue, type PurchaseDraftLine,
} from "@/lib/orderbook/purchase-draft";
import { purchaseCosts } from "@/lib/orderbook/purchase-money";
import {
  DEFAULT_PURCHASE_TEMPLATE, PAYMENT_METHODS, PURCHASE_TEMPLATES,
  purchaseTemplate, type PaymentMethod,
} from "@/lib/orderbook/purchase-template";
import { parseMoney } from "@/lib/orderbook/sales-money";
import { Field, FieldRow, FormSection, INPUT, MONEY, QuietRow } from "./form-section";
import { PurchaseDraftList } from "./purchase-draft-list";

const copy = de.business.orderbook;
const figures = copy.figures;
const errors = copy.errors;

/*
 * DAS DATUMSFELD IN ZWEI FASSUNGEN, NICHT ALS ANGEHÄNGTE KLASSE.
 *
 * `INPUT` bringt `ring-1 ring-border/70` mit. Ein `ring-danger` dahinter zu
 * hängen würde zwei Utilities für dieselbe CSS-Eigenschaft in einem Element
 * stapeln, und wer von beiden gewinnt, entscheidet die Reihenfolge im
 * erzeugten Stylesheet — nicht die im Attribut. Zwei vollständige Fassungen
 * sind zwei Zeilen und haben kein „meistens".
 */
const DATE_BASE = "min-h-11 w-full rounded-sky-md bg-surface px-3 text-sm sm:min-h-9";
const DATE_OK = `${DATE_BASE} ring-1 ring-border/70`;
const DATE_BAD = `${DATE_BASE} ring-2 ring-danger`;
/*
 * Die Nomen des Einkaufskopfes stehen EINMAL — im Detailfenster, wo sie
 * zuerst gebraucht wurden. „Plattform" im Formular und „Plattform" im
 * Fenster sind dasselbe Wort über dieselbe Spalte; zwei Schlüssel dafür
 * wären zwei Stellen, an denen es auseinanderlaufen kann.
 */
const field = copy.detailsModal;

export function NewPurchase({ defaultTest = false, catalog = [] }: {
  /** Arrives as `?test=1` when the form was opened from the Test view. */
  defaultTest?: boolean;
  /** The canonical catalog, shipped once with the page. */
  catalog?: readonly FigureChoice[];
}) {
  const router = useRouter();

  const [templateId, setTemplateId] = useState<string>(DEFAULT_PURCHASE_TEMPLATE);
  const template = purchaseTemplate(templateId);

  const [date, setDate] = useState("");
  const [seller, setSeller] = useState("");
  const [reference, setReference] = useState("");
  const [payment, setPayment] = useState<PaymentMethod>(
    purchaseTemplate(DEFAULT_PURCHASE_TEMPLATE).payment);
  /*
   * Hat der Betreiber die Zahlungsart selbst gewählt?
   *
   * Dann folgt sie der Vorlage nicht mehr. Eine getippte Angabe wird von
   * einem Vorlagenwechsel nicht überschrieben — dieselbe Regel, nach der
   * `chooseTemplate` im Verkaufsformular eingetragene Gebühren stehen lässt.
   */
  const [paymentChosen, setPaymentChosen] = useState(false);

  const [itemsCost, setItemsCost] = useState("");
  const [shipping, setShipping] = useState("");
  const [buyerProtection, setBuyerProtection] = useState("");
  /* Vom Betreiber geöffnet, obwohl die Vorlage keinen Käuferschutz kennt. */
  const [protectionOpen, setProtectionOpen] = useState(false);
  const showsProtection = template.opensBuyerProtection || protectionOpen;

  const [note, setNote] = useState("");
  const [isTest, setIsTest] = useState(defaultTest);
  const [lines, setLines] = useState<PurchaseDraftLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  /*
   * Die Ablehnung des Datums steht AM FELD und nicht oben bei `error`: der
   * Betreiber soll nicht suchen müssen, welches der zehn Felder gemeint ist.
   */
  const [dateProblem, setDateProblem] = useState<PurchaseDateProblem | null>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  /*
   * EINMAL BEIM ÖFFNEN, NICHT JE ABSENDEN.
   *
   * `useState` mit einer Funktion ruft sie genau einmal pro Montage. Ein
   * zweites Absenden desselben Formulars trägt damit denselben Token, und die
   * Datenbank antwortet mit dem Einkauf, den sie schon angelegt hat, statt
   * einen zweiten anzulegen. Der Wert wird nie gerendert — es gibt also auch
   * nichts, was zwischen Server und Browser auseinanderlaufen könnte.
   */
  const [draftToken] = useState(newDraftToken);
  const [pending, startTransition] = useTransition();

  /*
   * EIN Objekt, gelesen von der Anzeige UND vom Absenden.
   *
   * Zweimal gebaut wäre es die Einladung, einen Bildschirm zu zeigen, der
   * nicht zu dem passt, was gespeichert wird — derselbe Fehler, den
   * `saleFormMoney` im Verkaufsformular vermeidet.
   *
   * Ein unvollständig getippter Betrag zählt dabei als 0 statt als NaN: das
   * Feld ist noch in Arbeit, und `Faktor NaN` ist nichts, was man jemandem
   * zeigt. Abgewiesen wird er beim Absenden, mit einem Satz.
   */
  const costs = useMemo(
    () => purchaseCosts({ items: itemsCost, shipping,
                          buyerProtection: showsProtection ? buyerProtection : "" }),
    [itemsCost, shipping, buyerProtection, showsProtection],
  );

  /*
   * Live, und mit DERSELBEN Arithmetik, die die Datenbank verwendet —
   * `draftValue` ruft `valuePurchase`, und das spiegelt
   * `purchase_market_value()`. Die Zahl auf diesem Bildschirm ist die Zahl,
   * die der Einkauf im selben Moment zeigt, in dem er existiert.
   */
  /*
   * Seit 0120 mit dem ZUSTAND jeder Einheit: eine beschädigte oder fehlende
   * Position zählt 0 EUR (D4), und wer das hier unterschlägt, zeigt einen
   * Marktwert, den der gespeicherte Einkauf nicht hat.
   */
  const value = useMemo(() => purchaseDraftValue(costs.total, lines), [costs.total, lines]);
  const units = draftUnitCount(lines);

  /*
   * WAS GESPEICHERT WIRD, IN EINEM SATZ.
   *
   * Nur die Zustände, die vorkommen, und `Bestellt` nur, wenn daneben noch
   * etwas anderes steht: „7 Bestellt" allein sagt nichts, was die Stückzahl
   * am Knopf nicht schon sagt.
   */
  const stateLine = useMemo(() => {
    const counts = purchaseDraftStateCounts(lines);
    const used = PURCHASE_DRAFT_STATES.filter((state) => counts[state] > 0);
    if (used.length < 2) return null;
    return figures.stateSummary(
      used.map((state) => figures.stateCount(copy.states[state], counts[state])),
    );
  }, [lines]);

  /** Die Vorlage wechseln: Layout und Vorbelegung, niemals Getipptes. */
  function chooseTemplate(id: string) {
    setTemplateId(id);
    if (!paymentChosen) setPayment(purchaseTemplate(id).payment);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    /*
     * DAS DATUM ZUERST, UND MIT FOKUS.
     *
     * Vor jeder anderen Prüfung, damit nicht erst ein Betrag beanstandet wird
     * und das fehlende Datum danach. Der Fokus springt auf das Feld, weil ein
     * roter Rahmen weiter unten auf einem Telefon ausserhalb des Bildes liegt.
     *
     * Dieselbe Funktion, die die Server Action und — als vierte Schicht —
     * `seller_create_purchase_with_items` durchsetzen.
     */
    const problem = purchaseDateProblem(date);
    setDateProblem(problem);
    if (problem !== null) {
      dateRef.current?.focus();
      return;
    }
    /*
     * Jedes Feld für sich geprüft, nicht die Summe: der Betreiber muss
     * erfahren, WELCHER Betrag nicht gelesen werden konnte. `purchaseCosts`
     * macht aus einem kaputten Feld bewusst eine 0, damit die Anzeige beim
     * Tippen nutzbar bleibt — richtig für eine Anzeige, falsch für ein
     * Speichern.
     */
    if ([itemsCost, shipping, showsProtection ? buyerProtection : ""]
          .some((raw) => parseMoney(raw) === null)) {
      setError(copy.invalidCosts);
      return;
    }
    if (units > MAX_DRAFT_UNITS) {
      setError(figures.limit(MAX_DRAFT_UNITS));
      return;
    }
    startTransition(async () => {
      const result = await createPurchaseWithItems(
        date.trim(),
        /* Was bezahlt wurde — die Summe der drei Teile, auf den Cent. */
        costs.total,
        purchaseDraftPayload(lines), note.trim() || undefined, isTest,
        {
          platform: template.platform,
          sellerName: seller.trim() || null,
          paymentMethod: payment,
          externalRef: reference.trim() || null,
          /*
           * Die Aufteilung IMMER mitgeschrieben, und zwar vollständig:
           * `purchases_cost_split_is_whole` verlangt den Kaufpreis, sobald
           * ein Teil gesetzt ist, und ein leeres Versandfeld in einem
           * ausgefüllten Formular heisst „kein Versand" und nicht
           * „unbekannt". Unbekannt gibt es nur für die Einkäufe von vor
           * 0115, und dort steht es als NULL in der Datenbank.
           */
          items: costs.items,
          shipping: costs.shipping,
          buyerProtection: costs.buyerProtection,
          /* Derselbe Entwurf, so oft er auch abgeschickt wird. */
          clientToken: draftToken,
        },
      );
      if (!result.ok) setError(result.message);
      else router.push(`/business/orderbuch/${result.id}`);
    });
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-5 sm:gap-4">
      {error ? (
        <p role="alert" className="rounded-sky-md bg-surface px-3 py-2 text-sm ring-1 ring-border/70">{error}</p>
      ) : null}

      {/*
        1. WAS DER EINKAUF IST. Datum und Vorlage zuerst, weil die Vorlage
        entscheidet, was der Rest des Formulars überhaupt zeigt. Verkäufer,
        Zahlungsart und Referenz darunter, leiser, in einer Reihe — dieselbe
        Ordnung wie im Verkaufsformular.
      */}
      <FormSection title={copy.newSections.purchase}>
        <FieldRow>
          {/*
            PFLICHT, SEIT 0120 — und nur hier.

            Bis dahin stand an dieser Stelle „empty is a real answer, and it
            means unknown". Das galt dem Arbeitsmappen-Import, dessen dreizehn
            `#REF!`-Gruppen kein Datum tragen, und es gilt dort weiter:
            `purchases.purchased_at` bleibt nullable, der eine echte undatierte
            Einkauf bleibt erhalten und über `?jahr=ohne` auffindbar, und
            korrigieren lässt er sich wie zuvor. Wer einen Einkauf NEU erfasst,
            weiss dagegen, wann er ihn gemacht hat.
          */}
          <Field label={copy.columns.date}>
            <input ref={dateRef} type="date" required value={date}
                   onChange={(e) => {
                     setDate(e.target.value);
                     /* Beim Tippen aufhören zu schimpfen. */
                     if (dateProblem !== null) setDateProblem(null);
                   }}
                   disabled={pending}
                   aria-invalid={dateProblem === null ? undefined : true}
                   aria-describedby={dateProblem === null ? undefined : "new-purchase-date-error"}
                   className={dateProblem === null ? DATE_OK : DATE_BAD} />
            {dateProblem === null ? null : (
              <p id="new-purchase-date-error" role="alert" className="text-xs text-danger">
                {dateProblem === "required" ? errors.dateRequired : errors.dateImplausible}
              </p>
            )}
          </Field>
          <Field label={copy.newTemplate}>
            <select value={templateId} onChange={(e) => chooseTemplate(e.target.value)}
                    disabled={pending} className={INPUT}>
              {PURCHASE_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>{field.platformNames[t.id]}</option>
              ))}
            </select>
          </Field>
        </FieldRow>

        <QuietRow>
          {/* Roh gespeichert, ohne Normalisierung — Regel 4. */}
          <Field label={field.seller}>
            <input value={seller} placeholder={field.sellerPlaceholder}
                   autoCapitalize="none" autoCorrect="off" spellCheck={false}
                   onChange={(e) => setSeller(e.target.value)}
                   disabled={pending} className={INPUT} />
          </Field>
          <Field label={field.payment}>
            <select value={payment} disabled={pending}
                    onChange={(e) => {
                      setPayment(e.target.value as PaymentMethod);
                      setPaymentChosen(true);
                    }}
                    className={INPUT}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{field.paymentNames[m]}</option>
              ))}
            </select>
          </Field>
          <Field label={field.reference}>
            <input value={reference} placeholder={field.referencePlaceholder}
                   autoCapitalize="none" autoCorrect="off" spellCheck={false}
                   onChange={(e) => setReference(e.target.value)}
                   disabled={pending} className={INPUT} />
          </Field>
        </QuietRow>
      </FormSection>

      {/* 2. What was in the parcel. */}
      <FormSection title={copy.newSections.figures}>
        <PurchaseDraftList lines={lines} catalog={catalog} onChange={setLines} disabled={pending} />
      </FormSection>

      {/*
        3. WAS ES GEKOSTET HAT — in den drei Teilen aus Entscheidung D9.

        Schmale Zahlen, also drei nebeneinander, sobald Platz dafür ist. Der
        Käuferschutz steht nur dort, wo es einen gibt: Kleinanzeigen und
        Willhaben erheben einen, beim Kauf per Überweisung gibt es keinen —
        und wo er fehlt, holt ihn ein leiser Knopf, statt ihn zu verstecken.
      */}
      <FormSection title={copy.newSections.amount}>
        <FieldRow columns={3}>
          <Field label={field.itemsCost}>
            <input type="text" inputMode="decimal" value={itemsCost} placeholder="0,00"
                   onChange={(e) => setItemsCost(e.target.value)}
                   disabled={pending} className={MONEY} />
          </Field>
          <Field label={field.shippingCost}>
            <input type="text" inputMode="decimal" value={shipping} placeholder="0,00"
                   onChange={(e) => setShipping(e.target.value)}
                   disabled={pending} className={MONEY} />
          </Field>
          {showsProtection ? (
            <Field label={field.buyerProtectionCost}>
              <input type="text" inputMode="decimal" value={buyerProtection} placeholder="0,00"
                     onChange={(e) => setBuyerProtection(e.target.value)}
                     disabled={pending} className={MONEY} />
            </Field>
          ) : null}
        </FieldRow>

        {showsProtection ? null : (
          <button type="button" disabled={pending}
                  onClick={() => setProtectionOpen(true)}
                  className="min-h-11 self-start text-xs text-muted underline underline-offset-2 sm:min-h-8">
            {copy.newBuyerProtection}
          </button>
        )}
      </FormSection>

      {/*
        4. DIE GESAMTKOSTEN, und daneben die zwei Zahlen, nach denen das
        Paket beurteilt wird.

        Das eine Kästchen des Formulars — weil es die Antwort ist und nicht
        eine Frage, genau wie die Auszahlung im Verkaufsformular. `Marktwert`
        und `Faktor` bedeuten nur neben dem Preis etwas, und sie bewegen sich,
        während er getippt wird.
      */}
      <div className="rounded-sky-lg bg-surface p-3 ring-1 ring-border-strong sm:px-4 sm:py-2.5">
        <dl className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">
            {field.totalCost}
          </dt>
          <dd className="ob-money text-xl font-medium tabular-nums">{formatPrice(costs.total)}</dd>
        </dl>

        {units > 0 ? (
          <dl className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-0.5 border-t border-border/60 pt-1.5 text-sm tabular-nums">
            <div className="flex items-baseline gap-1.5">
              <dt className="text-xs text-muted">{figures.marketValue}</dt>
              <dd>{value.knownItems === 0 ? figures.noMarketValue : formatPrice(value.knownValue)}</dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="text-xs text-muted">{figures.factor}</dt>
              <dd>
                {value.percent === null
                  ? "—"
                  : `${rangedNumber(value.percent, 0, 1)} %`}
              </dd>
            </div>
            {value.unknownItems > 0 ? (
              <p className="basis-full text-xs text-muted">{figures.missingPrices(value.unknownItems)}</p>
            ) : null}
          </dl>
        ) : null}
      </div>

      {/* 5. The optional tail. Set back, not hidden. */}
      <FormSection title={copy.newSections.note}>
        {/* No second `Notiz` above the box — the heading already said it. */}
        <input type="text" value={note} aria-label={copy.newSections.note}
               onChange={(e) => setNote(e.target.value)}
               disabled={pending} className={INPUT} />

        {/*
          One checkbox, unticked. The normal case must not get slower because
          a rare one exists, so it is a single line rather than a mode the
          form has to be put into.
        */}
        <label className="flex items-center gap-2 pt-1" title={copy.testFlagHint}>
          <input type="checkbox" checked={isTest} onChange={(e) => setIsTest(e.target.checked)}
                 disabled={pending} className="size-4 shrink-0" />
          <span className="text-sm">{copy.testFlag}</span>
        </label>
      </FormSection>

      {stateLine === null ? null : (
        <p className="text-xs text-muted">{stateLine}</p>
      )}

      <PendingButton type="submit" pending={pending} pendingLabel={de.pending.saving}
              className={`${ACTION_PRIMARY} min-h-11 w-full gap-2 disabled:opacity-60 sm:w-auto sm:self-start`}>
        {copy.submitPurchase}
        {units > 0 ? ` · ${figures.units(units)}` : ""}
      </PendingButton>
    </form>
  );
}
