"use client";

/**
 * Was ein Einkauf gekostet hat, und wo er herkam (0115/0116).
 *
 * DAS GEGENSTÜCK ZU `sale-details.tsx`, und absichtlich dieselbe Form: ein
 * `Modal`, Abschnitte mit `Label  Wert`-Zeilen, ein `Bearbeiten`-Schalter,
 * der die Eingabefelder erst auf Zuruf zeigt. Wer das Verkaufsfenster kennt,
 * kennt dieses.
 *
 * NICHTS WIRD NACHGERECHNET, was die Datenbank schon weiß — `factor`,
 * `knownValue` und die Zähler kommen aus `seller_orderbook_ledger()`. Was
 * hier gerechnet wird, ist die Vorschau der Gesamtsumme BEIM TIPPEN, und
 * dafür dieselbe Funktion, die den Wert danach speichert (`purchaseCosts`).
 *
 * `total_cost` BLEIBT DIE AUTORITÄT. Die drei Kostenfelder sind eine
 * Aufteilung daneben, und `purchases_cost_split_adds_up` lehnt eine ab, die
 * nicht aufgeht — deshalb zeigt dieses Fenster die Summe schon beim Tippen
 * und sagt es, bevor der Server es sagen muss.
 */
import { useId, useState } from "react";

import { Modal } from "@/components/ui/modal";
import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import { swapPurchaseDailyIndex, updatePurchase } from "@/lib/orderbook/actions";
import type { LedgerRow } from "@/lib/orderbook/ledger";
import { purchaseCosts } from "@/lib/orderbook/purchase-money";
import {
  PAYMENT_METHODS, PURCHASE_TEMPLATES, type PaymentMethod, type PurchasePlatform,
} from "@/lib/orderbook/purchase-template";

const copy = de.business.orderbook;
const modal = copy.detailsModal;

const formatDate = (iso: string | null): string =>
  iso === null ? copy.undated
    : new Date(iso).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });

/** Eine `Label  Wert`-Zeile. Wortgleich mit dem Verkaufsfenster. */
function Line({ label, value, hint, strong }: {
  label: string; value: string; hint?: string | null; strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-0.5">
      <span className={strong ? "text-sm font-medium" : "text-sm text-muted"}>
        {label}
        {hint ? <span className="ml-2 text-xs text-muted">{hint}</span> : null}
      </span>
      <span className={`ob-money tabular-nums ${strong ? "text-sm font-medium" : "text-sm"}`}>
        {value}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border/50 px-4 py-3 first:border-t-0">
      <h3 className="mb-1 text-xs uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-baseline justify-between gap-4 py-0.5 text-sm">
      <span className="text-muted">{label}</span>
      {children}
    </label>
  );
}

const INPUT = "min-h-9 rounded-sky-md bg-surface px-2 text-sm ring-1 ring-border/70";
const BUTTON = "min-h-9 rounded-sky-md px-3 text-xs ring-1 ring-border/70 disabled:opacity-50";

