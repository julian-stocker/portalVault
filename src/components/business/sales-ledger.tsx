"use client";

/**
 * The Verkauf ledger (ADR-0089).
 *
 * The Einkauf ledger's IMPLEMENTATION, not merely its shape. Every element
 * here comes from `ledger-table.tsx` and lands on `.ob-row` / `.ob-item` —
 * the same two rules the purchase ledger renders through, which are the rules
 * that demonstrably work in the owner's browser.
 *
 * The previous version had its own `.ob-sale` family mirroring `.ob-row`
 * faithfully, and it still rendered as one run-on line while Einkauf, from the
 * same stylesheet and the same layer, did not. A rule only one ledger depends
 * on is a rule that can go missing for only that ledger. So Verkauf no longer
 * has one: its ten tracks are an inline custom property on the container,
 * delivered in the same response as the markup.
 *
 * WHAT IS DIFFERENT, AND WHY
 *
 * Three extra columns that only a sale has: `Erwartet`, `Gemeldet` and `Δ`.
 * Payout reconciliation is the reason the owner wants to stop keeping the
 * spreadsheet, so all three sit in the collapsed row rather than behind a
 * click — and a missing reported payout reads `Offen`, never `0,00 €`.
 *
 * Ten columns do not fit a narrow window, so the ledger keeps its width and
 * scrolls sideways. Squeezing the table instead would cost the alignment that
 * is the entire point of a table.
 */

/*
 * ZEHN SPALTEN, UND DIE FLEXIBLE IST DER KÄUFER.
 *
 * Datum · EU · Artikel · Summe · Versand · Rabatt · Fees · Label ·
 * Rückerst. · Käufer
 *
 * Die Überschriften sind weiter die der Arbeitsmappe: `Order 2026!T4` heißt
 * wörtlich `EU`, U `Summe`, V `Versand`, W `Rabatt`, X+AA die Gebühren, Y+Z
 * die Labels, AD `Refund`. `Fees` und `Label` sind disjunkte Hälften
 * derselben Gebührentabelle und kommen als Aggregate aus `seller_sales()`
 * (0062) — ein Label steht nie in beiden.
 *
 * WAS SICH GEÄNDERT HAT UND WARUM
 *
 *   `Artikel`      neu. Die Zahl der Positionen stand nirgends in der Zeile,
 *                  obwohl `seller_sales()` sie seit 0062 mitliefert — man
 *                  musste aufklappen, um „ein Stück oder sieben" zu wissen.
 *                  Der Lagerstatus sitzt als Punkt davor (siehe `StockDot`).
 *   `Käufer`       neu, und die einzige Spur, die mitwächst: `buyer_ref` ist
 *                  das, womit der Betreiber eine Zeile wiedererkennt, wenn
 *                  eine Nachricht kommt.
 *   `Auszahlung`   aus der Tabelle heraus. Eine abgeleitete Zahl
 *                  (`sale_expected_payout()`), die im Geldfenster steht, wo
 *                  die Beträge stehen, aus denen sie entsteht.
 *   `Lager`        war 7,5rem Text — mehr als Summe und Versand zusammen.
 *                  Dieselbe Aussage steht jetzt als Punkt in `Artikel`, mit
 *                  demselben Satz im Tooltip und im zugänglichen Namen.
 *   `Details`      keine eigene Spalte mehr — und auch nicht mehr in der
 *                  aufgeklappten Zeile. Ein (i) VOR dem Datum öffnet dasselbe
 *                  Fenster, bei jeder Zeile, ohne Aufklappen. Es sitzt IN der
 *                  Datumsspur und nicht in einer eigenen: `.ob-row >
 *                  :first-child` klebt am linken Rand, und eine eigene erste
 *                  Spur hätte das Icon klebend gemacht und das Datum
 *                  wegscrollen lassen. Die Spur ist dafür 1,75rem breiter.
 *                  Der Link auf die Einzelansicht bleibt in der Aufklappung —
 *                  er führt woandershin.
 *
 * Die Geldspuren sind fest und schmal, nicht mehr `minmax(5rem, 1fr)`: acht
 * mitwachsende Geldspalten haben die Tabelle auf 71rem gehalten, obwohl
 * „12,34 €" in 4rem passt. Der gewonnene Platz geht an den Käufer.
 */
const SALE_COLUMNS =
  "7.25rem 2.25rem 5.5rem 5rem 4.25rem 4.25rem 4.25rem 4.25rem 4.5rem minmax(6rem, 1fr)";

/*
 * The item track list lives in `sale-indicator.tsx` and is shared with the
 * detail screen: seven cells, the Einkauf six with a narrow indicator in
 * front. One constant, both sale screens — the thing that produced two
 * different sale layouts in the first place.
 *
 * The four-column version this replaces folded `#` and `Serie` into the
 * figure cell's tooltip, where a phone could not reach them, and gave `Figur`
 * `minmax(9rem, 1fr)` inside a 71rem ledger — so it collected every bit of
 * slack and pushed status and action off the screen. What the owner saw was
 * a row of empty cells with a button at the end of it.
 */

/*
 * 15rem schmaler als vor der Verdichtung: zehn Spuren statt elf, und die acht
 * Geldspuren sind fest statt mitwachsend. Die 1,75rem gegenüber den 54rem
 * davor sind das (i) in der Datumsspur. Was die Spuren an ihren Untergrenzen
 * brauchen, plus die Lücken, plus den Innenabstand der Zeile — `sales.test.ts`
 * rechnet das nach, damit diese Zahl keine Schätzung bleibt.
 */
