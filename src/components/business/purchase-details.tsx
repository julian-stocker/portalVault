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
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Modal } from "@/components/ui/modal";
import {
  PurchaseItemReadHead, PurchaseItemReadRow,
} from "./purchase-item-table";
import { FigureSearch } from "./figure-search";
import {
  addFigure, dropNew, dropSwap, emptyEdit, isDirty, needsReceiptConfirm,
  savePayload, stageRows, stagedCount, swapFigure, toggleRemove,
  type PendingEdit, type StagedRow,
} from "@/lib/orderbook/purchase-item-edit";
import {
  processBookPurchaseItem, processPurchaseItemSky, processUnbookPurchaseItem,
  type PurchaseItemResult,
} from "@/lib/orderbook/actions";
/*
 * Der Katalog kommt von der Verkaufsseite her — dieselbe Funktion, derselbe
 * Katalog, und sie lädt ihn erst beim Hineingreifen. Ihn als Prop der
 * Orderbuchseite zu holen hiesse, 605 Preiszeilen über 64 KB bei JEDEM
 * Seitenaufruf zu versenden, für ein Werkzeug am Rand.
 */
import { loadOrderbookFigures } from "@/lib/orderbook/sales-actions";
import {
  confirmPurchaseReceiptDownload, issuePurchaseReceipt, issuePurchaseReceiptCorrection,
  loadPurchaseReceipt, loadPurchaseReceiptHistory,
  type ReceiptState, type ReceiptVersion,
} from "@/lib/business/receipt-actions";
import { RECEIPT_ISSUANCE_RELEASED } from "@/lib/business/receipt-release";
import { canBook, canRemapItem, isHistorical } from "@/lib/orderbook/purchase";
import { dispatchItemAction } from "@/lib/orderbook/dispatch-lock";
import type { FigureChoice } from "@/lib/orderbook/figure-search";
import type { PurchaseItem } from "@/lib/orderbook/queries";
import { formatPrice } from "@/lib/format";
import { fixedNumber } from "@/lib/format-number";
import { de } from "@/lib/i18n/de";
import {
  loadPurchaseRecord, savePurchaseEdit, swapPurchaseDailyIndex, updatePurchase,
  type PurchaseRecord,
} from "@/lib/orderbook/actions";
import type { LedgerRow } from "@/lib/orderbook/ledger";
import { purchaseCosts } from "@/lib/orderbook/purchase-money";
import {
  PAYMENT_METHODS, PURCHASE_TEMPLATES, type PaymentMethod, type PurchasePlatform,
} from "@/lib/orderbook/purchase-template";

const copy = de.business.orderbook;
const modal = copy.detailsModal;
const receiptCopy = copy.receipt;

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
    /*
     * `flex-wrap`: auf einem schmalen Bildschirm rutscht das Feld unter seine
     * Beschriftung, statt die Zeile zu sprengen. In der Ansicht ohne
     * Bearbeitung ändert das nichts — dort steht rechts nur Text.
     */
    <label className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-0.5 text-sm">
      <span className="text-muted">{label}</span>
      {children}
    </label>
  );
}

const INPUT =
  "min-h-9 max-w-full rounded-sky-md bg-surface px-2 text-sm ring-1 ring-border/70";
/** Mehrzeilig, sonst wie `INPUT` — für die Vereinbarung und die Inseratsangaben. */
const AREA =
  "min-h-20 w-full rounded-sky-md bg-surface px-2 py-1.5 text-sm ring-1 ring-border/70";
/**
 * Die Form, die `purchases_listing_url_shape` verlangt: http oder https, dann
 * etwas, und kein Leerraum. KEINE Prüfung, ob das Inserat existiert — die
 * kann es nicht geben, Inserate werden geändert und gelöscht. Es ist ein
 * Riegel gegen alles, was keine Webadresse ist und in einem `href`
 * gefährlich würde.
 */
const LISTING_URL = /^https?:\/\/\S+$/;
const BUTTON = "min-h-9 rounded-sky-md px-3 text-xs ring-1 ring-border/70 disabled:opacity-50";
/**
 * Die kompakte Aktion in der 4,5rem-Spur — ein Wort oder ein Zeichen.
 *
 * Eine Klasse für alle drei, damit „Ändern", „Einbuchen" und „Zurücknehmen"
 * dieselbe Höhe und denselben Rahmen haben. `px-2` statt `px-3`: mit zwei
 * Zeichen nebeneinander sind es 3,45rem in einer Spur von 4,5rem.
 */
const ACTION =
  "min-h-9 rounded-sky-md px-2 text-xs text-muted ring-1 ring-border/70 "
  + "hover:text-fg disabled:opacity-50";


/**
 * Die Figurenliste im BEARBEITEN-Modus (0126).
 *
 * Eine Aktion je Zeile, und die Zeile bleibt stehen. Was der Betreiber hier
 * tut, ist noch nicht passiert: eine vorgemerkte Zeile wird durchgestrichen
 * und blass, eine neue bekommt die Marke „Neu". Erst `Speichern` schickt den
 * Unterschied, `Abbrechen` wirft ihn weg.
 *
 * WARUM NICHT VERSCHWINDEN LASSEN. Eine Zeile zu entfernen, die noch da ist,
 * wäre eine Behauptung über einen Zustand, den der Server nicht kennt — und
 * nach einem Abbrechen wäre sie unerklärlich wieder da.
 *
 * WO KEIN PAPIERKORB STEHT, STEHT DER GRUND. Eine eingebuchte Figur besitzt
 * eine Lagerbewegung; eine Arbeitsmappenzeile trägt Herkunft, die kein
 * Importer wiederherstellt. `canRemoveItem` entscheidet, und
 * `seller_remove_purchase_item` entscheidet es noch einmal.
 */
