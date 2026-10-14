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
  confirmPurchaseReceiptDownload, issuePurchaseReceipt, loadPurchaseReceipt,
  type ReceiptState,
} from "@/lib/business/receipt-actions";
import { canBook, canRemapItem } from "@/lib/orderbook/purchase";
import { dispatchItemAction } from "@/lib/orderbook/dispatch-lock";
import type { FigureChoice } from "@/lib/orderbook/figure-search";
import type { PurchaseItem } from "@/lib/orderbook/queries";
import { formatPrice } from "@/lib/format";
import { fixedNumber } from "@/lib/format-number";
import { de } from "@/lib/i18n/de";
import {
  loadPurchaseRecord, swapPurchaseDailyIndex, updatePurchase,
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

  const readRecord = useCallback(async () => {
    const loaded = await loadPurchaseRecord(purchase.id);
    if (loaded === null) { setRecordFailed(true); return; }
    setRecordFailed(false);
    setRecord(loaded);
    setContact(contactOf(loaded));
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

  useEffect(() => {
    let alive = true;
    void loadPurchaseReceipt(purchase.id).then((result) => {
      if (!alive) return;
      if (!result.ok) { setReceiptFailed(true); setReceiptLoaded(true); return; }
      setReceipt(result.receipt);
      setReceiptLoaded(true);
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
  }

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
    const saved = await run(() => updatePurchase(
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
    ));
    /* Die Anzeige liest denselben Stand wie das Formular. */
    await readRecord();
    /*
     * NUR BEI ERFOLG ZURÜCK IN DIE ANSICHT. Scheitert das Speichern, bleiben
     * die Felder stehen und tragen weiter, was getippt wurde — die Meldung
     * oben sagt, warum. Ein Fenster, das bei einem Fehler in die Ansicht
     * zurückfällt, hätte die Eingabe verschluckt.
     */
    if (saved) setEditing(false);
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
  async function fetchReceipt() {
    if (editing || receiptBusy) return;
    setReceiptBusy(true);
    setReceiptError(null);
    try {
      let current = receipt;
      if (current === null) {
        const issued = await issuePurchaseReceipt(purchase.id);
        if (!issued.ok) { setReceiptError(issued.message); return; }
        current = issued.receipt;
        setReceipt(current);
        if (current === null) { setReceiptError(receiptCopy.errors.unknown); return; }
      }

      const response = await fetch(`/business/orderbuch/${purchase.id}/beleg/${current.id}`);
      if (!response.ok) { setReceiptError(receiptCopy.errors.downloadFailed); return; }
      const bytes = await response.arrayBuffer();

      /* Der Beweis, dass die GANZEN Bytes ankamen. Mehr sagt er nicht. */
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hex = [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, "0")).join("");

      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${current.receiptNumber}.pdf`;
      link.click();
      URL.revokeObjectURL(url);

      const confirmed = await confirmPurchaseReceiptDownload(
        current.id, hex, bytes.byteLength);
      if (!confirmed.ok) { setReceiptError(confirmed.message); return; }
      setReceipt(confirmed.receipt);
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
            Eine Arbeitsmappenzeile wird nicht bearbeitet. `seller_update_purchase`
            würde es annehmen, aber ihre Zahlen sind die der Excel-Historie —
            ein Knopf, der sie überschreibbar aussehen lässt, ist eine
            Einladung. Dieselbe Zurückhaltung wie bei `isHistorical` auf der
            Detailseite.
          */}
          {purchase.source === "excel_order_2026" ? null : editing ? (
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

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" disabled={receiptBusy || editing}
                        onClick={() => void fetchReceipt()}
                        className={BUTTON}>
                  {receiptBusy ? receiptCopy.working
                    : receipt === null ? receiptCopy.create : receiptCopy.download}
                </button>
              </div>

              {/* Während der Bearbeitung würde ein Beleg den ALTEN Stand
                  einfrieren — deshalb gesperrt, und mit einem Satz dazu. */}
              {editing ? (
                <p className="mt-1 text-xs text-muted">{receiptCopy.editingBlocked}</p>
              ) : null}
              <p className="mt-1 text-xs text-muted">{receiptCopy.deliveredHint}</p>
            </>
          )}
        </Section>
      </div>
    </Modal>
  );
}