const SALE_MIN_WIDTH = "56rem";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { formatDeduction, formatPrice } from "@/lib/format";
import { SALE_ITEM_COLUMNS, SaleIndicator } from "./sale-indicator";
import { de } from "@/lib/i18n/de";
import { announceSaleItemReturn, bookSaleItem, loadSale, receiveSaleItemReturn,
  restockSaleItem, setSaleItemNotShipped, shipSaleItem,
  shipSale, type ItemResult } from "@/lib/orderbook/sales-actions";
import type { SaleRow, SalesSummary } from "@/lib/orderbook/sales-queries";
import { commerceLineIndicator, commerceLineStatus } from "@/lib/orderbook/commerce-line-status";
import {
  countryLabel, saleItemActions, saleStockIndicator, saleStockStatus, saleItemIndicator,
  legacyOutcome, type LegacyOutcome,
  openFreeItemCount,
} from "@/lib/orderbook/sales-view";

/** Outcome → the sentence the status dot reads out (0087). */
const LEGACY_LABEL: Record<LegacyOutcome, keyof typeof de.business.sales.itemIndicator> = {
  shipped: "legacyShipped",
  not_shipped: "legacyNotShipped",
  returned: "legacyReturned",
  lost: "legacyLost",
  shipped_unreferenced: "legacyShippedUnreferenced",
  unresolved: "legacyUnresolved",
};
import { SaleDetails } from "./sale-details";
import {
  LedgerExpansion, LedgerHead, LedgerItemHead, LedgerItemRow, LedgerRow, LedgerTable,
} from "./ledger-table";
import { RowMarks } from "./orderbook-nav";

const copy = de.business.sales;

const formatDate = (iso: string | null): string =>
  iso === null ? copy.undated
    : new Date(iso).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });

/**
 * Der Lagerstatus eines Verkaufs, als Punkt vor der Artikelzahl (0072/0075).
 *
 * DIESELBE AUSSAGE WIE DIE SPALTE `Lager`, DIE ER ERSETZT. Status und Satz
 * kommen unverändert aus `saleStockStatus()` und `copy.stock`; `saleStockIndicator`
 * übersetzt nur in Ton und Zeichen. Es wird nichts nachgerechnet und nichts
 * neu entschieden — `outbookedCount`, `settledCount` und `closedCount`
 * entstehen in `seller_sales()` und nirgends sonst.
 *
 * NICHT NUR FARBE: jeder Ton hat sein eigenes Zeichen, und der ganze Satz
 * steht im `title` UND im zugänglichen Namen. Der Punkt ist damit auch in
 * Graustufen, unter `forced-colors` und für einen Screenreader lesbar — und
 * verloren geht gegenüber der Textspalte nichts außer der Breite.
 *
 * `Ausgebucht ✓` heißt weiterhin: jede Position besitzt eine
 * `sale_external`-Bewegung. Ein Verkauf, der teils durch „Erledigt"
 * geschlossen wurde, sagt `Abgeschlossen` und trägt den grauen Haken nicht.
 */
function StockDot({ sale }: { sale: SaleRow }) {
  const status = saleStockStatus(sale);
  const c = copy.stock;
  const text = status === "outbooked" ? c.outbooked
    : status === "returned" ? c.returned
    : status === "closed" ? c.closed
    : status === "cancelled" ? c.cancelled
    : status === "frozen" ? c.frozen
    : status === "partial" ? `${sale.closedCount} von ${sale.itemCount}`
    : c.open;
  const title = status === "outbooked" ? c.outbookedHint
    : status === "returned" ? c.returnedHint
    : status === "closed" ? c.closedHint(sale.outbookedCount, sale.restockedCount,
                                         sale.settledCount, sale.notShippedCount)
    : status === "cancelled" ? c.cancelledHint
    : status === "frozen" ? c.frozenHint
    : status === "partial" ? c.partial
    : c.openHint;
  /* Zustand und Begründung, in einem Namen: „Offen — noch nichts ausgebucht". */
  return <SaleIndicator indicator={saleStockIndicator(status)} label={`${text} — ${title}`} />;
}