function PurchaseItemEditList({
  rows, busy, catalog, swapping,
  onToggleRemove, onDropNew, onDropSwap, onOpenSwap, onSwap,
}: {
  rows: StagedRow[];
  busy: boolean;
  catalog: FigureChoice[] | null;
  swapping: number | null;
  onToggleRemove: (itemId: number) => void;
  onDropNew: (tempId: string) => void;
  onDropSwap: (itemId: number) => void;
  onOpenSwap: (itemId: number) => void;
  onSwap: (itemId: number, current: string | null, choice: FigureChoice) => void;
}) {
  return (
    <ul className="-mx-4 divide-y divide-border/40">
      {rows.map((row) => {
        if (row.kind === "new") {
          return (
            <li key={row.figure.tempId}
                className="flex items-baseline gap-2 px-4 py-2">
              <span className="flex-1 truncate text-sm">{row.figure.label}</span>
              {/* Die Marke, nicht die Farbe: sie trägt auch in Graustufen. */}
              <span className="rounded-sky-md px-1.5 text-xs text-emerald-400 ring-1 ring-emerald-400/40">
                {modal.markedNew}
              </span>
              <button type="button" disabled={busy}
                      aria-label={modal.dropNewFigure}
                      title={modal.dropNewFigure}
                      onClick={() => onDropNew(row.figure.tempId)}
                      className={ACTION}>
                <span aria-hidden="true">{copy.errors.trashIcon}</span>
              </button>
            </li>
          );
        }
        const { item, removed, mayRemove, maySwap, swap } = row;
        /*
         * EINGEBUCHT ODER ARBEITSMAPPE — ZWEI VERSCHIEDENE SÄTZE.
         *
         * Eingebucht sperrt BEIDES: `canRemapItem` und `canRemoveItem` sind
         * dann falsch. Die Arbeitsmappe sperrt nur das Entfernen — ändern
         * darf man sie, das ist der Zweck von `0054`.
         */
        const isBooked = item.movementId !== null || item.state === "booked";
        const blocked = isBooked ? modal.swapBlockedBooked : modal.removeBlockedLegacy;
        const offen = swapping === item.id;
        return (
          <li key={item.id}
              className={`px-4 py-2${removed ? " opacity-50" : ""}`}>
            <div className="flex items-baseline gap-2">
              <span className={`flex-1 truncate text-sm${
                removed ? " line-through" : ""}`}>
                {/* Der neue Name steht da, sobald ein Wechsel vorgemerkt ist. */}
                {swap === null ? item.name : swap.label}
              </span>
              {removed ? (
                <>
                  <span className="text-xs text-muted">{modal.markedRemoved}</span>
                  <button type="button" disabled={busy}
                          aria-label={modal.undoRemove}
                          title={modal.undoRemove}
                          onClick={() => onToggleRemove(item.id)}
                          className={ACTION}>
                    <span aria-hidden="true">{copy.errors.unbookIcon}</span>
                  </button>
                </>
              ) : swap !== null ? (
                <>
                  <span className="rounded-sky-md px-1.5 text-xs text-amber-400 ring-1 ring-amber-400/40">
                    {modal.markedSwapped}
                  </span>
                  <button type="button" disabled={busy}
                          aria-label={modal.undoSwap}
                          title={modal.undoSwap}
                          onClick={() => onDropSwap(item.id)}
                          className={ACTION}>
                    <span aria-hidden="true">{copy.errors.unbookIcon}</span>
                  </button>
                </>
              ) : maySwap || mayRemove ? (
                <>
                  {maySwap ? (
                    <button type="button" disabled={busy}
                            aria-expanded={offen}
                            aria-label={modal.swapFigureOne(item.name)}
                            title={modal.swapFigure}
                            onClick={() => onOpenSwap(item.id)}
                            className={ACTION}>
                      <span aria-hidden="true">{copy.errors.swapIcon}</span>
                    </button>
                  ) : null}
                  {mayRemove ? (
                    <button type="button" disabled={busy}
                            aria-label={modal.removeFigure}
                            title={modal.removeFigure}
                            onClick={() => onToggleRemove(item.id)}
                            className={ACTION}>
                      <span aria-hidden="true">{copy.errors.trashIcon}</span>
                    </button>
                  ) : (
                    /* Änderbar, aber nicht entfernbar — der Satz sagt, warum. */
                    <span className="text-xs text-muted">{modal.removeBlockedLegacy}</span>
                  )}
                </>
              ) : (
                /*
                 * KEIN KNOPF, SONDERN EIN SATZ. Eine Handlung, die immer
                 * abgelehnt würde, ist schlimmer als eine fehlende — und der
                 * Grund ist das, was der Betreiber als nächstes braucht.
                 */
                <span className="text-xs text-muted">{blocked}</span>
              )}
            </div>
            {/*
              DIE TAUSCHSUCHE UNTER DER ZEILE, mit dem heutigen Namen als
              Ausgangspunkt — dieselbe Komponente, die „Ändern" im Lesemodus
              und „+ Figur hinzufügen" benutzen.
            */}
            {offen && !removed ? (
              <div className="mt-2">
                <FigureSearch
                  catalog={catalog ?? []}
                  autoFocus
                  disabled={busy}
                  loading={catalog === null}
                  initialQuery={item.name}
                  label={modal.swapFigureOne(item.name)}
                  onCancel={() => onOpenSwap(item.id)}
                  onSelect={(choice) => onSwap(item.id, item.skyId, choice)} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Der Entwurf, aus der Zeile gebaut.
 *
 * Als Funktion und nicht als Startwert im `useState`, weil „Abbrechen"
 * denselben Stand wiederherstellen muss, den „Bearbeiten" vorgefunden hat —
 * und „Bearbeiten" ihn frisch holen muss, weil `router.refresh()` die Zeile
 * zwischendurch erneuert haben kann.
 */
function draftOf(purchase: LedgerRow) {
  return {
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
  };
}

/** Dasselbe für die neun Felder aus 0121. `null` heisst: noch nichts da. */
function contactOf(record: PurchaseRecord | null) {
  return {
    senderName: record?.senderName ?? "",
    senderStreet: record?.senderStreet ?? "",
    senderPostalCode: record?.senderPostalCode ?? "",
    senderCity: record?.senderCity ?? "",
    senderCountry: record?.senderCountry ?? "",
    listingTitle: record?.listingTitle ?? "",
    listingUrl: record?.listingUrl ?? "",
    listingDetails: record?.listingDetails ?? "",
    agreementNote: record?.agreementNote ?? "",
  };
}

export function PurchaseDetails({
  purchase, dayOrder, items, onItemAction, busy, failed, open, onClose, onSaved,
}: {
  purchase: LedgerRow;
  /**
   * Die belegten Plätze dieses Tages, aus `seller_purchase()`.
   *
   * Leer, solange die Zeile nicht geladen ist — dann fehlt nur das
   * Tausch-Auswahlfeld, nicht das Fenster.
   */
  dayOrder: readonly { id: number; dailyIndex: number }[];
  /**
   * Die Positionen dieses Einkaufs, aus dem Zwischenspeicher des
   * Einkaufsbuchs.
   *
   * `undefined` heisst „wird geladen" — ein Eintrag ohne Wert IST der
   * Ladezustand, dieselbe Konvention, mit der das Einkaufsbuch seinen
   * Aufklappbereich füllt. `"failed"` heisst, das Nachlesen ist
   * fehlgeschlagen; eine leere Liste heisst, der Einkauf hat keine Position.
   */
  items: PurchaseItem[] | "failed" | undefined;
  /**
   * Eine Positionsaktion laufen lassen — die Maschinerie des Einkaufsbuchs.
   *
   * Sie bringt vier Dinge mit, die das Fenster sonst selbst bauen müsste: die
   * Sperre je Position gegen den Parallelklick, das `busy`-Kennzeichen, die
   * Ablehnung je Zeile, und — wenn die letzte laufende Aktion fertig ist —
   * `router.refresh()`, das Marktwert und Faktor der Zeile neu vom Server
   * holt, ohne dass dieses Fenster zugeht.
   */
  onItemAction: (key: number, run: () => Promise<PurchaseItemResult>) => void;
  /** Diese Positionen laufen gerade. Keine Behauptung über das Ergebnis. */
  busy: ReadonlySet<number>;
  /** Abgelehnt, mit dem Satz der Datenbank — je Position, nicht je Fenster. */
  failed: ReadonlyMap<number, string>;
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
  /*
   * DER FIGURENUNTERSCHIED, BIS ZUM SPEICHERN NUR HIER (0126).
   *
   * Hinzufuegen und Entfernen schreiben nicht. `Speichern` schickt den
   * Unterschied in EINEM Aufruf an `seller_save_purchase_edit`, `Abbrechen`
   * setzt ihn auf `emptyEdit` zurueck. Das ist nicht nur der Wunsch, es ist
   * auch die einzige Form, in der ein Speichern atomar sein kann.
   */
  const [pending, setPending] = useState<PendingEdit>(emptyEdit);
  const [adding, setAdding] = useState(false);
  /* Welche Zeile gerade ihre Tauschsuche offen hat — eine, nie zwei (0127). */
  const [swapping, setSwapping] = useState<number | null>(null);
  /*
   * STEHT DIE RUECKFRAGE ZUM EIGENBELEG GERADE DA? (0126, korrigiert fuer 0127)
   *
   * NUR DAS — kein „bestaetigt". Vorher hiess diese Zahl `receiptAck` und
   * bedeutete beides: „die Warnung steht" UND „der Betreiber hat zugestimmt".
   * Zugestimmt hatte er aber nie, denn der Satz „Trotzdem speichern" war ein
   * `<p>` und kein Knopf; durchkam man nur, indem man oben ein zweites Mal
   * `Speichern` drueckte — und das sah dann aus wie ein Verwerfen. Die
   * Zustimmung ist jetzt ein ausdruecklicher Klick und wird als Argument an
   * `save` uebergeben, nicht aus einem Zustand erraten.
   */
  const [receiptPrompt, setReceiptPrompt] = useState(false);
  /*
   * GESPEICHERT, ABER NICHT NACHGELESEN.
   *
   * Zwei Dinge, die vorher an einem Faden hingen. `error` heisst „es wurde
   * NICHT gespeichert"; dieser Zustand heisst „es wurde gespeichert, und die
   * Anzeige daneben ist moeglicherweise alt". Das zu verwechseln hiesse, dem
   * Betreiber einen Schreibvorgang abzusprechen, den der Server bestaetigt
   * hat — und ihn ein zweites Mal ausloesen zu lassen.
   */
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [swapped, setSwapped] = useState<number | null>(null);
  /*
   * DIE POSITION, DEREN ZUORDNUNG GERADE KORRIGIERT WIRD — eine auf einmal.
   *
   * Zwei offene Suchfelder in einer Liste wären zwei Eingabefelder mit
   * Autofokus, und der zweite nähme dem ersten den Fokus weg, während jemand
   * tippt.
   */
  const [remapping, setRemapping] = useState<number | null>(null);
  /*
   * DIE POSITION, DEREN RÜCKNAHME BESTÄTIGT WERDEN MUSS.
   *
   * Der erste Klick setzt diese Nummer und SONST NICHTS — kein Netzaufruf,
   * keine Server Action, keine Datenänderung. Erst `Ja, zurücknehmen` ruft
   * `processUnbookPurchaseItem`.
   *
   * SIE WIRD BEIM ERFOLG NICHT ZURÜCKGESETZT, und das ist Absicht: die
   * Rückfrage wird nur gezeigt, solange die Position `booked` ist. Gelingt
   * die Rücknahme, kommt die frische Liste mit `state = 'arrived'` zurück,
   * und der Bereich verschwindet von selbst. SCHEITERT sie, bleibt er offen
   * und trägt die Ablehnung der Datenbank — sonst hätte die Meldung keinen
   * Ort, an dem sie stehen könnte.
   *
   * Eine Position auf einmal, wie `remapping` daneben.
   */
  const [confirmingUnbook, setConfirmingUnbook] = useState<number | null>(null);
  /*
   * DIE POSITION, DEREN EINBUCHUNG BESTÄTIGT WERDEN MUSS.
   *
   * Eigener Zustand neben `confirmingUnbook`, nicht derselbe: die beiden
   * Rückfragen stellen verschiedene Fragen und können nie gleichzeitig für
   * dieselbe Zeile gelten — `canBook` und `state === "booked"` schliessen
   * einander aus. Ein gemeinsames Feld mit einem zweiten Feld „welche Frage"
   * wäre derselbe Zustand in zwei Teilen.
   *
   * Wie bei der Rücknahme wird sie beim Erfolg NICHT zurückgesetzt: die
   * Rückfrage erscheint nur, solange `canBook` gilt. Gelingt die Einbuchung,
   * kommt die frische Liste mit `state = 'booked'`, und der Bereich
   * verschwindet von selbst. Scheitert sie, bleibt er offen und trägt die
   * Ablehnung der Datenbank.
   */
  const [confirmingBook, setConfirmingBook] = useState<number | null>(null);
  /*
   * DIE SPERRE GEGEN DEN DOPPELKLICK — hier, nicht nur beim Eltern-Element.
   *
   * `running` oben ist `busy.has(item.id)`, also STATE: zwei Klicks innerhalb
   * eines Renderdurchlaufs sehen beide noch `false`, und `disabled` greift
   * erst eine Darstellung später. Dass trotzdem keine zweite Anfrage
   * hinausgeht, liegt bisher allein an `inflight` im Einkaufsbuch — einem
   * Ref, das der Prop-Typ `onItemAction` nicht verspricht.
   *
   * Dieses Ref ist dasselbe Mittel, eine Ebene tiefer: sofort aktuell, ohne
   * Darstellung. Die Freigabe macht `dispatchItemAction`; warum sie der
   * schwierige Teil ist, steht dort. Die Datenbank bleibt die letzte Instanz.
   */
  const dispatching = useRef<Set<number>>(new Set());
  /** Jeder schreibende Klick dieses Fensters geht hier durch — und nur hier. */
  const dispatch = useCallback(
    (key: number, run: () => Promise<PurchaseItemResult>) =>
      dispatchItemAction(dispatching.current, key, onItemAction, run),
    [onItemAction],
  );
  /*
   * Der Katalog, erst beim ersten Hineingreifen. `MIN_QUERY` in `FigureSearch`
   * ist 2, also ist er da, bevor das erste Ergebnis gezeigt werden dürfte.
   */
  const [figures, setFigures] = useState<FigureChoice[] | null>(null);
  const [loadingFigures, setLoadingFigures] = useState(false);
  const ensureFigures = useCallback(() => {
    if (figures !== null || loadingFigures) return;
    setLoadingFigures(true);
    void loadOrderbookFigures()
      .then((loaded) => setFigures(loaded))
      .finally(() => setLoadingFigures(false));
  }, [figures, loadingFigures]);

  /*
   * ABSENDER, INSERAT UND VEREINBARUNG (0121) — ERST AUF ZURUF.
   *
   * Diese neun Felder stehen NICHT in `LedgerRow`, und das ist Absicht: die
   * Ledger-Abfrage liefert jede Zeile der gefilterten Liste, und eine
   * Privatanschrift je Zeile in den Browser zu schicken, nur damit ein
   * Fenster sie zeigen KÖNNTE, wäre genau die Art von Datenfluss, die
   * `docs/SECURITY.md` verbietet. Also einmal beim Öffnen dieses einen
   * Einkaufs, über `seller_purchase()`.
   *
   * `record === null` heisst „noch nicht da" — und genau daran hängt, ob
   * gespeichert werden darf (siehe `save`).
   */
  const [record, setRecord] = useState<PurchaseRecord | null>(null);
  const [recordFailed, setRecordFailed] = useState(false);
  const [contact, setContact] = useState(() => contactOf(null));

  /*
   * SIE GIBT JETZT ZURUECK, OB ES GEKLAPPT HAT.
   *
   * Vorher verschluckte sie das Ergebnis und setzte nur `recordFailed`. Der
   * Aufrufer konnte deshalb nicht zwischen „gespeichert und nachgelesen" und
   * „gespeichert, aber nicht nachgelesen" unterscheiden — und genau diese
   * Unterscheidung ist der Unterschied zwischen einer Fehlermeldung und einer
   * Aktualisierungswarnung.
   */
  const readRecord = useCallback(async (): Promise<boolean> => {
    const loaded = await loadPurchaseRecord(purchase.id);
    if (loaded === null) { setRecordFailed(true); return false; }
    setRecordFailed(false);
    setRecord(loaded);
    setContact(contactOf(loaded));
    return true;
  }, [purchase.id]);

  /*
   * Das Fenster wird erst erzeugt, wenn es geöffnet wird (`showingRow &&
   * <PurchaseDetails key=…>` im Einkaufsbuch), also ist „beim Einhängen"
   * genau „beim Öffnen". `alive` verhindert ein Setzen nach dem Schliessen —
   * und damit, dass die Antwort zu Einkauf A in das Fenster von Einkauf B
   * fällt, wenn jemand schnell wechselt.
   */
  useEffect(() => {
    let alive = true;
    void loadPurchaseRecord(purchase.id).then((loaded) => {
      if (!alive) return;
      if (loaded === null) { setRecordFailed(true); return; }
      setRecord(loaded);
      setContact(contactOf(loaded));
    });
    return () => { alive = false; };
  }, [purchase.id]);

  /*
   * DER EIGENBELEG (0122).
   *
   * `loaded === false` heisst „noch nicht nachgesehen", `receipt === null`
   * heisst „nachgesehen, es gibt keinen". Zwei verschiedene Dinge: das eine
   * zeigt eine Lademeldung, das andere den Knopf zum Ausstellen.
   */
  const [receipt, setReceipt] = useState<ReceiptState | null>(null);
  const [receiptLoaded, setReceiptLoaded] = useState(false);
  const [receiptFailed, setReceiptFailed] = useState(false);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  /*
   * DIE GANZE KETTE (0128), damit aktuelle und ersetzte Fassungen
   * unterscheidbar sind. `null` heisst „noch nicht nachgesehen".
   */
  const [history, setHistory] = useState<ReceiptVersion[] | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [correctable, setCorrectable] = useState(false);
  /* Steht die Rueckfrage zum Korrekturbeleg gerade da? Nur Anzeige. */
  const [correctPrompt, setCorrectPrompt] = useState(false);

  /**
   * Den Belegzustand NEU nachlesen — nach jedem erfolgreichen Speichern.
   *
   * WARUM DAS FEHLTE UND WAS ES GEKOSTET HAT. Der Effekt unten liest den Beleg
   * genau einmal, beim Oeffnen. Ein Figurenwechsel macht den ausgestellten
   * Beleg aber veraltet (`stale`), und ohne dieses Nachlesen zeigte das
   * Fenster nach dem Speichern weiter „gueltig" — eine Aussage ueber einen
   * Stand, den es nicht mehr gab. `stale` kommt aus einem Fingerabdruck ueber
   * die Belegfelder, nicht aus `updated_at`; es kann sich also nur so
   * aktualisieren.
   */
  /**
   * Die Belegkette nachlesen (0128).
   *
   * Sie steht neben `readReceipt` und nicht darin: der Belegzustand ist eine
   * Zeile, die Historie eine Liste, und nach einem Abruf aendert sich nur die
   * zweite. Gibt zurueck, ob es geklappt hat — dieselbe Regel wie bei den
   * anderen Lesern.
   */
  const readHistory = useCallback(async (): Promise<boolean> => {
    const result = await loadPurchaseReceiptHistory(purchase.id);
    if (!result.ok) { setHistoryFailed(true); return false; }
    setHistoryFailed(false);
    setHistory(result.versions);
    setCorrectable(result.correctable);
    return true;
  }, [purchase.id]);

  const readReceipt = useCallback(async (): Promise<boolean> => {
    const result = await loadPurchaseReceipt(purchase.id);
    if (!result.ok) { setReceiptFailed(true); setReceiptLoaded(true); return false; }
    setReceiptFailed(false);
    setReceipt(result.receipt);
    setReceiptLoaded(true);
    return true;
  }, [purchase.id]);

  useEffect(() => {
    let alive = true;
    void loadPurchaseReceipt(purchase.id).then((result) => {
      if (!alive) return;
      if (!result.ok) { setReceiptFailed(true); setReceiptLoaded(true); return; }
      setReceipt(result.receipt);
      setReceiptLoaded(true);
    });
    void loadPurchaseReceiptHistory(purchase.id).then((result) => {
      if (!alive) return;
      if (!result.ok) { setHistoryFailed(true); return; }
      setHistory(result.versions);
      setCorrectable(result.correctable);
    });
    return () => { alive = false; };
  }, [purchase.id]);

  const [draft, setDraft] = useState(() => draftOf(purchase));

  /* Die Summe beim Tippen — aus derselben Funktion, die danach speichert. */
  const typed = purchaseCosts({
    items: draft.items, shipping: draft.shipping, buyerProtection: draft.protection,
  });
  const hasSplit = draft.items.trim() !== "";
  /* Steht überhaupt etwas drin? Sonst sagt der Abschnitt das, statt neun
     Striche untereinander zu zeigen. */
  const hasRecord = record !== null
    && Object.values(record).some((value) => value !== null);
  const split = purchase.itemsCost !== null;
  /*
   * DIE ZAHLUNG EINES IMPORTIERTEN EINKAUFS IST ABGESCHLOSSEN (ADR-0126).
   *
   * Nicht der Einkauf ist gesperrt — nur die bezahlte Summe. Alles andere
   * wird hier bearbeitet wie bei einem neuen Einkauf. `0132` sagt in der
   * Datenbank dasselbe; dies hier erspart die Ablehnung.
   */
  const zahlungAbgeschlossen = isHistorical(purchase.source);
  const endings = purchase.damagedCount + purchase.missingCount;

  /*
   * BEARBEITEN BEGINNT MIT DEM STAND VON JETZT.
   *
   * `router.refresh()` erneuert die Ledger-Zeile, während das Fenster offen
   * ist — eine Einbuchung tut genau das. Der Entwurf wird deshalb beim
   * Eintritt neu aus `purchase` und `record` gebaut und nicht von vor einer
   * halben Minute weiterbenutzt.
   */
  function startEditing() {
    setDraft(draftOf(purchase));
    setContact(contactOf(record));
    setError(null);
    setEditing(true);
  }

  /*
   * ABBRECHEN VERWIRFT. Es klappt nichts zu, es setzt zurück: derselbe
   * Aufbau wie beim Eintritt, und die Fehlermeldung geht mit. Danach steht
   * wieder die Ansicht da, und kein Feld trägt mehr eine Eingabe, die
   * niemand gespeichert hat.
   */
  function cancelEditing() {
    setDraft(draftOf(purchase));
    setContact(contactOf(record));
    setError(null);
    setEditing(false);
    /*
     * UND DER FIGURENUNTERSCHIED MIT. `emptyEdit` ist eingefroren, es gibt
     * keinen Teilzustand, der ein Abbrechen ueberlebt.
     */
    setPending(emptyEdit);
    setAdding(false);
    setSwapping(null);
    setReceiptPrompt(false);
  }

  async function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    setSaving(true);
    setError(null);
    /* Ein neuer Versuch beginnt ohne die Warnung des vorigen. */
    setRefreshFailed(false);
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
  async function save(receiptConfirmed = false) {
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
    /*
     * DIE URL, BEVOR SIE DEN SERVER ERREICHT.
     *
     * Dieselbe Form, die der CHECK `purchases_listing_url_shape` verlangt.
     * Hier steht sie, damit die Antwort sofort kommt und nicht als
     * Datenbankablehnung; die Grenze bleibt der CHECK.
     */
    const url = contact.listingUrl.trim();
    if (url !== "" && !LISTING_URL.test(url)) {
      setError(modal.listingUrlInvalid);
      return;
    }
    /*
     * DIE AUFTEILUNG MUSS DIE BEZAHLTE SUMME ERGEBEN (ADR-0126).
     *
     * Bei einem importierten Einkauf bleibt `total_cost` stehen. Eine
     * Aufteilung, die etwas anderes ergibt, würde am CHECK
     * `purchases_cost_split_adds_up` scheitern — mit einer Meldung über
     * einen CHECK statt über die Sache. Deshalb hier, mit beiden Zahlen.
     */
    if (zahlungAbgeschlossen && hasSplit
        && Math.abs(typed.total - purchase.totalCost) > 0.004) {
      setError(modal.splitMustMatchPaid(
        formatPrice(typed.total), formatPrice(purchase.totalCost)));
      return;
    }
    /*
     * DIE RUECKFRAGE BEI VORHANDENEM BELEG (0126).
     *
     * Der Fingerabdruck aus `0122` hasht die Positionsliste. Eine Figur mehr
     * oder weniger macht den ausgestellten Beleg veraltet — und er bleibt
     * unveraenderlich, es gibt kein Zurueck. Also wird gefragt, BEVOR
     * geschrieben wird, und nur bei einer Positionsaenderung: Kosten und
     * Notiz stehen nicht im Hash.
     */
    /*
     * DIE ZUSTIMMUNG KOMMT ALS ARGUMENT, NICHT AUS DEM ZUSTAND.
     *
     * `save()` ohne Argument fragt — immer, solange ein Beleg existiert und
     * die Figurenliste sich aendert. Erst `save(true)` aus dem Knopf in der
     * Warnung schreibt. Damit verwirft ein zweiter Klick auf `Speichern`
     * nichts und speichert auch nichts versehentlich: er zeigt dieselbe Frage
     * noch einmal.
     */
    if (needsReceiptConfirm(receipt !== null, pending) && !receiptConfirmed) {
      setReceiptPrompt(true);
      setError(null);
      return;
    }

    /*
     * EIN AUFRUF FUER FELDER UND FIGUREN (0126).
     *
     * Vorher stand hier `updatePurchase`. Zwei Aufrufe — Felder, dann
     * Positionen — waeren zwei bis N Transaktionen, und ein Fehler in der
     * Mitte liesse einen halb geaenderten Einkauf zurueck. Dieselbe Lehre
     * hatte die Verkaufsseite in `0091`.
     *
     * `purchase.updatedAt` ist seit `0126` die Version des GANZEN Aggregats:
     * ein Trigger bewegt sie auch bei einer Positionsaenderung. Vorher tat
     * das keine einzige Positionsoperation, und die Pruefung haette eine
     * Nebenlaeufigkeit nicht gesehen.
     */
    const payload = savePayload(pending);
    const saved = await run(() => savePurchaseEdit(
      purchase.id,
      wantedDate,
      /*
       * BEI EINEM IMPORTIERTEN EINKAUF WIRD DIE SUMME NICHT MITGESCHICKT.
       *
       * Sonst zöge jede Änderung der Aufteilung die bezahlte Summe mit —
       * `typed.total` ist die Summe der getippten Teile. Genau das ist bei
       * einem abgeschlossenen Einkauf verboten (`0132`), und `undefined`
       * heisst für `seller_update_purchase` „unverändert lassen".
       */
      hasSplit && !zahlungAbgeschlossen ? typed.total : undefined,
      draft.note,
      {
        platform: draft.platform.trim() === "" ? undefined : draft.platform.trim(),
        sellerName: draft.seller.trim(),
        paymentMethod: draft.payment.trim() === "" ? undefined : draft.payment.trim(),
        externalRef: draft.reference.trim(),
        ...(hasSplit
          ? { items: typed.items, shipping: typed.shipping, buyerProtection: typed.buyerProtection }
          : {}),
        /*
         * NUR WENN GELADEN. `record === null` heisst, die neun Felder sind
         * noch nicht vom Server gekommen — die Entwurfsfelder stünden dann
         * auf "" und ein Leerstring LÖSCHT. Ein Speichern des Kaufdatums
         * während des Ladens würde sonst Absender und Inserat wegräumen.
         */
        ...(record === null ? {} : {
          senderName: contact.senderName.trim(),
          senderStreet: contact.senderStreet.trim(),
          senderPostalCode: contact.senderPostalCode.trim(),
          senderCity: contact.senderCity.trim(),
          senderCountry: contact.senderCountry.trim(),
          listingTitle: contact.listingTitle.trim(),
          listingUrl: url,
          listingDetails: contact.listingDetails.trim(),
          agreementNote: contact.agreementNote.trim(),
        }),
      },
      payload,
      purchase.updatedAt,
    ));
    /*
     * ======================================================================
     * HIER TRENNEN SICH ZWEI FRAGEN, UND SIE HINGEN VORHER AN EINEM FADEN.
     *
     *   1. Hat der Server geschrieben?   → `saved`, aus `run`.
     *   2. Konnten wir danach nachlesen? → `frisch`, weiter unten.
     *
     * NICHT GESPEICHERT: alles bleibt stehen — die Felder, die vorgemerkten
     * Figuren, der Bearbeitungsmodus. Die Meldung oben sagt, warum. Und es
     * wird NICHTS nachgelesen: `readRecord` setzt die Absender- und
     * Inseratsfelder aus dem Server neu, und das haette nach einer Ablehnung
     * die Eingabe ueberschrieben, die gerade gerettet werden soll.
     * ======================================================================
     */
    if (!saved) return;

    /* Uebernommen — der Unterschied ist jetzt Geschichte. */
    setPending(emptyEdit);
    setAdding(false);
    setSwapping(null);
    setReceiptPrompt(false);
    /* Und zurueck in die Ansicht: der Server hat bestaetigt. */
    setEditing(false);

    /*
     * AB HIER IST GESPEICHERT, UND NICHTS KANN DAS NOCH UMSTOSSEN.
     *
     * Was jetzt noch schiefgeht, ist eine Sache der Anzeige: der Einkauf ist
     * geaendert, der ausgestellte Beleg dadurch veraltet — beides steht in der
     * Datenbank, unabhaengig davon, ob wir es gleich zu sehen bekommen.
     *
     * Beide Leser laufen, auch wenn der erste scheitert: `&&` wuerde den
     * Belegzustand ueberspringen, und dann waere ausgerechnet die
     * Veralterungsmarkierung die, die fehlt.
     */
    const satzFrisch = await readRecord();
    const belegFrisch = await readReceipt();
    /* Und die Kette: ob eine Korrektur jetzt moeglich ist, haengt am
       Fingerabdruck — und der hat sich gerade bewegt. */
    const ketteFrisch = await readHistory();
    setRefreshFailed(!(satzFrisch && belegFrisch && ketteFrisch));
  }

  /**
   * NOCH EINMAL NACHLESEN — nach einem Speichern, dem die Aktualisierung
   * fehlgeschlagen ist.
   *
   * Sie schreibt nichts. `onSaved()` steht mit dabei, weil der veraltete
   * Stand nicht nur in diesem Fenster liegt: die Figurenliste gehoert dem
   * Zwischenspeicher des Einkaufsbuchs, und die Zeile dem Server.
   */
  async function reloadNow() {
    setReloading(true);
    const satzFrisch = await readRecord();
    const belegFrisch = await readReceipt();
    const ketteFrisch = await readHistory();
    const frisch = satzFrisch && belegFrisch && ketteFrisch;
    setRefreshFailed(!frisch);
    setReloading(false);
    if (frisch) onSaved();
  }

  /**
   * AUSSTELLEN, HOLEN, SPEICHERN, BESTÄTIGEN — in dieser Reihenfolge.
   *
   * Der erste Klick stellt aus; jeder weitere holt denselben Beleg. Die
   * Server-Funktion ist idempotent, ein Doppelklick kostet also höchstens
   * eine Runde und nie eine zweite Belegnummer. `receiptBusy` fängt ihn
   * trotzdem ab, damit die Oberfläche ruhig bleibt.
   *
   * DIE DATEI WIRD VOR DER BESTÄTIGUNG GESPEICHERT. Dem Betreiber geht es um
   * das PDF; scheitert danach die Bestätigung, hat er es trotzdem — nur der
   * Haken bleibt aus, und das ist die ehrliche Anzeige.
   */
  async function fetchReceipt(
    /*
     * EINE BESTIMMTE FASSUNG, ODER DIE AKTUELLE (0128).
     *
     * Eine ersetzte Fassung bleibt abrufbar — sie ist das Dokument, das
     * jemand vielleicht schon weitergegeben hat. Die Route prueft die
     * Zugehoerigkeit zum Einkauf selbst; hier wird nur die Id durchgereicht.
     * Ohne Angabe gilt wie bisher: die aktuelle Fassung, und wenn es noch
     * keine gibt, wird sie ausgestellt.
     */
    fassung: { id: number; receiptNumber: string } | null = null,
  ) {
    if (editing || receiptBusy) return;
    setReceiptBusy(true);
    setReceiptError(null);
    try {
      /*
       * ZWEI VERSCHIEDENE DINGE, GETRENNT GEHALTEN: welche Fassung abgerufen
       * wird (`ziel`) und was der Dialog ueber die aktuelle Fassung weiss
       * (`receipt`). Ein Abruf einer ERSETZTEN Fassung darf den Zustand der
       * Spitze nicht ueberschreiben.
       */
      let ziel: { id: number; receiptNumber: string } | null = fassung;
      if (ziel === null) {
        if (receipt === null) {
          const issued = await issuePurchaseReceipt(purchase.id);
          if (!issued.ok) { setReceiptError(issued.message); return; }
          if (issued.receipt === null) {
            setReceiptError(receiptCopy.errors.unknown);
            return;
          }
          setReceipt(issued.receipt);
          ziel = issued.receipt;
          await readHistory();
        } else {
          ziel = receipt;
        }
      }

      const response = await fetch(`/business/orderbuch/${purchase.id}/beleg/${ziel.id}`);
      if (!response.ok) { setReceiptError(receiptCopy.errors.downloadFailed); return; }
      const bytes = await response.arrayBuffer();

      /* Der Beweis, dass die GANZEN Bytes ankamen. Mehr sagt er nicht. */
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hex = [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, "0")).join("");

      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${ziel.receiptNumber}.pdf`;
      link.click();
      URL.revokeObjectURL(url);

      const confirmed = await confirmPurchaseReceiptDownload(
        ziel.id, hex, bytes.byteLength);
      if (!confirmed.ok) { setReceiptError(confirmed.message); return; }
      /*
       * `seller_record_purchase_receipt_download` antwortet immer mit der
       * KETTENSPITZE — auch wenn eine aeltere Fassung abgerufen wurde. Der
       * Abrufstand der aelteren steht in der Historie, und die wird neu
       * gelesen statt geraten.
       */
      setReceipt(confirmed.receipt);
      await readHistory();
    } finally {
      setReceiptBusy(false);
    }
  }

  /**
   * EINEN KORREKTURBELEG AUSSTELLEN (0128).
   *
   * Der erste Klick setzt nur die Rueckfrage; erst `correctNow` ruft den
   * Server. Danach stehen zwei Dinge neu zur Verfuegung: der Belegzustand
   * (die neue Spitze) und die Historie (die ersetzte Fassung). `onSaved()`
   * gehoert dazu, weil der Belegzustand in der Ledger-Zeile steht — `0124`
   * zeigt ihn dort.
   */
  async function correctNow() {
    if (editing || receiptBusy) return;
    setReceiptBusy(true);
    setReceiptError(null);
    try {
      const issued = await issuePurchaseReceiptCorrection(purchase.id);
      if (!issued.ok) { setReceiptError(issued.message); return; }
      setReceipt(issued.receipt);
      setCorrectPrompt(false);
      await readHistory();
      onSaved();
    } finally {
      setReceiptBusy(false);
    }
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
            AUCH EIN HISTORISCHER EINKAUF WIRD BEARBEITET (ADR-0126).

            Hier stand bis 2026-10-17 ein Tor: für `excel_order_2026` gab es
            keinen Bearbeiten-Knopf, mit der Begründung, die Zahlen seien die
            der Excel-Historie und ein Knopf wäre eine Einladung. Die
            Erfahrung war die umgekehrte: in der Arbeitsmappe FEHLEN Figuren,
            Absender und Inserate, und ohne Knopf gab es keinen Weg, das
            nachzutragen — die Historie blieb lückenhaft, statt genauer zu
            werden.

            Was die Zahlen schützt, sind nicht fehlende Knöpfe, sondern die
            Regeln darunter: eine importierte Zeile lässt sich nicht
            entfernen (`canRemoveItem`, `0132`), eine eingebuchte nicht
            tauschen (`canRemapItem`), `reconciled_legacy` wird nie erneut
            eingebucht (`0053`), und gespeichert wird in EINER Transaktion
            (`seller_save_purchase_edit`, `0126`/`0127`). Der Beleg bleibt
            unberührt; ausgestellt wird ohnehin nichts (Freigabe B offen).
          */}
          {editing ? (
            /*
             * IM BEARBEITEN: SPEICHERN UND ABBRECHEN, OBEN RECHTS.
             *
             * Vorher stand hier ein Umschalter „Bearbeiten/Fertig" und der
             * Speichern-Knopf ganz unten im angehängten Block — man musste
             * durch das halbe Fenster scrollen, um ihn zu finden. Jetzt
             * liegen beide dort, wo der Blick ohnehin hingeht.
             *
             * `disabled={saving}` an beiden: während eines Speichervorgangs
             * ist kein zweiter und auch kein Verwerfen möglich.
             */
            <>
              <button type="button" disabled={saving} onClick={() => void save()}
                      className="min-h-9 rounded-sky-md bg-surface px-2 text-xs font-medium ring-1 ring-fg/40 hover:ring-fg/60 disabled:opacity-50">
                {saving ? modal.saving : modal.save}
              </button>
              <button type="button" disabled={saving} onClick={cancelEditing}
                      className="min-h-9 rounded-sky-md px-2 text-xs text-muted ring-1 ring-border/70 hover:text-fg disabled:opacity-50">
                {modal.cancel}
              </button>
            </>
          ) : (
            /*
             * Eine Arbeitsmappenzeile wird nicht bearbeitet.
             * `seller_update_purchase` würde es annehmen, aber ihre Zahlen
             * sind die der Excel-Historie — ein Knopf, der sie
             * überschreibbar aussehen lässt, ist eine Einladung.
             */
            <button type="button" onClick={startEditing}
                    className="min-h-9 rounded-sky-md px-2 text-xs text-muted ring-1 ring-border/70 hover:text-fg">
              {modal.edit}
            </button>
          )}
          {/* „Schliessen" bleibt in beiden Zuständen stehen. */}
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

      {/*
        GESPEICHERT, ANZEIGE ALT — UND DAS IST KEINE FEHLERMELDUNG.
        Deshalb `role="status"` und nicht `role="alert"`, deshalb die ruhige
        Farbe, und deshalb ein Knopf statt einer Entschuldigung. Sie steht
        getrennt von `error`: beide zugleich kann es nicht geben, denn ohne
        erfolgreiches Speichern wird nicht nachgelesen.
      */}
      {refreshFailed ? (
        <div role="status"
             className="mx-4 mb-1 flex flex-wrap items-center gap-2 rounded-sky-md bg-surface px-3 py-2 text-xs ring-1 ring-attention/50">
          <span className="flex-1 text-muted">{modal.saveRefreshFailed}</span>
          <button type="button" disabled={reloading} aria-busy={reloading}
                  onClick={() => void reloadNow()}
                  className="min-h-9 rounded-sky-md px-2 text-xs font-medium ring-1 ring-fg/40 hover:ring-fg/60 disabled:opacity-50">
            {reloading ? modal.saveRefreshRetrying : modal.saveRefreshRetry}
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title={modal.purchase}>
          {/*
            INLINE, NICHT UNTEN. Jede Angabe wird an ihrer Stelle zum Feld —
            kein zweiter Block unter der Ansicht, kein Scrollen, und die
            Reihenfolge bleibt dieselbe, die man eben noch gelesen hat.
          */}
          {editing ? (
            <Field label={copy.columns.date}>
              {/* Leer heisst „Datum nicht bekannt" — kein Platzhalter, keine Vermutung. */}
              <input type="date" value={draft.purchasedAt} disabled={saving}
                     onChange={(e) => setDraft({ ...draft, purchasedAt: e.target.value })}
                     className={`${INPUT} w-40`} />
            </Field>
          ) : (
            <Line label={copy.columns.date} value={formatDate(purchase.purchasedAt)} />
          )}
          {/*
            DER PLATZ AM TAG (0115). Immer sichtbar, sobald ein Datum da ist —
            auch wenn der Einkauf der einzige ist. Eine Zahl, die nur bei
            mehreren erscheint, liest sich als Fehler, wenn sie fehlt.
          */}
          <Line label={modal.dailyIndex}
                value={purchase.dailyIndex === null ? modal.dailyIndexNone
                  : dayOrder.length <= 1 ? modal.dailyIndexAlone
                    : modal.dailyIndexOf(purchase.dailyIndex, dayOrder.length)} />
          {editing ? (
            <>
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
              {/*
                Referenz und Notiz standen in der Ansicht nur, WENN sie
                gefüllt waren — sonst hätte eine leere Zeile behauptet, da
                fehle etwas. Im Bearbeiten stehen sie immer: ein Feld, das
                man nicht sieht, kann man nicht füllen.
              */}
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
            </>
          ) : (
            <>
              <Line label={modal.platform} value={platformName(purchase.platform)} />
              <Line label={modal.seller} value={purchase.sellerName ?? "—"} />
              <Line label={modal.payment} value={paymentName(purchase.paymentMethod)} />
              {purchase.externalRef
                ? <Line label={modal.reference} value={purchase.externalRef} /> : null}
              {purchase.note ? <Line label={modal.note} value={purchase.note} /> : null}
            </>
          )}

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
                  <option value="">{modal.platformUnknown}</option>
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
          {editing ? (
            <>
              {/*
                DIE AUFTEILUNG WIRD HIER BEARBEITET, nicht in einem zweiten
                Formular weiter unten. Die Gesamtsumme darunter rechnet beim
                Tippen mit — aus derselben Funktion, die danach speichert,
                also kann der CHECK in der Datenbank nichts ablehnen, was
                hier nicht schon zu sehen war.
              */}
              <p className="mb-1 text-xs text-muted">
                {zahlungAbgeschlossen ? modal.paidFixedHint : modal.splitHint}
              </p>
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
                BEI EINEM IMPORTIERTEN EINKAUF IST DIE BEZAHLTE SUMME DIE
                AUTORITÄT, nicht die Summe der getippten Teile. Sie steht
                deshalb als eigene Zeile da — sichtbar, aber ohne Eingabefeld —
                und die getippte Summe nur dann, wenn sie abweicht: dann ist
                sie ein Hinweis auf einen Tippfehler, nicht ein neuer Betrag.
              */}
              {zahlungAbgeschlossen ? (
                <>
                  <Line label={modal.paidFixedLabel}
                        value={formatPrice(purchase.totalCost)} strong />
                  {hasSplit && Math.abs(typed.total - purchase.totalCost) > 0.004 ? (
                    <p role="alert" className="mt-1 text-xs text-danger">
                      {modal.splitMustMatchPaid(
                        formatPrice(typed.total), formatPrice(purchase.totalCost))}
                    </p>
                  ) : null}
                </>
              ) : hasSplit ? (
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
            </>
          ) : (
            <>
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
            </>
          )}
          <Line label={copy.columns.marketValue} value={formatPrice(purchase.knownValue)} />
          <Line label={copy.columns.factor}
                value={purchase.factor === null ? "—"
                  : fixedNumber(purchase.factor, 2)} />
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

        {/*
          GEKAUFTE FIGUREN — zwischen den Kosten und dem Bearbeiten-Block.

          LESEND, UND ZUNÄCHST NUR DAS. Kein Einbuchen, kein Zustandswechsel,
          kein Entfernen: dieses Fenster ist zum Nachsehen da, und die
          Zustandsverwaltung bleibt auf der Detailseite, wo eine Lagerbuchung
          hingehört. `PurchaseItemReadRow` hat für später einen Steckplatz,
          der heute von niemandem gefüllt wird.

          DREI ZUSTÄNDE DER LISTE, und alle drei stehen hier:
            `undefined`  wird noch geladen — das (i) öffnet sofort und füllt
                         sich, statt auf eine Runde zum Server zu warten
            `"failed"`   das Nachlesen ist fehlgeschlagen, der Einkauf nicht
            `[]`         es gibt keine Position; `Unvollständig` ist dafür ein
                         gültiger Zustand (0063) und kein Fehler

          Die Sätze für Laden und Fehlschlag sind die, die das Einkaufsbuch
          beim Aufklappen schon benutzt.
        */}
        {/*
          ABSENDER UND INSERAT (0121).
          Zwischen den Kosten und den Figuren: es sind Kopfdaten des
          Einkaufs, keine Positionen. Die Figurentabelle darunter bleibt
          unberührt — sie und ihre Aktionen sind hier nicht Thema.
        */}
        <Section title={modal.senderSection}>
          {recordFailed ? (
            <p role="alert" className="text-xs text-danger">{modal.recordFailed}</p>
          ) : record === null ? (
            /*
             * NOCH NICHT GELADEN — und deshalb hier AUCH IM BEARBEITEN keine
             * Felder. Ein leeres Feld bedeutet in diesem Fenster „löschen";
             * Felder zu zeigen, die noch nichts wissen, wäre eine Einladung
             * dazu. `save` lässt die neun aus demselben Grund weg, solange
             * `record === null` ist — zwei Riegel, derselbe Grund.
             */
            <p className="text-xs text-muted">{modal.recordLoading}</p>
          ) : editing ? (
            <>
              <p className="mb-1 text-xs text-muted">{modal.senderHint}</p>
              <Field label={modal.senderName}>
                <input value={contact.senderName} disabled={saving} maxLength={120}
                       placeholder={modal.senderNamePlaceholder}
                       onChange={(e) => setContact({ ...contact, senderName: e.target.value })}
                       className={`${INPUT} w-56`} />
              </Field>
              <Field label={modal.senderStreet}>
                <input value={contact.senderStreet} disabled={saving} maxLength={120}
                       onChange={(e) => setContact({ ...contact, senderStreet: e.target.value })}
                       className={`${INPUT} w-56`} />
              </Field>
              <Field label={modal.senderPostalCode}>
                <input value={contact.senderPostalCode} disabled={saving} maxLength={20}
                       onChange={(e) => setContact({ ...contact, senderPostalCode: e.target.value })}
                       className={`${INPUT} w-28`} />
              </Field>
              <Field label={modal.senderCity}>
                <input value={contact.senderCity} disabled={saving} maxLength={80}
                       onChange={(e) => setContact({ ...contact, senderCity: e.target.value })}
                       className={`${INPUT} w-56`} />
              </Field>
              <Field label={modal.senderCountry}>
                <input value={contact.senderCountry} disabled={saving} maxLength={60}
                       placeholder={modal.senderCountryPlaceholder}
                       onChange={(e) => setContact({ ...contact, senderCountry: e.target.value })}
                       className={`${INPUT} w-44`} />
              </Field>

              <div className="mt-2 border-t border-border/40 pt-2">
                <p className="mb-1 text-xs text-muted">{modal.listingHint}</p>
                <Field label={modal.listingTitle}>
                  <input value={contact.listingTitle} disabled={saving} maxLength={200}
                         onChange={(e) => setContact({ ...contact, listingTitle: e.target.value })}
                         className={`${INPUT} w-56`} />
                </Field>
                <Field label={modal.listingUrl}>
                  <input value={contact.listingUrl} disabled={saving} maxLength={500}
                         placeholder={modal.listingUrlPlaceholder}
                         autoCorrect="off" autoCapitalize="off" spellCheck={false}
                         onChange={(e) => setContact({ ...contact, listingUrl: e.target.value })}
                         className={`${INPUT} w-56`} />
                </Field>
                <label className="flex flex-col gap-1 py-0.5 text-sm">
                  <span className="text-muted">{modal.listingDetails}</span>
                  <textarea value={contact.listingDetails} disabled={saving}
                            maxLength={2000} rows={2}
                            onChange={(e) => setContact({ ...contact, listingDetails: e.target.value })}
                            className={AREA} />
                </label>
              </div>

              <div className="mt-2 border-t border-border/40 pt-2">
                <p className="mb-1 text-xs text-muted">{modal.agreementHint}</p>
                <label className="flex flex-col gap-1 py-0.5 text-sm">
                  <span className="text-muted">{modal.agreementNote}</span>
                  {/* Mehrzeilig, weil der Satz, der eine Kaufvereinbarung
                      erklärt, selten in eine Zeile passt. */}
                  <textarea value={contact.agreementNote} disabled={saving}
                            maxLength={4000} rows={4}
                            placeholder={modal.agreementPlaceholder}
                            onChange={(e) => setContact({ ...contact, agreementNote: e.target.value })}
                            className={AREA} />
                </label>
              </div>
            </>
          ) : !hasRecord ? (
            /* Leer ist der Normalfall, kein Mangel. */
            <p className="text-xs text-muted">{modal.senderEmpty}</p>
          ) : (
            <>
              {([
                [modal.senderName, record.senderName],
                [modal.senderStreet, record.senderStreet],
                [modal.senderPostalCode, record.senderPostalCode],
                [modal.senderCity, record.senderCity],
                [modal.senderCountry, record.senderCountry],
                [modal.listingTitle, record.listingTitle],
              ] as [string, string | null][])
                .filter(([, value]) => value !== null)
                .map(([label, value]) => (
                  <Line key={label} label={label} value={value as string} />
                ))}

              {record.listingUrl === null ? null : (
                <div className="flex items-baseline justify-between gap-4 py-0.5">
                  <span className="text-sm text-muted">{modal.listingUrl}</span>
                  {/*
                    `rel` und `target` zusammen: ein fremdes Inserat bekommt
                    weder Zugriff auf dieses Fenster noch den Verweis, woher
                    der Klick kam. Der Link entsteht nur, wenn die Adresse
                    DIESELBE Form hat, die der CHECK verlangt — eine Zeile,
                    die das nicht tut, steht als Text da.
                  */}
                  {LISTING_URL.test(record.listingUrl) ? (
                    <a href={record.listingUrl} target="_blank" rel="noreferrer noopener"
                       className="truncate text-sm underline underline-offset-2 hover:text-fg">
                      {modal.listingOpen}
                    </a>
                  ) : (
                    <span className="truncate text-sm">{record.listingUrl}</span>
                  )}
                </div>
              )}

              {record.listingDetails === null ? null : (
                <div className="mt-1 border-t border-border/40 pt-1">
                  <p className="text-xs text-muted">{modal.listingDetails}</p>
                  <p className="whitespace-pre-wrap text-sm">{record.listingDetails}</p>
                </div>
              )}

              {record.agreementNote === null ? null : (
                <div className="mt-1 border-t border-border/40 pt-1">
                  <p className="text-xs text-muted">{modal.agreementNote}</p>
                  <p className="whitespace-pre-wrap text-sm">{record.agreementNote}</p>
                </div>
              )}
            </>
          )}
        </Section>

        <Section title={modal.figures}>
          {items === undefined ? (
            <p className="text-xs text-muted">{copy.loadingItems}</p>
          ) : items === "failed" ? (
            <p className="text-xs text-muted">{copy.itemsFailed}</p>
          ) : items.length === 0 ? (
            <p className="text-xs text-muted">{modal.noFigures}</p>
          ) : (
            <>
              {/*
                IM BEARBEITEN-MODUS IST DIE LISTE EINE LISTE, KEINE WERKBANK.
                
                `Einbuchen`, `Ändern` und `Zurücknehmen` sind operative
                Handlungen und schreiben sofort — sie gehören zum Lesemodus.
                Wer bearbeitet, stellt die Figurenliste zusammen; dafür reicht
                EINE Aktion je Zeile, und die 4,5rem-Spur bleibt, wie sie ist.
                Ein dritter Knopf daneben hätte sie gesprengt.
              */}
              {editing ? (
                <PurchaseItemEditList
                  rows={stageRows(items, pending)}
                  busy={saving}
                  catalog={figures}
                  swapping={swapping}
                  onToggleRemove={(id) => setPending((p) => toggleRemove(p, id))}
                  onDropNew={(tempId) => setPending((p) => dropNew(p, tempId))}
                  onDropSwap={(id) => setPending((p) => dropSwap(p, id))}
                  onOpenSwap={(id) => {
                    setAdding(false);
                    setSwapping(swapping === id ? null : id);
                    if (swapping !== id) ensureFigures();
                  }}
                  onSwap={(id, current, choice) => {
                    setPending((p) => swapFigure(p, id, current, {
                      itemId: id, skyId: choice.skyId, label: choice.name,
                    }));
                    setSwapping(null);
                  }} />
              ) : (
                <>
              <PurchaseItemReadHead />
              {/*
                Das Fenster scrollt als Ganzes — `min-h-0 flex-1
                overflow-y-auto` liegt um alle Abschnitte. Diese Liste bekommt
                deshalb KEINEN eigenen Scrollbereich: zwei verschachtelte
                Scrollflächen sind auf einem Telefon die Geste, die niemand
                trifft. Bei 79 Positionen — der längsten Liste im Bestand —
                wird das Fenster lang und scrollt, und der Kopf mit
                `Bearbeiten` und `Schließen` bleibt stehen.
              */}
              <ul className="-mx-4 divide-y divide-border/40">
                {items.map((item) => {
                  /*
                   * DIE EINE SCHUTZREGEL, UNVERÄNDERT: `canRemapItem` ist
                   * `movementId === null && state !== "booked"`. Eine gebuchte
                   * Position besitzt eine Lagerbewegung, und die Bewegung
                   * nennt die Figur, die tatsächlich eingebucht wurde — sie
                   * umzuhängen hiesse, den Bestand von der Buchung zu
                   * trennen. Eine Arbeitsmappenzeile darf dagegen umgehängt
                   * werden; genau dafür gibt es `0054`.
                   *
                   * Die Datenbank bleibt die Grenze: `seller_set_purchase_
                   * item_sky` lehnt es ebenfalls ab. Hier wird nur keine
                   * Handlung angeboten, die immer abgelehnt würde.
                   */
                  const mayRemap = canRemapItem(item);
                  const open = remapping === item.id;
                  const running = busy.has(item.id);
                  const failure = failed.get(item.id) ?? null;
                  /*
                   * Eine kompakte Aktion je Zeile, nie zwei: `canRemapItem`
                   * ist für eine gebuchte Position falsch (`movementId !==
                   * null`), also schliessen `Ändern` und `Zurücknehmen`
                   * einander aus. Die Spur bleibt 4,5rem breit.
                   */
                  const isBooked = item.state === "booked";
                  const confirming = confirmingUnbook === item.id && isBooked;
                  /*
                   * EINBUCHEN — dieselbe Regel wie in der grossen Tabelle.
                   *
                   * `canCheckIn` im Ledger delegiert seit 0116 an `canBook`,
                   * damit nicht zwei Listen von Zuständen auseinanderlaufen.
                   * Dieses Fenster ruft `canBook` direkt: `ordered`,
                   * `arrived` und `showcase`, und nur mit SKY-ID. Für
                   * `damaged` und `missing` erscheint nichts, weil
                   * `seller_book_purchase_item` sie ohnehin ablehnt.
                   */
                  const mayBook = canBook(item);
                  const confirmingIn = confirmingBook === item.id && mayBook;
                  /*
                   * Beim Öffnen einer Fläche schliesst die andere. `mayBook`
                   * und `mayRemap` gelten für dieselbe Zeile, also könnten
                   * sonst Rückfrage und Suchfeld gleichzeitig offen stehen —
                   * zwei Bearbeitungsbereiche unter einer Zeile, von denen
                   * nur einer gemeint ist.
                   */
                  const toggleBook = () => {
                    setRemapping(null);
                    setConfirmingBook(confirmingIn ? null : item.id);
                  };
                  const toggleRemap = () => {
                    setConfirmingBook(null);
                    setRemapping(open ? null : item.id);
                    if (!open) ensureFigures();
                  };
                  return (
                    <PurchaseItemReadRow key={item.id} item={item}
                      /*
                       * DREI AKTIONEN, EINE SPUR VON 4,5rem.
                       *
                       * Die Reihenfolge ist nicht beliebig. `canBook` ist nur
                       * für `ordered`, `arrived` und `showcase` wahr, und für
                       * genau diese Zustände ist `canRemapItem` ebenfalls wahr
                       * (eine nicht gebuchte Position hat keine
                       * Lagerbewegung). `mayBook` muss deshalb VOR `mayRemap`
                       * stehen, sonst gewinnt „Ändern" immer und „Einbuchen"
                       * wäre nie erreichbar.
                       *
                       * Was welche Zeile zeigt:
                       *
                       *   gebucht                      ↩
                       *   offen/angekommen/Vitrine     ↓  ✎
                       *   beschädigt/fehlt/historisch  Ändern
                       *   ohne SKY-ID und gebucht      —
                       *
                       * Bei zwei Aktionen zwei Zeichen, weil „Einbuchen"
                       * neben „Ändern" über 7rem bräuchte. Steht „Ändern"
                       * allein, bleibt das Wort — es passt dort, und ein
                       * Zeichen dafür einzutauschen wäre eine Änderung ohne
                       * Anlass.
                       *
                       * KEINER DIESER KLICKS SCHREIBT. Jeder setzt eine
                       * Nummer und öffnet eine Fläche darunter.
                       */
                      actions={isBooked ? (
                        <button type="button" disabled={running}
                                aria-expanded={confirming}
                                aria-label={copy.unbook}
                                title={copy.unbook}
                                onClick={() => setConfirmingUnbook(confirming ? null : item.id)}
                                className={ACTION}>
                          {running ? copy.itemRunning
                            : <span aria-hidden="true">{copy.errors.unbookIcon}</span>}
                        </button>
                      ) : mayBook ? (
                        <>
                          <button type="button" disabled={running}
                                  aria-expanded={confirmingIn}
                                  aria-label={copy.book}
                                  title={copy.book}
                                  onClick={toggleBook}
                                  className={ACTION}>
                            {running ? copy.itemRunning
                              : <span aria-hidden="true">{copy.errors.bookIcon}</span>}
                          </button>
                          <button type="button" disabled={running}
                                  aria-expanded={open}
                                  aria-label={copy.figures.changeOne(item.name)}
                                  title={copy.figures.changeShort}
                                  onClick={toggleRemap}
                                  className={ACTION}>
                            <span aria-hidden="true">{copy.errors.remapIcon}</span>
                          </button>
                        </>
                      ) : mayRemap ? (
                        <button type="button" disabled={running}
                                aria-expanded={open}
                                onClick={toggleRemap}
                                className={ACTION}>
                          {running ? copy.itemRunning
                            : open ? copy.figures.changeCancel : copy.figures.changeShort}
                        </button>
                      ) : undefined}
                      below={confirming ? (
                        /*
                         * DIE RÜCKFRAGE, UNTER DER BETROFFENEN ZEILE.
                         *
                         * Sie nennt die FOLGE und nicht nur die Frage: eine
                         * Gegenbewegung ist eine Zeile im Lagerjournal, und
                         * die ursprüngliche Buchung bleibt daneben stehen.
                         */
                        <div className="flex flex-col gap-2">
                          <p role="alert" className="text-xs text-muted">
                            {copy.errors.unbookConfirmHint}
                          </p>
                          {failure === null ? null : (
                            <p role="alert" className="text-xs text-danger">{failure}</p>
                          )}
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium">{copy.errors.unbookConfirm}</span>
                            <button type="button" disabled={running}
                                    onClick={() => dispatch(item.id, () =>
                                      processUnbookPurchaseItem(item.id, purchase.id))}
                                    className="min-h-9 rounded-sky-md px-2 text-xs ring-1 ring-border-strong hover:ring-fg/40 disabled:opacity-50">
                              {running ? copy.itemRunning : copy.errors.unbookYes}
                            </button>
                            <button type="button" disabled={running}
                                    onClick={() => setConfirmingUnbook(null)}
                                    className="min-h-9 px-1 text-xs text-muted underline underline-offset-2 disabled:opacity-50">
                              {copy.errors.unbookCancel}
                            </button>
                          </div>
                        </div>
                      ) : confirmingIn ? (
                        /*
                         * DIE RÜCKFRAGE VOR DER EINBUCHUNG — unter der
                         * betroffenen Zeile, wie bei der Rücknahme.
                         *
                         * Sie nennt die Folge: eine Bewegung +1 und eine
                         * danach gesperrte Zuordnung. Beides ist durchgesetzt
                         * und keine Behauptung.
                         */
                        <div className="flex flex-col gap-2">
                          <p role="alert" className="text-xs text-muted">
                            {copy.errors.bookConfirmHint}
                          </p>
                          {failure === null ? null : (
                            <p role="alert" className="text-xs text-danger">{failure}</p>
                          )}
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium">{copy.errors.bookConfirm}</span>
                            <button type="button" disabled={running}
                                    onClick={() => dispatch(item.id, () =>
                                      processBookPurchaseItem(item.id, purchase.id))}
                                    className="min-h-9 rounded-sky-md px-2 text-xs ring-1 ring-border-strong hover:ring-fg/40 disabled:opacity-50">
                              {running ? copy.itemRunning : copy.errors.bookYes}
                            </button>
                            <button type="button" disabled={running}
                                    onClick={() => setConfirmingBook(null)}
                                    className="min-h-9 px-1 text-xs text-muted underline underline-offset-2 disabled:opacity-50">
                              {copy.errors.bookCancel}
                            </button>
                          </div>
                        </div>
                      ) : open ? (
                        <div className="flex flex-col gap-2">
                          {/*
                            DER URSPRÜNGLICHE NAME, VOLLSTÄNDIG UND UNGEKÜRZT.
                            Er ist das Beweisstück, nach dem korrigiert wird —
                            „Drobot" allein sagt nicht, aus welchem Spiel die
                            Figur kam. Gezeigt, nie geschrieben: das RPC fasst
                            `sky_id` an und `raw_name` nicht.
                          */}
                          {item.rawName === null ? null : (
                            <p className="break-words text-xs text-muted">
                              {copy.rawLabel(item.rawName)}
                            </p>
                          )}
                          {failure === null ? null : (
                            <p role="alert" className="text-xs text-danger">{failure}</p>
                          )}
                          {figures === null ? (
                            <p className="text-xs text-muted">{copy.figures.loadingCatalog}</p>
                          ) : (
                            <FigureSearch
                              catalog={figures}
                              autoFocus
                              disabled={running}
                              label={copy.figures.changeOne(item.name)}
                              onCancel={() => setRemapping(null)}
                              onSelect={(choice) => {
                                setRemapping(null);
                                dispatch(item.id, () =>
                                  processPurchaseItemSky(item.id, choice.skyId, purchase.id));
                              }}
                            />
                          )}
                        </div>
                      ) : undefined} />
                  );
                })}
              </ul>
                </>
              )}

              {/*
                HINZUFÜGEN — mit derselben Suche, die `Ändern` schon öffnet.
                `ensureFigures()` lädt den Katalog einmal; ein zweiter
                Suchkasten mit eigener Ladelogik wäre eine zweite Wahrheit.
              */}
              {editing ? (
                <div className="mt-3 border-t border-border/40 pt-3">
                  {adding ? (
                    <FigureSearch
                      catalog={figures ?? []}
                      autoFocus
                      disabled={saving}
                      loading={figures === null}
                      label={modal.addFigure}
                      onCancel={() => setAdding(false)}
                      onSelect={(choice) => {
                        setPending((p) => addFigure(p, {
                          tempId: `t${Date.now()}-${p.add.length}`,
                          skyId: choice.skyId,
                          rawName: null,
                          label: choice.name,
                          condition: "loose",
                        }));
                        setAdding(false);
                      }} />
                  ) : (
                    <button type="button" disabled={saving}
                            onClick={() => {
                              setSwapping(null); setAdding(true); ensureFigures();
                            }}
                            className={BUTTON}>
                      {modal.addFigure}
                    </button>
                  )}
                  {/*
                    DIE ZAHL, BEVOR SIE VERBINDLICH WIRD. Sie steht hier und
                    nicht in der Kopfzeile: wer gerade eine Figur vorgemerkt
                    hat, schaut hierhin.
                  */}
                  {isDirty(pending) ? (
                    <p className="mt-2 text-xs text-muted">
                      {modal.pendingSummary(pending.add.length, pending.remove.length,
                                            pending.swap.length)}
                      {" — "}
                      {modal.stagedCount(stagedCount(items, pending))}
                      {". "}
                      {modal.addFigureHint}
                    </p>
                  ) : null}
                  {/*
                    UND DIE RÜCKFRAGE, WENN EIN BELEG EXISTIERT. Sie erscheint
                    beim ersten `Speichern` und bleibt stehen, bis es ein
                    zweites Mal gedrückt wird — kein Modal über dem Modal.
                  */}
                  {/*
                    UND SIE VERSCHWINDET, WENN SIE NICHT MEHR ZUTRIFFT.
                    Nimmt der Betreiber den Wechsel zurueck (↩), gibt es
                    nichts mehr zu bestaetigen — eine stehende Warnung waere
                    dann eine Behauptung ueber einen Zustand, den es nicht
                    gibt. Dieselbe Bedingung wie im Tor von `save`.
                  */}
                  {receiptPrompt && receipt !== null
                   && needsReceiptConfirm(receipt !== null, pending) ? (
                    <div role="alert"
                         className="mt-2 rounded-sky-md bg-surface p-2 text-xs ring-1 ring-danger/40">
                      <p className="font-medium">{modal.receiptWarnHeading}</p>
                      <p className="mt-1 text-muted">
                        {modal.receiptWarnBody(receipt.receiptNumber)}
                      </p>
                      {/*
                        ZWEI KNOEPFE, UND EINER DAVON SCHREIBT.
                        Hier stand „Trotzdem speichern" als Satz — eine
                        Handlung, die aussah wie ein Knopf und keiner war.
                        `save(true)` ist der einzige Weg zum Schreiben;
                        `Zurueck` schliesst nur die Frage und verwirft NICHTS.
                      */}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button type="button" disabled={saving} aria-busy={saving}
                                onClick={() => void save(true)}
                                className="min-h-9 rounded-sky-md bg-surface px-2 text-xs font-medium text-danger ring-1 ring-danger/50 hover:ring-danger disabled:opacity-50">
                          {saving ? modal.saving : modal.receiptWarnConfirm}
                        </button>
                        <button type="button" disabled={saving}
                                onClick={() => setReceiptPrompt(false)}
                                className="min-h-9 rounded-sky-md px-2 text-xs text-muted ring-1 ring-border/70 hover:text-fg disabled:opacity-50">
                          {modal.receiptWarnBack}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </Section>

        {/*
          DER EIGENBELEG (0122) — als letzter Abschnitt.

          Er ist der Abschluss: wer ihn ausstellt, hat alles darüber gesehen.
          Die Inline-Bearbeitung und die Figurentabelle berührt er nicht; er
          hat keinen Bearbeitungszustand, nur einen Knopf.
        */}
        <Section title={receiptCopy.section}>
          {receiptFailed ? (
            <p role="alert" className="text-xs text-danger">{receiptCopy.failed}</p>
          ) : !receiptLoaded ? (
            <p className="text-xs text-muted">{receiptCopy.loading}</p>
          ) : (
            <>
              {receipt === null ? (
                <p className="text-xs text-muted">{receiptCopy.none}</p>
              ) : (
                <>
                  <Line label={receiptCopy.section} value={receipt.receiptNumber} strong />
                  <p className="text-xs text-muted">
                    {receiptCopy.issuedOn(formatDate(receipt.issuedAt))}
                  </p>
                  {/*
                    DER HAKEN HÄNGT AN EINER BESTÄTIGTEN AUSLIEFERUNG, nicht
                    am Vorhandensein des Belegs. „Ausgestellt" und „abgerufen"
                    sind zwei Dinge, und die Oberfläche sagt welches.
                  */}
                  {receipt.firstDeliveredAt === null ? (
                    <p className="text-xs text-muted">{receiptCopy.notDelivered}</p>
                  ) : (
                    <p role="status" className="text-xs font-medium text-success">
                      <span aria-hidden="true">✓ </span>
                      {receiptCopy.deliveredOn(formatDate(receipt.firstDeliveredAt))}
                    </p>
                  )}
                  {receipt.stale ? (
                    <p role="alert" className="mt-1 text-xs text-danger">{receiptCopy.stale}</p>
                  ) : null}
                </>
              )}

              {receiptError === null ? null : (
                <p role="alert" className="mt-1 text-xs text-danger">{receiptError}</p>
              )}

              {/*
                FREIGABE B STEHT AUS (`RECEIPT_ISSUANCE_RELEASED`).

                Derselbe Knopf tut zwei Dinge: ohne Beleg STELLT er aus, mit
                Beleg lädt er herunter. Ohne Freigabe darf nur das Zweite
                übrig bleiben — also steht hier ein Satz statt des Knopfes,
                solange es nichts herunterzuladen gibt.

                Die Sperre ist das nicht: die liegt als `revoke execute` in
                der Datenbank. Dies erspart den Klick, der ohnehin mit
                „Dafür fehlt die Berechtigung" endete.
              */}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {!RECEIPT_ISSUANCE_RELEASED && receipt === null ? (
                  <p className="text-xs text-muted">{receiptCopy.issuanceLocked}</p>
                ) : (
                  <button type="button" disabled={receiptBusy || editing}
                          onClick={() => void fetchReceipt()}
                          className={BUTTON}>
                    {receiptBusy ? receiptCopy.working
                      : receipt === null ? receiptCopy.create : receiptCopy.download}
                  </button>
                )}
                {/*
                  DER KORREKTURBELEG (0128) — nur, wenn es etwas zu korrigieren
                  gibt. `correctable` kommt aus derselben Bedingung wie das Tor
                  im Server: eine Handlung, die immer abgelehnt wuerde, ist
                  schlimmer als eine fehlende.
                */}
                {RECEIPT_ISSUANCE_RELEASED
                 && receipt !== null && correctable && !correctPrompt ? (
                  <button type="button" disabled={receiptBusy || editing}
                          onClick={() => { setReceiptError(null); setCorrectPrompt(true); }}
                          className={BUTTON}>
                    {receiptCopy.correct}
                  </button>
                ) : null}
              </div>

              {/*
                DIE RUECKFRAGE. Ein Beleg ist ein Dokument; ihn auszustellen ist
                nichts, was ein Klick nebenbei tun sollte. Erst `correctNow`
                ruft den Server — der erste Klick setzt nur diese Anzeige.
              */}
              {correctPrompt && receipt !== null ? (
                <div role="alert"
                     className="mt-2 rounded-sky-md bg-surface p-2 text-xs ring-1 ring-attention/50">
                  <p className="font-medium">{receiptCopy.correctConfirmHeading}</p>
                  <p className="mt-1 text-muted">{receiptCopy.correctConfirmBody}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button type="button" disabled={receiptBusy} aria-busy={receiptBusy}
                            onClick={() => void correctNow()}
                            className="min-h-9 rounded-sky-md bg-surface px-2 text-xs font-medium ring-1 ring-fg/40 hover:ring-fg/60 disabled:opacity-50">
                      {receiptBusy ? receiptCopy.correcting : receiptCopy.correctConfirmYes}
                    </button>
                    <button type="button" disabled={receiptBusy}
                            onClick={() => setCorrectPrompt(false)}
                            className="min-h-9 rounded-sky-md px-2 text-xs text-muted ring-1 ring-border/70 hover:text-fg disabled:opacity-50">
                      {receiptCopy.correctConfirmNo}
                    </button>
                  </div>
                </div>
              ) : null}

              {/* Während der Bearbeitung würde ein Beleg den ALTEN Stand
                  einfrieren — deshalb gesperrt, und mit einem Satz dazu. */}
              {editing ? (
                <p className="mt-1 text-xs text-muted">{receiptCopy.editingBlocked}</p>
              ) : null}

              {/*
                WELCHEN STAND EINE DATEI TRAEGT (Regel 10).
                Der Satz stand nicht da, und auf Staging hat genau das einen
                Fehlalarm ausgeloest: ein erneuter Abruf zeigte die alten
                Figuren — richtig, aber nicht erwartbar.
              */}
              <p className="mt-1 text-xs text-muted">{receiptCopy.frozenHint}</p>
              <p className="mt-1 text-xs text-muted">{receiptCopy.deliveredHint}</p>

              {/* ---- die Beleghistorie (0128) ------------------------------ */}
              {historyFailed ? (
                <p role="alert" className="mt-2 text-xs text-danger">
                  {receiptCopy.historyFailed}
                </p>
              ) : history === null ? (
                receipt === null ? null : (
                  <p className="mt-2 text-xs text-muted">{receiptCopy.historyLoading}</p>
                )
              ) : history.length <= 1 ? null : (
                <div className="mt-3">
                  <p className="text-xs font-medium">{receiptCopy.historyHeading}</p>
                  <ul className="mt-1 divide-y divide-border/40">
                    {/*
                      NEUESTE ZUERST. Die Serverfunktion liefert aufsteigend
                      nach Revision — fuer eine Liste, in der die aktuelle
                      Fassung oben steht, wird hier umgedreht und nicht dort:
                      die aufsteigende Reihenfolge ist die der Kette.
                    */}
                    {[...history].reverse().map((fassung) => (
                      <li key={fassung.id} className="flex flex-wrap items-baseline gap-x-2 py-1">
                        <span className="text-xs font-medium tabular-nums">
                          {fassung.receiptNumber}
                        </span>
                        <span className={`rounded-sky-md px-1.5 text-xs ring-1 ${
                          fassung.isCurrent
                            ? "text-success ring-success/40"
                            : "text-muted ring-border/70"}`}>
                          {fassung.isCurrent ? receiptCopy.current : receiptCopy.superseded}
                        </span>
                        <span className="text-xs text-muted">
                          {receiptCopy.revisionLabel(fassung.revision)}
                          {" · "}
                          {formatDate(fassung.issuedAt)}
                          {" · "}
                          {receiptCopy.lineCount(fassung.lineCount)}
                        </span>
                        {fassung.supersedesNumber === null ? null : (
                          <span className="text-xs text-muted">
                            {receiptCopy.supersedesLabel(
                              fassung.supersedesNumber,
                              formatDate(fassung.supersedesIssuedAt ?? ""))}
                          </span>
                        )}
                        {fassung.firstDeliveredAt === null ? (
                          <span className="text-xs text-muted">{receiptCopy.notDelivered}</span>
                        ) : (
                          <span className="text-xs text-success">
                            <span aria-hidden="true">✓ </span>
                            {receiptCopy.deliveredOn(formatDate(fassung.firstDeliveredAt))}
                          </span>
                        )}
                        <span className="flex-1" />
                        <button type="button" disabled={receiptBusy || editing}
                                aria-label={receiptCopy.downloadVersion(fassung.receiptNumber)}
                                onClick={() => void fetchReceipt({
                                  id: fassung.id, receiptNumber: fassung.receiptNumber,
                                })}
                                className="min-h-9 rounded-sky-md px-2 text-xs text-muted ring-1 ring-border/70 hover:text-fg disabled:opacity-50">
                          {receiptCopy.download}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {/* Was eine ersetzte Fassung ist — und was sie bleibt. */}
                  {history.some((f) => !f.isCurrent) ? (
                    <p className="mt-1 text-xs text-muted">{receiptCopy.supersededByHint}</p>
                  ) : null}
                </div>
              )}
            </>
          )}
        </Section>
      </div>
    </Modal>
  );
}