export function PurchaseDetails({ purchase, dayOrder, open, onClose, onSaved }: {
  purchase: LedgerRow;
  /**
   * Die belegten Plätze dieses Tages, aus `seller_purchase()`.
   *
   * Leer, solange die Zeile nicht geladen ist — dann fehlt nur das
   * Tausch-Auswahlfeld, nicht das Fenster.
   */
  dayOrder: readonly { id: number; dailyIndex: number }[];
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const headingId = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * Bearbeiten ist freiwillig. Die normale Ansicht bleibt eine Aufstellung,
   * die man lesen kann; die Felder erscheinen erst, wenn der Betreiber sagt,
   * dass er etwas korrigiert. Dieselbe Entscheidung wie im Verkaufsfenster.
   */
  const [editing, setEditing] = useState(false);
  const [swapped, setSwapped] = useState<number | null>(null);

  const [draft, setDraft] = useState(() => ({
    purchasedAt: purchase.purchasedAt ?? "",
    platform: purchase.platform ?? "",
    seller: purchase.sellerName ?? "",
    reference: purchase.externalRef ?? "",
    note: purchase.note ?? "",
    payment: purchase.paymentMethod ?? "",
    /*
     * DIE AUFTEILUNG ALS TEXT, und bei Altdaten leer.
     *
     * Ein Einkauf von vor `0115` trägt keine Aufteilung. Sie hier mit
     * `total_cost` vorzubelegen wäre eine Erfindung — es würde behaupten,
     * der ganze Betrag sei Figurenpreis gewesen, und das weiß niemand.
     */
    items: purchase.itemsCost === null ? "" : String(purchase.itemsCost).replace(".", ","),
    shipping: purchase.shippingCost === null ? "" : String(purchase.shippingCost).replace(".", ","),
    protection: purchase.buyerProtectionCost === null
      ? "" : String(purchase.buyerProtectionCost).replace(".", ","),
  }));

  /* Die Summe beim Tippen — aus derselben Funktion, die danach speichert. */
  const typed = purchaseCosts({
    items: draft.items, shipping: draft.shipping, buyerProtection: draft.protection,
  });
  const hasSplit = draft.items.trim() !== "";
  const split = purchase.itemsCost !== null;
  const endings = purchase.damagedCount + purchase.missingCount;

  async function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    setSaving(true);
    setError(null);
    const result = await action();
    setSaving(false);
    if (!result.ok) { setError(result.message ?? null); return false; }
    onSaved();
    return true;
  }

  /**
   * EIN SPEICHERN, EIN SCHREIBVORGANG.
   *
   * `seller_update_purchase` nimmt alles in einer Anweisung. Zwei Aufrufe
   * hintereinander wären zwei Transaktionen und zwei Gelegenheiten, einen
   * halb korrigierten Einkauf zu hinterlassen — dieselbe Lehre wie bei
   * `seller_update_sale` in `0091`.
   *
   * Die Gesamtsumme wird aus den Teilen GERECHNET, nicht getippt: so kann sie
   * nicht neben ihrer eigenen Aufteilung landen, und der CHECK in der
   * Datenbank hat nichts abzulehnen.
   */
  async function save() {
    const wantedDate = draft.purchasedAt.trim() === "" ? undefined : draft.purchasedAt.trim();
    /*
     * EIN GELEERTES DATUMSFELD IST KEIN ERFOLG.
     *
     * `seller_update_purchase` liest NULL als „unverändert lassen" — eine
     * Konvention, die dieses Schema überall hat. Für ein geleertes Feld heisst
     * das: die RPC tut nichts, meldet aber Erfolg, und das Fenster schliesst
     * mit dem alten Datum darin. Das ist genau die stille Nichtänderung, die
     * sich wie eine Änderung anfühlt.
     *
     * Also hier abgefangen, BEVOR geschrieben wird, und mit einem Satz. Ein
     * Datum zu ÄNDERN bleibt davon unberührt: dann ist `wantedDate` gesetzt.
     * Den Weg zum echten Entfernen öffnet erst ein `p_clear_date` in der
     * Server-Funktion — Vorschlag für 0117, hier absichtlich nicht vorweg
     * genommen.
     */
    if (wantedDate === undefined && purchase.purchasedAt !== null) {
      setError(modal.dateNotRemovable);
      return;
    }
    await run(() => updatePurchase(
      purchase.id,
      wantedDate,
      hasSplit ? typed.total : undefined,
      draft.note,
      {
        platform: draft.platform.trim() === "" ? undefined : draft.platform.trim(),
        sellerName: draft.seller.trim(),
        paymentMethod: draft.payment.trim() === "" ? undefined : draft.payment.trim(),
        externalRef: draft.reference.trim(),
        ...(hasSplit
          ? { items: typed.items, shipping: typed.shipping, buyerProtection: typed.buyerProtection }
          : {}),
      },
    ));
  }

  /* Tauschen heißt tauschen: der Einkauf auf dem Zielplatz bekommt diesen. */
  async function swapPlace(place: number) {
    setSaving(true);
    setError(null);
    const result = await swapPurchaseDailyIndex(purchase.id, place);
    setSaving(false);
    if (!result.ok) { setError(result.message); return; }
    setSwapped(result.dailyIndex);
    onSaved();
  }

  const platformName = (id: string | null): string =>
    id === null ? "—"
      : modal.platformNames[id as PurchasePlatform] ?? id;
  const paymentName = (id: string | null): string =>
    id === null ? "—"
      : modal.paymentNames[id as PaymentMethod] ?? id;

  return (
    <Modal open={open} onClose={onClose} labelledBy={headingId} size="lg">
      <div className="flex items-baseline justify-between gap-4 px-4 pt-4 pb-1">
        <h2 id={headingId} className="text-base font-semibold">{modal.title}</h2>
        <div className="flex items-center gap-2">
          {/*
            Eine Arbeitsmappenzeile wird nicht bearbeitet. `seller_update_purchase`
            würde es annehmen, aber ihre Zahlen sind die der Excel-Historie —
            ein Knopf, der sie überschreibbar aussehen lässt, ist eine
            Einladung. Dieselbe Zurückhaltung wie bei `isHistorical` auf der
            Detailseite.
          */}
          {purchase.source === "excel_order_2026" ? null : (
            <button type="button" onClick={() => setEditing((on) => !on)}
                    aria-pressed={editing}
                    className={`min-h-9 rounded-sky-md px-2 text-xs ring-1 ${
                      editing ? "bg-surface font-medium ring-fg/40" : "text-muted ring-border/70 hover:text-fg"}`}>
              {editing ? modal.done : modal.edit}
            </button>
          )}
          <button type="button" onClick={onClose}
                  className="min-h-9 rounded-sky-md px-2 text-xs text-muted ring-1 ring-border/70 hover:text-fg">
            {modal.close}
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mx-4 mb-1 rounded-sky-md bg-surface px-3 py-2 text-xs text-danger ring-1 ring-border/70">
          {error}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title={modal.purchase}>
          <Line label={copy.columns.date} value={formatDate(purchase.purchasedAt)} />
          {/*
            DER PLATZ AM TAG (0115). Immer sichtbar, sobald ein Datum da ist —
            auch wenn der Einkauf der einzige ist. Eine Zahl, die nur bei
            mehreren erscheint, liest sich als Fehler, wenn sie fehlt.
          */}
          <Line label={modal.dailyIndex}
                value={purchase.dailyIndex === null ? modal.dailyIndexNone
                  : dayOrder.length <= 1 ? modal.dailyIndexAlone
                    : modal.dailyIndexOf(purchase.dailyIndex, dayOrder.length)} />
          <Line label={modal.platform} value={platformName(purchase.platform)} />
          <Line label={modal.seller} value={purchase.sellerName ?? "—"} />
          <Line label={modal.payment} value={paymentName(purchase.paymentMethod)} />
          {purchase.externalRef
            ? <Line label={modal.reference} value={purchase.externalRef} /> : null}
          {purchase.note ? <Line label={modal.note} value={purchase.note} /> : null}

          {/* Getauscht wird nur, wo es einen Partner gibt. */}
          {purchase.dailyIndex !== null && dayOrder.length > 1 ? (
            <>
              <Field label={modal.swapPlace}>
                <select value="" disabled={saving}
                        onChange={(e) => {
                          const place = Number(e.target.value);
                          if (Number.isFinite(place) && place > 0) void swapPlace(place);
                        }}
                        className={`${INPUT} w-28`}>
                  <option value="">—</option>
                  {dayOrder.filter((row) => row.id !== purchase.id).map((row) => (
                    <option key={row.id} value={row.dailyIndex}>{row.dailyIndex}</option>
                  ))}
                </select>
              </Field>
              <p className="mt-1 text-xs text-muted">{modal.swapPlaceHint}</p>
            </>
          ) : null}
          {swapped !== null ? (
            <p role="status" className="mt-1 text-xs text-muted">
              {modal.swapPlaceDone(swapped)}
            </p>
          ) : null}
        </Section>

        <Section title={modal.costs}>
          {/*
            DIE AUFTEILUNG, ODER DER EHRLICHE HINWEIS, DASS ES KEINE GIBT.

            Für jeden Einkauf von vor `0115` ist sie unbekannt. Sie aus
            `total_cost` zu erfinden hiesse behaupten, der ganze Betrag sei
            Figurenpreis gewesen — und das weiss niemand.
          */}
          {split ? (
            <>
              <Line label={modal.itemsCost} value={formatPrice(purchase.itemsCost ?? 0)} />
              <Line label={modal.shippingCost} value={formatPrice(purchase.shippingCost ?? 0)} />
              <Line label={modal.buyerProtectionCost}
                    value={formatPrice(purchase.buyerProtectionCost ?? 0)} />
            </>
          ) : (
            <p className="mb-1 text-xs text-muted">{modal.noSplit}</p>
          )}
          <Line label={modal.totalCost} value={formatPrice(purchase.totalCost)} strong />
          <Line label={copy.columns.marketValue} value={formatPrice(purchase.knownValue)} />
          <Line label={copy.columns.factor}
                value={purchase.factor === null ? "—"
                  : purchase.factor.toLocaleString("de-AT",
                      { minimumFractionDigits: 2, maximumFractionDigits: 2 })} />
          {/*
            WARUM DER FAKTOR SO AUSSIEHT. Eine beschädigte oder fehlende
            Position zählt 0 EUR (D4), die Kosten bleiben vollständig — ohne
            diesen Satz sieht der Betreiber einen gestiegenen Faktor und
            keinen Grund dafür.
          */}
          <p className="mt-1 text-xs text-muted">
            {modal.factorHint(purchase.damagedCount, purchase.missingCount)}
          </p>
          {endings + purchase.showcaseCount > 0 ? (
            <Line label={modal.endings}
                  value={modal.endingsLine(purchase.damagedCount, purchase.missingCount,
                                           purchase.showcaseCount)} />
          ) : null}
        </Section>

        {editing ? (
          <Section title={modal.edit}>
            <Field label={copy.columns.date}>
              {/* Leer heisst „Datum nicht bekannt" — kein Platzhalter, keine Vermutung. */}
              <input type="date" value={draft.purchasedAt} disabled={saving}
                     onChange={(e) => setDraft({ ...draft, purchasedAt: e.target.value })}
                     className={`${INPUT} w-40`} />
            </Field>
            <Field label={modal.platform}>
              <select value={draft.platform} disabled={saving}
                      onChange={(e) => setDraft({ ...draft, platform: e.target.value })}
                      className={`${INPUT} w-44`}>
                <option value="">—</option>
                {PURCHASE_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.platform}>{modal.platformNames[t.id]}</option>
                ))}
              </select>
            </Field>
            <Field label={modal.seller}>
              {/* Roh gespeichert (Regel 4) und ohne Wörterbuch: ein
                  Marktplatz-Benutzername ist kein Tippfehler. */}
              <input value={draft.seller} disabled={saving} maxLength={120}
                     placeholder={modal.sellerPlaceholder}
                     autoCorrect="off" autoCapitalize="off" spellCheck={false}
                     autoComplete="off"
                     onChange={(e) => setDraft({ ...draft, seller: e.target.value })}
                     className={`${INPUT} w-56`} />
            </Field>
            <Field label={modal.payment}>
              <select value={draft.payment} disabled={saving}
                      onChange={(e) => setDraft({ ...draft, payment: e.target.value })}
                      className={`${INPUT} w-44`}>
                <option value="">—</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>{modal.paymentNames[m]}</option>
                ))}
              </select>
            </Field>
            <Field label={modal.reference}>
              <input value={draft.reference} disabled={saving} maxLength={120}
                     placeholder={modal.referencePlaceholder}
                     autoCorrect="off" autoCapitalize="off" spellCheck={false}
                     autoComplete="off"
                     onChange={(e) => setDraft({ ...draft, reference: e.target.value })}
                     className={`${INPUT} w-56`} />
            </Field>
            <Field label={modal.note}>
              <input value={draft.note} disabled={saving} maxLength={500}
                     onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                     className={`${INPUT} w-56`} />
            </Field>

            <div className="mt-2 border-t border-border/40 pt-2">
              <p className="mb-1 text-xs text-muted">{modal.splitHint}</p>
              <Field label={modal.itemsCost}>
                <input type="text" inputMode="decimal" value={draft.items} disabled={saving}
                       placeholder="0,00"
                       onChange={(e) => setDraft({ ...draft, items: e.target.value })}
                       className={`${INPUT} w-28 text-right`} />
              </Field>
              <Field label={modal.shippingCost}>
                <input type="text" inputMode="decimal" value={draft.shipping} disabled={saving}
                       placeholder="0,00"
                       onChange={(e) => setDraft({ ...draft, shipping: e.target.value })}
                       className={`${INPUT} w-28 text-right`} />
              </Field>
              <Field label={modal.buyerProtectionCost}>
                <input type="text" inputMode="decimal" value={draft.protection} disabled={saving}
                       placeholder="0,00"
                       onChange={(e) => setDraft({ ...draft, protection: e.target.value })}
                       className={`${INPUT} w-28 text-right`} />
              </Field>
              {/*
                DIE SUMME BEIM TIPPEN, aus derselben Funktion, die sie
                danach speichert. Der CHECK in der Datenbank kann so nichts
                mehr ablehnen, was hier nicht schon zu sehen war.
              */}
              {hasSplit ? (
                <Line label={modal.totalCost} value={formatPrice(typed.total)} strong />
              ) : (
                <p className="mt-1 text-xs text-muted">{modal.noSplit}</p>
              )}
              {/* Die Aufteilung wieder wegräumen — was NULL nicht ausdrücken kann. */}
              {split ? (
                <button type="button" disabled={saving}
                        onClick={() => void run(() => updatePurchase(
                          purchase.id, undefined, undefined, undefined,
                          { clearCostSplit: true }))}
                        className={`${BUTTON} mt-2`}>
                  {modal.clearSplit}
                </button>
              ) : null}
            </div>

            <div className="mt-3 flex items-center gap-2 border-t border-border/40 pt-2">
              <button type="button" disabled={saving} onClick={() => void save()}
                      className={BUTTON}>
                {modal.save}
              </button>
            </div>
          </Section>
        ) : null}
      </div>
    </Modal>
  );
}