function Summary({ summary }: { summary: SalesSummary }) {
  const cells = [
    { key: "count", label: copy.summary.count, value: summary.saleCount.toLocaleString("de-AT"),
      hint: `${summary.itemCount.toLocaleString("de-AT")} ${copy.summary.items}` },
    { key: "gross", label: copy.summary.gross, value: formatPrice(summary.gross), hint: null },
    { key: "expected", label: copy.summary.expected, value: formatPrice(summary.expectedPayout), hint: null },
  ];
  return (
    <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {cells.map((cell) => (
        <div key={cell.key} className="rounded-sky-md bg-surface/70 px-3 py-1.5 ring-1 ring-border/60">
          <dt className="text-xs leading-tight text-muted">{cell.label}</dt>
          <dd className="leading-tight tabular-nums">{cell.value}</dd>
          {cell.hint ? <dd className="text-xs leading-tight text-muted">{cell.hint}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

type Detail = Record<string, unknown>;

export function SalesLedger({ sales, summary, backHref, openSale }: {
  sales: SaleRow[]; summary: SalesSummary; backHref: string;
  /**
   * Ein Verkauf, der beim Laden schon offen sein soll (`?verkauf=`).
   *
   * Dafür gibt es genau einen Anlass: gerade angelegt. Das Formular
   * schickte bisher auf die eigene Detailseite; jetzt landet der Betreiber
   * im Verkaufsbuch, sieht die Zeile in ihrer Umgebung — und bekommt
   * dieselbe Übersicht und dasselbe Bearbeitungsfenster wie bei jedem
   * anderen Verkauf, statt einer zweiten Oberfläche für denselben Zweck.
   */
  openSale?: number;
}) {
  const [open, setOpen] = useState<ReadonlySet<number>>(
    () => new Set([...sales.filter((s) => s.matchItems.length > 0).map((s) => s.id),
                   ...(openSale !== undefined ? [openSale] : [])]));
  const [details, setDetails] = useState<Record<number, Detail | "failed">>({});
  /*
   * Which sale's breakdown is open. Separate from `open`, which is the item
   * list: the chevron and the Details button are two controls doing two
   * things, and neither may move the other.
   */
  /*
   * Der gerade angelegte Verkauf steht von der ersten Darstellung an offen:
   * aufgeklappt (siehe `open`) und im Bearbeitungsfenster. Die Positionen mit
   * „Verschickt" und „×" liegen in der aufgeklappten Zeile, die Kopfdaten im
   * Fenster — schließt der Betreiber das Fenster, steht er genau dort, wo er
   * weiterarbeitet. Kein Effekt nötig: `openSale` kommt aus der Adresse, das
   * Schließen räumt sie auf, und geladen wird die Zeile ohnehin über `open`.
   */
  const [showing, setShowing] = useState<number | null>(
    () => (openSale !== undefined && sales.some((s) => s.id === openSale) ? openSale : null));
  const router = useRouter();
  /*
   * WELCHE POSITION GERADE LÄUFT, nicht „läuft irgendetwas".
   *
   * Hier stand ein `useTransition`, dessen `pending` an jedem Knopf jeder
   * Position jeder aufgeklappten Zeile hing. Ein Klick sperrte das ganze
   * Verkaufsbuch, bis Next die Route neu gerendert hatte. Jetzt ist die
   * Menge der beschäftigten Positionen der Zustand, und `sale_items.id` ist
   * über alle Verkäufe eindeutig — eine Menge genügt für die ganze Liste.
   */
  const [busy, setBusy] = useState<ReadonlySet<number>>(() => new Set());
  /*
   * FEHLER GEHÖREN DER POSITION, NICHT DER TABELLE.
   *
   * Hier stand eine einzige Meldung über dem Verkaufsbuch. Bei schnellem
   * Arbeiten war dann nicht zu sehen, WELCHE der fünf gerade angeklickten
   * Positionen abgelehnt wurde — und die nächste Meldung überschrieb die
   * vorige. Jetzt steht sie in der Zeile, die sie betrifft, und nur diese
   * Zeile fällt auf ihren alten Zustand zurück.
   *
   * Der gemeinsame `error`-Zustand über der Tabelle ist damit weg und nicht
   * bloß unbenutzt: eine Stelle, die eine Meldung anzeigen KÖNNTE, aber von
   * nichts mehr gefüllt wird, ist eine Einladung, sie wieder zu füllen.
   */
  const [failed, setFailed] = useState<ReadonlyMap<number, string>>(() => new Map());
  const loading = useRef<Set<number>>(new Set());
  /*
   * DIE LAUFENDE NUMMER DER LETZTEN LESEANFRAGE JE VERKAUF.
   *
   * Zwei Klicks hintereinander heißen zwei Antworten, und sie kommen nicht
   * zwingend in der Reihenfolge zurück, in der sie losgeschickt wurden. Ohne
   * diese Nummer kann die ältere die jüngere überschreiben — und die Zeile
   * zeigt wieder den Zustand VOR dem zweiten Klick. Jede Leseanfrage merkt
   * sich ihre Nummer und schreibt nur, wenn sie noch die aktuelle ist.
   */
  const reads = useRef<Map<number, number>>(new Map());
  /*
   * WELCHE POSITIONEN GERADE LAUFEN — als Ref, nicht als State.
   *
   * `busy` ist die Darstellung; dies ist die Sperre. Zwei Klicks auf
   * dieselbe Position innerhalb eines Renderdurchlaufs sehen beide noch das
   * alte `busy` und kämen beide durch; ein Ref ist sofort aktuell.
   */
  const inflight = useRef<Set<number>>(new Set());
  /*
   * DAS BÜNDELN DES LISTEN-REFRESHS, OHNE TIMER.
   *
   * `router.refresh()` holt die eingeklappte Zeile nach — Artikelzahl und
   * Lagerpunkt kommen aus `seller_sales()` und nicht aus `seller_sale()`.
   * Pro Klick einer davon war der eigentliche Grund für das Flackern: fünf
   * Klicks hintereinander hießen fünf Server-Renders der ganzen Route.
   *
   * Gebündelt wird am EREIGNIS, nicht an einer Wartezeit: solange noch eine
   * Positionsaktion unterwegs ist, wird nicht nachgeholt. Die letzte, die
   * fertig wird, holt einmal für alle nach. Kein Timeout, keine künstliche
   * Verzögerung — wer nur einmal klickt, bekommt den Refresh sofort.
   */
  const outstanding = useRef(0);
  const listStale = useRef(false);

  /*
   * DIE VERSANDAKTION EINES GANZEN VERKAUFS — EIGENER ZUSTAND, EIGENER
   * SCHLÜSSEL.
   *
   * `busy` und `failed` sind nach `sale_items.id` geschlüsselt. Eine
   * Verkaufs-ID in dieselbe Menge zu legen wäre eine Kollision, die niemand
   * sieht: beide Folgen sind Identitäten aus verschiedenen Tabellen, und ein
   * laufender Versand hätte irgendeine fremde Position gesperrt.
   */
  const [shipping, setShipping] = useState<ReadonlySet<number>>(() => new Set());
  const [shipFailed, setShipFailed] = useState<ReadonlyMap<number, string>>(() => new Map());
  const [shipDone, setShipDone] = useState<ReadonlyMap<number, { settled: number; open: number }>>(
    () => new Map());
  const shippingRef = useRef<Set<number>>(new Set());

  const load = useCallback((id: number, force = false) => {
    if (!force && loading.current.has(id)) return;
    const token = (reads.current.get(id) ?? 0) + 1;
    reads.current.set(id, token);
    loading.current.add(id);
    void loadSale(id).then((d) => {
      /* Eine überholte Antwort schreibt nicht über den neueren Zustand. */
      if (reads.current.get(id) !== token) return;
      loading.current.delete(id);
      setDetails((current) => ({ ...current, [id]: d ?? "failed" }));
    });
    /*
     * UND DIE ALTEN ZEILEN BLEIBEN STEHEN.
     *
     * Hier wurde `details[id]` beim Nachlesen gelöscht, womit die
     * aufgeklappte Liste auf „Positionen werden geladen …" zurückfiel —
     * einmal pro Klick, mitten unter dem Finger. Die Liste ist eine
     * Sekunde lang veraltet; das ist unendlich viel besser, als dass sie
     * eine Sekunde lang nicht da ist.
     */
  }, []);

  /**
   * EIN EXTERNER VERKAUF WIRD VERSCHICKT — UND SEINE FREIEN POSITIONEN ENDEN.
   *
   * `seller_ship_sale` aus `0112`, unverändert: ein Aufruf, eine Transaktion.
   * Hier wird nichts nachgerechnet; `settled` und `still_open` kommen aus der
   * Datenbank, die sie gerade geschrieben hat.
   *
   * Danach wird die aufgeklappte Zeile nachgelesen. Die eingeklappte Zeile
   * holt sich `revalidatePath` in der Server Action — Artikelzahl, Lagerpunkt
   * und `is_open` kommen aus `seller_sales()` und werden nicht nachgeahmt.
   */
  const ship = (saleId: number) => {
    if (shippingRef.current.has(saleId)) return;
    shippingRef.current.add(saleId);
    setShipping((current) => new Set(current).add(saleId));
    setShipFailed((current) => {
      if (!current.has(saleId)) return current;
      const next = new Map(current); next.delete(saleId); return next;
    });
    void (async () => {
      try {
        const result = await shipSale(saleId);
        if (!result.ok) {
          setShipFailed((current) => new Map(current).set(saleId, result.message));
          return;
        }
        setShipDone((current) => new Map(current)
          .set(saleId, { settled: result.settled, open: result.stillOpen }));
        load(saleId, true);
      } finally {
        shippingRef.current.delete(saleId);
        setShipping((current) => { const next = new Set(current); next.delete(saleId); return next; });
      }
    })();
  };

  /* Details reuses the same lazily-loaded payload the item list uses. */
  const onDetails = (id: number) => { setShowing(id); load(id); };

  const toggle = (id: number) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    if (!open.has(id)) load(id);
  };

  useEffect(() => {
    for (const id of open) load(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * EINE POSITION ANFASSEN, WÄHREND VIER ANDERE NOCH LAUFEN.
   *
   * `saleId` sagt, welcher Verkauf nachgelesen wird; `key` ist die Position,
   * die währenddessen gesperrt ist. Zwei verschiedene Positionen — auch in
   * zwei verschiedenen Verkäufen — behindern sich nicht.
   *
   * WAS „OPTIMISTISCH" HIER HEISST, UND WAS NICHT.
   *
   * Die angeklickte Zeile reagiert sofort: ihr Status sagt „läuft …" und ihr
   * Knopf ist gesperrt, bevor der Server antwortet. Sie behauptet aber NICHT
   * das Ergebnis. Ein vorweggenommenes „Ausgebucht" müsste den Endzustand
   * aus den Zeitstempeln erraten, die die Datenbank gerade schreibt — das
   * wäre eine zweite Wahrheit über denselben Bestand, und bei einer
   * Ablehnung hätte die Zeile eine Sekunde lang gelogen. `saleItemActions`
   * bleibt die einzige Stelle, die einen Positionszustand bestimmt.
   *
   * DEN ENDZUSTAND BRINGT DIE ANTWORT SELBST MIT. `runItem` liest
   * `seller_sale` in derselben Server Action nach (0110), also ist der neue
   * Zustand da, sobald der Klick fertig ist — keine zweite Runde zum Server
   * und kein Fenster, in dem die Liste veraltet ist.
   */
  const act = (saleId: number, key: number, run: () => Promise<ItemResult>) => {
    /* Dieselbe Position zweimal: der zweite Klick fällt hier, nicht im Server. */
    if (inflight.current.has(key)) return;
    inflight.current.add(key);
    outstanding.current += 1;
    setBusy((current) => new Set(current).add(key));
    setFailed((current) => {
      if (!current.has(key)) return current;
      const next = new Map(current); next.delete(key); return next;
    });
    void (async () => {
      try {
        const result = await run();
        if (!result.ok) {
          /* Zurück auf den alten Zustand — und nur diese Zeile. */
          setFailed((current) => new Map(current).set(key, result.message));
          return;
        }
        const items = (result.sale as Detail | null)?.items;
        if (Array.isArray(items)) {
          /*
           * Die Antwort IST der neue Zustand dieses Verkaufs. Sie zählt
           * als Leseanfrage, damit eine noch unterwegs befindliche ältere
           * sie nicht wieder überschreibt.
           */
          reads.current.set(saleId, (reads.current.get(saleId) ?? 0) + 1);
          loading.current.delete(saleId);
          setDetails((current) => ({ ...current, [saleId]: result.sale as Detail }));
        } else {
          /* Das Nachlesen in der Aktion ist fehlgeschlagen, die Aktion nicht. */
          load(saleId, true);
        }
        /*
         * DIE EINGEKLAPPTE ZEILE GEHÖRT DER LISTE, NICHT DEM DETAIL.
         *
         * Artikelzahl und Lagerpunkt kommen aus `seller_sales` — mit
         * `outbookedCount`, `settledCount` und `closedCount`, die `0072`
         * und `0075` dort und nur dort entscheiden. Die hier nachzurechnen
         * wäre eine zweite Wahrheit über denselben Bestand.
         *
         * Also wird die Liste nachgeholt statt nachgeahmt — aber einmal für
         * alle, siehe `outstanding`. Kein `revalidatePath`: das legt den
         * Server-Render in die Antwort der Aktion und hätte den Klick
         * wieder verlängert.
         */
        listStale.current = true;
      } finally {
        inflight.current.delete(key);
        setBusy((current) => { const next = new Set(current); next.delete(key); return next; });
        outstanding.current -= 1;
        if (outstanding.current === 0 && listStale.current) {
          listStale.current = false;
          router.refresh();
        }
      }
    })();
  };

  const showingSale = sales.find((s) => s.id === showing) ?? null;

  if (sales.length === 0) {
    return (<><Summary summary={summary} /><p className="mt-6 text-sm text-muted">{copy.empty}</p></>);
  }

  return (
    <>
      <Summary summary={summary} />

      <LedgerTable columns={SALE_COLUMNS} itemColumns={SALE_ITEM_COLUMNS}
                   minWidth={SALE_MIN_WIDTH}>
        <LedgerHead>
          <span>{copy.columns.date}</span>
          <span>{copy.columns.country}</span>
          <span>{copy.columns.items}</span>
          <span className="text-right">{copy.columns.sum}</span>
          <span className="text-right">{copy.columns.shipping}</span>
          <span className="text-right">{copy.columns.discount}</span>
          <span className="text-right">{copy.columns.fees}</span>
          <span className="text-right">{copy.columns.label}</span>
          {/* Abgekürzt, weil die Spur 4,5rem breit ist und „−12,34 €" darin
              stehen muss. Der ganze Name steht im Geldfenster. */}
          <span className="text-right">{copy.columns.refundShort}</span>
          <span>{copy.columns.buyer}</span>
        </LedgerHead>

        <ul className="divide-y divide-border/60">
          {sales.map((sale) => {
            const expanded = open.has(sale.id);
            const detail = details[sale.id];
            const gross = (sale.itemsSubtotal ?? 0) + (sale.shippingCharged ?? 0) - (sale.discountAmount ?? 0);
            return (
              <li key={sale.id}>
                <LedgerRow expanded={expanded} controls={`sale-${sale.id}`}
                           onToggle={() => toggle(sale.id)}
                           label={<>
                             {expanded ? copy.collapse : copy.expand} — {formatDate(sale.soldAt)}, {formatPrice(gross)}
                           </>}>
                  {/*
                    DAS (i) UND DAS DATUM IN EINER ZELLE.
                    
                    Das Icon öffnet dasselbe Geldfenster, das vorher am Ende
                    der aufgeklappten Zeile hing — jetzt bei JEDER Zeile und
                    ohne Aufklappen. Es sitzt in der Datumsspur, weil
                    `.ob-row > :first-child` am linken Rand klebt: eine eigene
                    erste Spur hätte beim Seitwärtsscrollen ein Icon ohne
                    Datum stehen lassen.
                    
                    `relative z-20` UND `stopPropagation`, und beides ist
                    nötig. Die durchsichtige Überlagerung der Zeile trägt
                    `z-10` und kommt SPÄTER im DOM — bei gleichem z-index
                    gewinnt sie und schluckt den Klick. Genau das ist der
                    Spalte „Details" schon einmal passiert.
                  */}
                  <span className="flex min-w-0 items-center gap-1">
                    <button type="button"
                            aria-label={copy.detailsFor(formatDate(sale.soldAt))}
                            title={copy.columns.details}
                            onClick={(event) => { event.stopPropagation(); onDetails(sale.id); }}
                            className="relative z-20 flex size-11 shrink-0 items-center justify-center rounded-sky-md text-xs text-muted ring-1 ring-border/70 hover:text-fg hover:ring-fg/30 sm:size-6">
                      <span aria-hidden="true">i</span>
                    </button>
                    <span className={`min-w-0 truncate ${
                      sale.soldAt === null ? "font-medium text-muted" : "font-medium tabular-nums"}`}>
                      {formatDate(sale.soldAt)}
                      <RowMarks isTest={sale.isTest} isIncomplete={sale.isIncomplete} isOpen={sale.isOpen} />
                    </span>
                  </span>
                  {/* `EU` in the workbook, and what it holds is the code. */}
                  <span className="truncate text-xs text-muted" title={countryLabel(sale.country)}>
                    {sale.country ?? "—"}
                  </span>
                  {/*
                    ARTIKEL — die Zahl der Positionen, mit dem Lagerstatus
                    davor. Beides kommt aus `seller_sales()`; die Zahl stand
                    bisher nur in der aufgeklappten Zeile, der Status in einer
                    eigenen 7,5rem-Textspalte.
                  */}
                  <span className="flex min-w-0 items-center gap-1.5">
                    <StockDot sale={sale} />
                    <span className="truncate text-xs tabular-nums text-muted">
                      {copy.itemsCount(sale.itemCount)}
                    </span>
                  </span>
                  <span className="ob-money text-right tabular-nums">
                    {formatPrice(sale.itemsSubtotal ?? 0)}
                  </span>
                  <span className="ob-money text-right tabular-nums text-muted">
                    {formatPrice(sale.shippingCharged ?? 0)}
                  </span>
                  <span className="ob-money text-right tabular-nums text-muted">
                    {formatPrice(sale.discountAmount ?? 0)}
                  </span>
                  {/* Two disjoint halves: a shipping label is in Label, never
                      in Fees, so the pair is the whole cost of the sale. */}
                  <span className="ob-money text-right tabular-nums text-muted">
                    {formatPrice(sale.feesTotal)}
                  </span>
                  <span className="ob-money text-right tabular-nums text-muted">
                    {formatPrice(sale.labelTotal)}
                  </span>
                  {/* Ein Abzug, und er sieht auch so aus (0097). Gespeichert
                      bleibt der Betrag positiv. */}
                  <span className={`ob-money text-right tabular-nums ${
                    sale.refunded > 0 ? "text-danger" : "text-muted"}`}>
                    {formatDeduction(sale.refunded)}
                  </span>
                  {/*
                    KÄUFER — die einzige mitwachsende Spur, und die letzte.
                    Sie bekommt, was die festen Spuren übrig lassen: ein
                    eBay-Benutzername ist mal sechs und mal dreißig Zeichen
                    lang, und abgeschnitten steht er immer noch im `title`.
                  */}
                  {/*
                    WIEDERHOLUNGSKÄUFER, GRÜN — UND NICHT NUR GRÜN (0113).

                    `buyerRepeat` kommt aus `seller_sales()` und wird hier
                    nicht nachgerechnet: die Antwort hängt an einem Fenster
                    über ALLE Verkäufe, und die Zeile kennt nur ihre eigene.

                    Das `↻` trägt die Aussage ohne Farbe — Graustufen,
                    `forced-colors`, Farbenblindheit — und hat einen eigenen
                    zugänglichen Namen. Dieselbe Regel wie beim Lagerpunkt.

                    `buyerLabel` statt `buyerRef`: extern die Referenz des
                    Marktplatzes, intern der Name aus der Lieferadresse
                    (B-1). Die Spalte war für Bestellungen leer.
                  */}
                  <span className={`flex min-w-0 items-center gap-1 text-xs ${
                    sale.buyerRepeat ? "font-medium text-success" : "text-muted"}`}
                        title={sale.buyerRepeat
                          ? `${sale.buyerLabel ?? ""} · ${copy.repeatBuyerHint}`.trim()
                          : sale.buyerLabel ?? undefined}>
                    {sale.buyerRepeat ? (
                      <span aria-label={copy.repeatBuyer} className="shrink-0">↻</span>
                    ) : null}
                    <span className="truncate">{sale.buyerLabel ?? "—"}</span>
                  </span>
                </LedgerRow>

                {sale.matchItems.length > 0 ? (
                  <p className="truncate px-3 pb-1 text-xs text-muted">
                    {sale.matchItems.slice(0, 4).map((m) => `${m.position}. ${m.name}`).join(" · ")}
                  </p>
                ) : null}

                {expanded ? (
                  <LedgerExpansion id={`sale-${sale.id}`}>
                    {detail === undefined ? (
                      <p className="px-3 py-2 text-xs text-muted">{copy.loadingItems}</p>
                    ) : detail === "failed" ? (
                      <p className="px-3 py-2 text-xs text-muted">{copy.itemsFailed}</p>
                    ) : (
                      <SaleDetail sale={sale} detail={detail} busy={busy}
                                  failed={failed} act={act} />
                    )}
                    {/*
                      NUR NOCH DIE EINZELANSICHT.

                      Der „Details"-Knopf stand hier zwei Releases lang und
                      ist jetzt das (i) in der Datumszelle — bei jeder Zeile
                      und ohne Aufklappen erreichbar. Er kommt hier nicht
                      zurück: ein Fenster, zwei Wege, einer davon versteckt,
                      wäre eine Einladung, beide zu pflegen.

                      Der Link bleibt, weil er etwas ANDERES tut: er führt auf
                      die eigene Seite des Verkaufs mit der vollen
                      Positionsliste.
                    */}
                    {/*
                      DIE VERSANDAKTION STEHT DORT, WO GEARBEITET WIRD.

                      Sie lag bis zur Produktionsabnahme nur im Verkaufsfenster
                      — und damit hinter dem (i), das wegen eines
                      Stapelkontexts nicht erreichbar war. Zusammen hiess das:
                      ein externer Verkauf aus lauter freien Artikeln zeigte in
                      der Liste eine offene Position OHNE jede Aktion
                      (`saleItemActions` nennt dafür `settle`, und das bietet
                      die Positionsspalte bewusst nicht an) und liess sich
                      nirgends abschliessen.

                      Angeboten nur, wenn es etwas zu tun gibt: ein externer,
                      nicht verschickter, nicht stornierter, nicht gefrorener
                      Verkauf mit mindestens einer OFFENEN FREIEN Position.
                      Eine rein regalgebundene Position bekommt weiter ihr
                      `Verschicken` je Zeile — zwei Wege zum selben Ergebnis
                      wären einer zu viel.
                    */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 pt-1.5">
                      <Link href={`/business/orderbuch/verkauf/${sale.id}?zurueck=${encodeURIComponent(backHref)}`}
                            className="text-xs text-muted underline underline-offset-2">
                        {copy.detail}
                      </Link>
                      {detail !== undefined && detail !== "failed"
                        && sale.orderId === null
                        && sale.shippedAt === null
                        && sale.cancelledAt === null
                        && !(sale.source === "excel_order_2026" && sale.stockReleasedAt === null)
                        && openFreeItemCount(
                          (detail.items ?? []) as never[],
                          { frozen: false, cancelled: false, shipped: false,
                            historical: sale.source === "excel_order_2026" }) > 0 ? (
                        <button type="button" disabled={shipping.has(sale.id)}
                                onClick={() => ship(sale.id)}
                                className="min-h-9 rounded-sky-md px-2 text-xs ring-1 ring-border/70 disabled:opacity-50">
                          {shipping.has(sale.id) ? copy.itemRunning : copy.detailsModal.markShipped}
                        </button>
                      ) : null}
                      {shipFailed.has(sale.id) ? (
                        <span role="alert" className="text-xs text-danger">
                          {shipFailed.get(sale.id)}
                        </span>
                      ) : null}
                      {shipDone.has(sale.id) ? (
                        <span role="status" className="text-xs text-muted">
                          {copy.detailsModal.markShippedDone(shipDone.get(sale.id)!.settled)}
                          {shipDone.get(sale.id)!.open > 0
                            ? ` ${copy.detailsModal.markShippedStillOpen(shipDone.get(sale.id)!.open)}`
                            : ""}
                        </span>
                      ) : null}
                    </div>
                  </LedgerExpansion>
                ) : null}
              </li>
            );
          })}
        </ul>
      </LedgerTable>

      {/*
        One dialog for the whole ledger, not one per row: a modal per sale
        would mount 293 portals to show none of them.
      */}
      {showingSale ? (
        <SaleDetails key={showingSale.id} sale={showingSale} detail={details[showingSale.id]}
                     open onClose={() => {
                       setShowing(null);
                       /* `?verkauf=` hat seinen Zweck erfüllt: ohne das
                          Aufräumen öffnete ein Neuladen dasselbe Fenster
                          wieder, und der Zurück-Knopf führte im Kreis. */
                       if (openSale !== undefined) router.replace(backHref);
                     }}
                     onSaved={() => { loading.current.delete(showingSale.id); load(showingSale.id, true); }} />
      ) : null}
    </>
  );
}

/** The expanded body: items, money and the payout, in the order work happens. */
function SaleDetail({ sale, detail, busy, failed, act }: {
  sale: SaleRow; detail: Detail;
  /** Die gerade laufenden Positionen, nach `sale_items.id`. */
  busy: ReadonlySet<number>;
  /** Die abgelehnten, mit ihrer Meldung — je Position, nicht je Tabelle. */
  failed: ReadonlyMap<number, string>;
  act: (saleId: number, key: number, run: () => Promise<ItemResult>) => void;
}) {
  const order = detail.order as Record<string, unknown> | null;
  const items = (detail.items ?? []) as Record<string, unknown>[];
  const lines = (order?.lines ?? []) as Record<string, unknown>[];
  const historical = String((detail.sale as Record<string, unknown>)?.source) === "excel_order_2026";

  return (
    <>
      {/*
        THE SAME SIX COLUMNS AN EXPANDED PURCHASE HAS, in the same order and
        from the same CSS rule. `Bestand` and `Retoure` stay merged into one
        status — that was right in 0075 and is unchanged — but `#` and `Serie`
        come back out of the tooltip and get the tracks they have next door.
      */}
      <LedgerItemHead>
        {/* No heading: the column is one glyph wide and the dot names
            itself through its aria-label. */}
        <span aria-hidden="true" />
        <span>#</span>
        <span>{copy.itemColumns.series}</span>
        <span>{copy.itemColumns.figure}</span>
        <span className="text-right">{copy.itemColumns.marketValue}</span>
        <span className="text-center">{copy.itemColumns.status}</span>
        <span className="text-right">{copy.itemColumns.action}</span>
      </LedgerItemHead>

      <ul className="divide-y divide-border/40">
        {/* An internal sale shows the ORDER's lines. There is no copy to show. */}
        {order
          ? lines.map((line, index) => {
              /*
               * NICHT MEHR EINE KONSTANTE FÜR ALLE (0096).
               *
               * Hier stand für jede bezahlte Zeile „Verschickt ✓" — eine
               * Aussage über die Zahlung, als Aussage über das Paket
               * gedruckt. Seit 0095 kann eine Position storniert sein oder
               * zurückkommen, und `seller_sale()` liefert die Mengen seit
               * 0096 mit. Ein Teilstorno zeigt die Teile nebeneinander,
               * statt die ganze Position falsch zu etikettieren.
               */
              const state = commerceLineStatus({
                quantity: Number(line.quantity),
                cancelled: line.cancelled as number | null | undefined,
                returned: line.returned as number | null | undefined,
              }, String(order.fulfillment_status ?? ""));
              const text = state.kind === "cancelled" ? copy.commerceLine.cancelled
                : state.kind === "returned" ? copy.commerceLine.returned
                : state.kind === "shipped" ? copy.itemStates.outbooked
                : state.kind === "open" ? copy.itemStates.open
                : state.parts.map((part) =>
                    part.kind === "cancelled" ? copy.commerceLine.cancelledPart(part.quantity)
                    : part.kind === "returned" ? copy.commerceLine.returnedPart(part.quantity)
                    : part.kind === "shipped" ? copy.commerceLine.shippedPart(part.quantity)
                    : copy.commerceLine.openPart(part.quantity),
                  ).join(copy.commerceLine.separator);
              return (
              <LedgerItemRow key={String(line.id)}>
                <SaleIndicator indicator={commerceLineIndicator(state)} label={text} />
                <span className="tabular-nums text-xs text-muted">{index + 1}</span>
                <span className="truncate text-xs text-muted">
                  {line.series_code ? String(line.series_code) : "—"}
                </span>
                <span className="break-words" title={String(line.name ?? "")}>
                  {String(line.quantity)}× {String(line.name ?? "")}
                </span>
                <span className="ob-money text-right tabular-nums">{formatPrice(Number(line.unit_price))}</span>
                <span
                  className={`truncate text-center text-xs ${
                    state.kind === "shipped" ? "text-muted" : "text-fg"}`}
                  title={state.kind === "cancelled" ? copy.commerceLine.cancelledHint
                    : state.kind === "mixed" ? copy.commerceLine.mixedHint
                    : state.kind === "open" ? copy.commerceLine.openHint : undefined}>
                  {text}
                </span>
                <span className="text-right text-xs text-muted">{copy.commerceOwned}</span>
              </LedgerItemRow>
              );
            })
          : items.map((item) => {
              const can = saleItemActions(item as never, {
                frozen: historical && sale.stockReleasedAt === null,
                cancelled: sale.cancelledAt !== null,
                shipped: sale.shippedAt !== null,
                historical,
              });
              const derived = can.status === "open" || can.status === "shipped"
              || can.status === "settled" || can.status === "not_shipped";
            const outcome = historical && derived ? legacyOutcome(item as never) : null;
              const id = Number(item.id);
              const strong = can.status === "outbooked" || can.status === "restocked";
              /*
               * The ledger's inline list offers the two actions that move
               * stock and the two that step a return along. Closing a
               * position without a movement is a decision, and decisions
               * belong on the detail screen where the whole sale is visible.
               */
              const primary: Partial<Record<string, () => void>> = {
                /* Derselbe Weg wie auf der Detailseite: ausbuchen und den
                   Versand datieren, in einer Transaktion (0090). */
                ship: () => act(sale.id, id, () => shipSaleItem(id, sale.id)),
                book: () => act(sale.id, id, () => bookSaleItem(id, sale.id)),
                announce_return: () => act(sale.id, id, () => announceSaleItemReturn(id, sale.id, true)),
                /* „Bestätigen": Wareneingang und Einbuchung in einem Aufruf (0092). */
                mark_returned: () => act(sale.id, id, () => receiveSaleItemReturn(id, sale.id)),
                restock: () => act(sale.id, id, () => restockSaleItem(id, sale.id)),
                /*
                 * Der Rückweg gehört dorthin, wo das × steht. Stornieren war
                 * hier möglich, Zurücknehmen nicht — die Position blieb in
                 * der Liste als „Storniert" stehen, ohne Ausweg, und der
                 * Betreiber musste auf die Detailseite wechseln. Derselbe
                 * Aufruf wie dort, nur mit `false` (0074).
                 */
                unmark_not_shipped: () => act(sale.id, id, () => setSaleItemNotShipped(id, sale.id, false)),
              };
              const run = can.primary ? primary[can.primary] : undefined;
              const working = busy.has(id);
              /* Abgelehnt: die Zeile steht wieder, wie sie stand, und sagt warum. */
              const failure = failed.get(id) ?? null;
              return (
                <LedgerItemRow key={String(item.id)}>
                  <SaleIndicator
                    indicator={saleItemIndicator(can.status, sale.shippedAt !== null,
                      { historical, outcome })}
                    label={outcome !== null
                      ? copy.itemIndicator[LEGACY_LABEL[outcome]]
                      : can.heldForReconciliation
                        ? copy.itemIndicator.legacyPending
                        : can.status === "outbooked" && sale.shippedAt === null
                          ? copy.itemIndicator.outbookedUnshipped
                          : copy.itemIndicator[can.status]} />
                  <span className="tabular-nums text-xs text-muted">
                    {item.position === null || item.position === undefined
                      ? "—" : String(item.position)}
                  </span>
                  {/* A dash for a non-figure: a portal has no Skylanders
                      series, and inventing one would be worse than a blank. */}
                  <span className="truncate text-xs text-muted">
                    {item.series_code ? String(item.series_code) : "—"}
                  </span>
                  <span className="break-words" title={String(item.name ?? item.raw_name ?? "")}>
                    {String(item.name ?? item.raw_name ?? "")}
                  </span>
                  <span className="ob-money text-right tabular-nums">
                    {item.market_price === null ? "—" : formatPrice(Number(item.market_price))}
                  </span>
                  {/*
                    DIESELBE ANTWORT WIE AUF DER DETAILSEITE. Die Zelle zeigte
                    den abgeleiteten Zustand auch dann, wenn die Arbeitsmappe
                    etwas anderes festhält — eine stornierte Legacy-Position
                    las sich hier als „Verschickt (nicht ausgebucht)", während
                    die Detailseite „Storniert" sagte. Zwei Bildschirme, eine
                    Wahrheit.
                  */}
                  <span className={`truncate text-center text-xs ${
                    failure !== null ? "text-danger" : strong ? "text-fg" : "text-muted"}`}
                        title={failure ?? undefined}>
                    {failure !== null ? failure
                      : working ? copy.itemRunning
                        : outcome !== null ? copy.legacyStates[outcome]
                          : copy.itemStates[can.status]}
                  </span>
                  <span className="flex items-center justify-end gap-2 text-right">
                    {/* Only what the server would accept. An impossible button
                        invites a click that ends in a rule the screen knew —
                        and, for imported history, one the database WOULD
                        accept but the reconciled stock must not see twice. */}
                    {can.heldForReconciliation ? (
                      <span className="text-xs text-muted"
                            title={copy.errors.heldForReconciliation}>
                        {copy.itemActionHeld}
                      </span>
                    ) : null}
                    {run ? (
                      <button type="button" disabled={working} onClick={run}
                              className="min-h-9 rounded-sky-md px-2 text-xs ring-1 ring-border/70 disabled:opacity-50">
                        {copy.itemActionLabels[can.primary!]}
                      </button>
                    ) : null}
                    {/* Stornieren, in einem Klick wie auf der Detailseite. */}
                    {can.canNotShip ? (
                      <button type="button" disabled={working}
                              title={copy.notShippedItemHint}
                              aria-label={copy.markNotShippedItem}
                              onClick={() => act(sale.id, id, () => setSaleItemNotShipped(id, sale.id, true))}
                              className="size-9 shrink-0 rounded-sky-md text-sm text-muted ring-1 ring-border/70 hover:text-fg hover:ring-fg/30 disabled:opacity-40">
                        ×
                      </button>
                    ) : null}
                  </span>
                </LedgerItemRow>
              );
            })}
      </ul>

    </>
  );
}
