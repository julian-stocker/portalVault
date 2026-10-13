"use client";

/**
 * The Orderbuch ledger (ADR-0088).
 *
 * WHAT THE OWNER ASKED FOR, AND WHY THE FIRST ATTEMPT MISSED IT
 *
 * Fifteen purchases took fifteen large cards and reading one meant leaving the
 * page. This is the same data as a ledger: one line per purchase, expanded in
 * place.
 *
 * The first version said that and did not render it. Two structural mistakes,
 * both removed here rather than patched:
 *
 *   1. The column template lived in a Tailwind arbitrary utility
 *      (`sm:grid-cols-[6.5rem_3.5rem_…]`), which has to be scanned out of the
 *      source, generated, and delivered. Miss any link — a dev server that did
 *      not re-scan after the class was introduced is the usual one — and the
 *      element keeps `display:grid` with NO template, so seven columns become
 *      seven stacked lines. The template is now a declared rule in
 *      `globals.css` (`.ob-row`, `.ob-item`), shared by the header and every
 *      row, with nothing to discover.
 *
 *   2. That grid sat on a `<button>`. WebKit wraps button content in an
 *      anonymous box, so `display:grid` on a button has historically not laid
 *      its children out as grid items at all. The row is now a `<div>` that
 *      owns the grid, with a transparent button stretched across it — the
 *      whole row stays clickable and the disclosure semantics are unchanged.
 *
 * ITEMS ARE FETCHED WHEN A ROW OPENS. A collapsed ledger renders no item rows;
 * 561 today and 2 193 after 2026 is not a thing to render in order to hide.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { formatPrice } from "@/lib/format";
import { de } from "@/lib/i18n/de";
import {
  loadPurchaseItems, loadPurchaseDay, processBookPurchaseItem, processPurchaseItemState,
  type PurchaseItemResult,
} from "@/lib/orderbook/actions";
import {
  canChangeEnding, creditsNoValue, endingsFor, type ItemState,
} from "@/lib/orderbook/purchase";
import {
  canCheckIn, itemStatus, rowStatus,
  type LedgerRow as LedgerRowData, type LedgerSummary, type RowStatus,
} from "@/lib/orderbook/ledger";
import {
  LedgerExpansion, LedgerHead, LedgerItemHead, LedgerItemRow, LedgerRow, LedgerTable,
} from "./ledger-table";
import { PurchaseDetails } from "./purchase-details";
import { RowMarks } from "./orderbook-nav";
import type { PurchaseItem } from "@/lib/orderbook/queries";

const copy = de.business.orderbook;

/*
 * THE FLOOR, AND WHY IT IS NOT THE MINIMUM.
 *
 * The seven ledger tracks need 38.5rem — 32.5rem of tracks, six 0.75rem
 * gaps, 0.75rem of row padding each side. Setting the floor there would be
 * arithmetically correct and wrong in practice: the EXPANDED row's `Figur`
 * track is `minmax(0, 1fr)`, so at 38.5rem it collects the 4.25rem nobody
 * else claimed — 68 pixels, which truncates almost every figure name.
 *
 * 44rem leaves `Figur` 9.75rem. It is the same floor the Verkauf item list
 * uses, and it is chosen for the flexible column rather than for the sum:
 * a table wide enough to fit is not the same as a table wide enough to read.
 */
/*
 * DIE SPUREN, JETZT AUSDRÜCKLICH — nicht mehr aus der CSS-Vorgabe.
 *
 * Einkauf hat sich bisher aus dem Fallback in `.ob-row` bedient, und das war
 * richtig, solange die Datumszelle nur ein Datum trug. Mit dem (i) davor
 * reichen 7rem nicht: dasselbe hat das Verkaufsbuch erlebt, als es seine
 * erste Spur von 5,5 auf 7,25rem verbreitert hat.
 *
 * Übergeben wird die Liste als Eigenschaft am Element, nicht als zweite
 * CSS-Regel — der Kommentar in `ledger-table.tsx` erklärt, warum: eine Regel,
 * von der nur EIN Ledger abhängt, kann für genau dieses Ledger verschwinden.
 *
 * Die sechs übrigen Spuren sind Zeichen für Zeichen die des Fallbacks.
 */
const PURCHASE_COLUMNS =
  "7.75rem 4rem minmax(6rem, 1fr) minmax(6rem, 1fr) 4.5rem 7.5rem 1.5rem";
/*
 * Und die Positionszeile: die Aktionsspur trägt jetzt [Einbuchen] UND [+].
 * 6,5rem reichten für einen Knopf; zwei brauchen 7,5rem, sonst rutscht das
 * Plus unter den Einbuchen-Knopf und die Zeile wird zweizeilig.
 */
const PURCHASE_ITEM_COLUMNS =
  "2.5rem 9.5rem minmax(0, 1fr) 6rem 6rem 7.5rem";
const PURCHASE_MIN_WIDTH = "50rem";

const formatFactor = (factor: number | null): string =>
  factor === null ? "—" : factor.toLocaleString("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/*
 * A purchase with no date says so, in words.
 *
 * Every shortcut here produces something worse than a sentence: `new Date(null)`
 * is 01.01.1970, `new Date(undefined)` is `Invalid Date`, and an empty cell in
 * a tabular row reads as a rendering bug rather than as missing information.
 */
const formatDate = (iso: string | null): string =>
  iso === null
    ? copy.undated
    : new Date(iso).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });

/**
 * The status cell — and the ✓ is a claim now, not a decoration.
 *
 * ONE RULE: the tick appears if and only if a stock movement exists. A
 * historical row says `Historisch` in words and carries no tick at all,
 * because a ✓ in a column about inventory reads as "this is on the shelf
 * because I put it there" — which is false for 2 103 of the 2 114 imported
 * items and, since 0067, unanswered for the other eleven.
 *
 * `text` is what the cell shows, `title` the longer form behind it. They
 * differ only where the short form would not fit the track: a partly booked
 * purchase shows `3 von 14` and says `Teilweise eingebucht` on hover.
 */
function Status({ status, text, title }: {
  status: RowStatus; text: string; title: string;
}) {
  return (
    <span
      className={"truncate text-xs " + (status === "complete" ? "text-fg" : "text-muted")}
      title={title}
      aria-label={title}
    >
      {text}
    </span>
  );
}

/** Ausgaben · Marktwert · Faktor for a whole filtered set. */
function Summary({ summary }: { summary: LedgerSummary }) {
  const unvalued = summary.itemCount - summary.knownItems;
  const mark = summary.incomplete ? (
    <abbr className="ml-0.5 cursor-help no-underline" title={copy.incompleteTitle(unvalued)}>
      {copy.incompleteMark}
    </abbr>
  ) : null;

  return (
    <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {[
        { key: "count", label: copy.summary.count, value: summary.purchaseCount.toLocaleString("de-AT"),
          hint: copy.summary.countHint(summary.itemCount), mark: null },
        { key: "expenses", label: copy.summary.expenses, value: formatPrice(summary.totalCost),
          hint: null, mark: null },
        { key: "value", label: copy.summary.marketValue,
          value: summary.knownItems > 0 ? formatPrice(summary.knownValue) : "—",
          hint: null, mark },
        { key: "factor", label: copy.summary.factor, value: formatFactor(summary.factor),
          hint: null, mark: summary.factor === null ? null : mark },
      ].map((cell) => (
        <div key={cell.key} className="rounded-sky-md bg-surface/70 px-3 py-1.5 ring-1 ring-border/60">
          <dt className="text-xs leading-tight text-muted">{cell.label}</dt>
          <dd className="leading-tight tabular-nums">{cell.value}{cell.mark}</dd>
          {cell.hint ? <dd className="text-xs leading-tight text-muted">{cell.hint}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

/**
 * One physical item, one line.
 *
 * `.ob-item` is the same five-track grid the expanded header uses, and the
 * `Aktion` track exists whether or not a button is in it — so a historical row
 * and a bookable one line up instead of the columns shifting under each other.
 */
function ItemRow({ item, onBook, onState, busy, failure }: {
  item: PurchaseItem;
  /** Einbuchen — die eine Aktion, die Bestand erzeugt. */
  onBook: () => void;
  /** Die drei Enden aus dem Plus-Menü: beschädigt, fehlt, Vitrine. */
  onState: (state: string) => void;
  /** Diese Position läuft gerade. Keine Behauptung über das Ergebnis. */
  busy: boolean;
  /** Abgelehnt, mit dem Satz der Datenbank — je Position, nicht je Tabelle. */
  failure: string | null;
}) {
  const [open, setOpen] = useState(false);
  /*
   * Asked of the movement, not of the state — `itemStatus` explains why.
   * An open unit prints its own state (`Bestellt`, `Angekommen`,
   * `Beschädigt`, `Fehlt`), which says more than "not booked" and is the
   * vocabulary of the buttons that move it on.
   */
  const status = itemStatus(item);
  const text = status === "historical" ? copy.historicalLabel
    : status === "complete" ? copy.completeCell
    : copy.states[item.state as keyof typeof copy.states] ?? item.state;
  const title = status === "historical" ? copy.historicalHint
    : status === "complete" ? copy.completeLabel
    : status === "settled" ? copy.settleHint
    : text;

  return (
    <LedgerItemRow>
      <span className="tabular-nums text-xs text-muted">{item.position}</span>
      {/*
        Serie, from the canonical catalog. It replaced `· Excel: DRobot`, which
        spent the width on how the owner once typed a name and still left
        `Drobot` ambiguous between two games. The raw text stays in the
        database and stays on the correction screen, where it is the evidence
        being corrected — here it was only noise.

        A dash for a non-figure: a portal has no Skylanders series and
        inventing one would be worse than an empty cell.
      */}
      <span className="truncate text-xs text-muted">{item.seriesLabel ?? "—"}</span>
      {/* `truncate` is a last resort, not a strategy — the floor above is
          sized so it rarely fires. When it does, the full name is still
          reachable rather than gone. */}
      <span className="truncate" title={item.name}>{item.name}</span>
      <span className="text-right tabular-nums">
        {item.marketPrice === null ? "—" : formatPrice(item.marketPrice)}
      </span>
      {/*
        DIESELBE ANTWORT WIE AUF DER DETAILSEITE — und bei einer Ablehnung
        steht hier die Ablehnung, nicht der alte Status. Sonst sähe eine
        abgelehnte Position aus wie eine, bei der nichts passiert ist.
      */}
      <span className={`truncate text-center text-xs ${
        failure !== null ? "text-danger" : ""}`}
            title={failure ?? title}>
        {failure !== null ? failure
          : busy ? copy.itemRunning
            : <Status status={status} text={text} title={title} />}
      </span>
      <span className="flex items-center justify-end gap-1 text-right">
        {canCheckIn(item) ? (
          <button type="button" disabled={busy} onClick={onBook}
                  className="min-h-9 rounded-sky-md px-2 text-xs ring-1 ring-border/70 disabled:opacity-50">
            {copy.book}
          </button>
        ) : null}
        {/*
          DAS PLUS-MENÜ — die Enden, die kein Bestand sind.

          Nur wo es etwas zu entscheiden gibt: `canChangeEnding` ist für jede
          KATALOGFIGUR wahr, die weder im Lager liegt noch eine
          Arbeitsmappenzeile ist. Für ein Portal, eine gebuchte oder eine
          historische Position bleibt es aus — dort würde jeder Punkt in eine
          Ablehnung führen, die der Bildschirm schon kennt.

          WAS DARIN STEHT, ENTSCHEIDET `endingsFor` UND NICHT DIESE DATEI.
          Eine offene Position bekommt die drei Enden; eine beschädigte oder
          fehlende bekommt NUR „Angekommen" — den einen bewussten Weg zurück.
          Kein Punkt „Vitrine" für sie, denn aus der Vitrine darf eingebucht
          werden, und das wäre der zweite Weg einer beschädigten Figur in den
          Verkaufsbestand (D4).

          Ein `details`-Element und kein eigener Zustandsautomat: das Auf- und
          Zuklappen ist Browsersache, und ein Klick darauf darf die Zeile
          nicht aufklappen — deshalb `stopPropagation` und `relative z-20`
          gegen die durchsichtige Zeilen-Überlagerung, dieselbe Lehre wie beim
          (i) im Verkaufsbuch.
        */}
        {canChangeEnding(item as { state: ItemState; skyId: string | null }) ? (
          <details open={open} className="relative z-20"
                   onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
            <summary onClick={(e) => e.stopPropagation()}
                     aria-label={creditsNoValue(item.state as ItemState)
                       ? copy.correctEnding : copy.moreEndings}
                     className="flex size-9 cursor-pointer items-center justify-center rounded-sky-md text-xs text-muted ring-1 ring-border/70 marker:hidden hover:text-fg hover:ring-fg/30 [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true">+</span>
            </summary>
            <div className="absolute right-0 z-30 mt-1 flex w-40 flex-col gap-1 rounded-sky-md bg-surface p-1 ring-1 ring-border/70 shadow-elevation-raised">
              {endingsFor(item.state as ItemState).map((state) => (
                <button key={state} type="button" disabled={busy}
                        onClick={(e) => { e.stopPropagation(); setOpen(false); onState(state); }}
                        className="min-h-9 rounded-sky-sm px-2 text-left text-xs hover:bg-surface-raised disabled:opacity-50">
                  {copy.states[state as keyof typeof copy.states]}
                </button>
              ))}
            </div>
          </details>
        ) : null}
      </span>
    </LedgerItemRow>
  );
}

export function OrderbookLedger({
  purchases, summary, backHref,
}: {
  purchases: LedgerRowData[];
  summary: LedgerSummary;
  /** Where a detail page should return to, filters and search preserved. */
  backHref: string;
}) {
  /*
   * A search that found an item opens that purchase by itself — otherwise the
   * operator searches `Drobot`, gets four rows back, and has to open all four
   * to discover which one he meant.
   *
   * It is the INITIAL state, not an effect that corrects the state afterwards:
   * the page gives this component a `key` built from the filters and search, so
   * a new search is a new instance with the right rows already open.
   */
  const [open, setOpen] = useState<ReadonlySet<number>>(
    () => new Set(purchases.filter((p) => p.matchItems.length > 0).map((p) => p.id)));
  const [items, setItems] = useState<Record<number, PurchaseItem[] | "failed">>({});
  /*
   * WELCHE POSITION GERADE LÄUFT, nicht „läuft irgendetwas".
   *
   * Hier stand ein `useTransition`, dessen `pending` an JEDEM Knopf JEDER
   * Position JEDER aufgeklappten Zeile hing. Ein Klick sperrte das ganze
   * Einkaufsbuch, bis Next die Route neu gerendert hatte — genau die
   * Wartezeit, die das Verkaufsbuch seit dem UX-Umbau nicht mehr hat.
   *
   * Jetzt ist die Menge der beschäftigten Positionen der Zustand, und
   * `purchase_items.id` ist über alle Einkäufe eindeutig: eine Menge genügt
   * für die ganze Liste.
   */
  const [busy, setBusy] = useState<ReadonlySet<number>>(() => new Set());
  /*
   * FEHLER GEHÖREN DER POSITION, NICHT DER TABELLE.
   *
   * Bei schnellem Arbeiten wäre an einer gemeinsamen Meldung nicht zu sehen,
   * WELCHE der fünf angeklickten Positionen abgelehnt wurde — und die nächste
   * Meldung überschriebe die vorige. Jetzt steht sie in der Zeile, die sie
   * betrifft, und nur diese Zeile fällt auf ihren alten Zustand zurück.
   */
  const [failed, setFailed] = useState<ReadonlyMap<number, string>>(() => new Map());
  /* Which ids are in flight. A ref, because it must not cause a render. */
  const loading = useRef<Set<number>>(new Set());
  /*
   * DIE SPERRE GEGEN DEN DOPPELKLICK — als Ref, nicht als State.
   *
   * `busy` ist die Darstellung; dies ist die Sperre. Zwei Klicks auf
   * dieselbe Position innerhalb eines Renderdurchlaufs sehen beide noch das
   * alte `busy` und kämen beide durch; ein Ref ist sofort aktuell.
   *
   * Die Datenbank wäre ohnehin sicher — `seller_book_purchase_item` nimmt
   * `for update` und gibt bei `booked` die bestehende Bewegung zurück, statt
   * eine zweite zu schreiben. Das hier erspart die zweite Runde, es ersetzt
   * sie nicht.
   */
  const inflight = useRef<Set<number>>(new Set());
  /*
   * DAS BÜNDELN DES LISTEN-REFRESHS, OHNE TIMER.
   *
   * Die eingeklappte Zeile — Artikelzahl, Faktor, Fortschritt — kommt aus
   * `seller_orderbook_ledger()` und nicht aus `seller_purchase()`. Sie hier
   * nachzurechnen wäre eine zweite Wahrheit über denselben Einkauf.
   *
   * Also wird nachgeholt statt nachgeahmt — aber einmal für alle: solange
   * noch eine Positionsaktion unterwegs ist, passiert nichts. Die letzte, die
   * fertig wird, holt einmal für alle nach. Kein Timeout, keine künstliche
   * Verzögerung; wer nur einmal klickt, bekommt den Refresh sofort.
   */
  const outstanding = useRef(0);
  const listStale = useRef(false);
  const router = useRouter();
  /*
   * WELCHER EINKAUF SEIN FENSTER OFFEN HAT.
   *
   * Getrennt von `open`, das die Positionsliste führt: das (i) und der
   * Aufklapp-Knopf sind zwei Bedienelemente für zwei Dinge, und keines darf
   * das andere bewegen. Dieselbe Trennung wie im Verkaufsbuch.
   */
  const [showing, setShowing] = useState<number | null>(null);
  /*
   * Die belegten Plätze des Tages, je Einkauf — für das Tausch-Auswahlfeld.
   * `seller_orderbook_ledger()` liefert sie nicht (sie folgen aus den
   * NACHBARN), also holt sie das Fenster beim Öffnen nach.
   */
  const [dayOrder, setDayOrder] = useState<Record<number, { id: number; dailyIndex: number }[]>>({});

  const load = useCallback((id: number) => {
    if (loading.current.has(id)) return;
    loading.current.add(id);
    // No synchronous "loading" write: an id with no entry IS loading, which
    // keeps this effect-safe and removes a state transition nobody reads.
    void loadPurchaseItems(id).then((result) => {
      loading.current.delete(id);
      setItems((current) => ({ ...current, [id]: result.ok ? result.items : "failed" }));
    });
  }, []);

  /**
   * Das (i) öffnet das Fenster — und holt die Tagesnachbarn nach.
   *
   * Ohne sie fehlte nur das Tausch-Auswahlfeld, nicht das Fenster: es öffnet
   * sofort und füllt sich, statt auf eine Runde zum Server zu warten.
   */
  const onDetails = (id: number) => {
    setShowing(id);
    if (dayOrder[id] === undefined) {
      void loadPurchaseDay(id).then((rows) => {
        if (rows !== null) setDayOrder((current) => ({ ...current, [id]: rows }));
      });
    }
  };

  const toggle = (id: number) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!open.has(id)) load(id);
  };

  /* Fetch whatever the search opened for us. Reads state, never sets it. */
  useEffect(() => {
    for (const id of open) load(id);
    // Mount only: later expansions load through `toggle`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * EINE POSITION ANFASSEN, WÄHREND VIER ANDERE NOCH LAUFEN.
   *
   * `purchaseId` sagt, welcher Einkauf nachgelesen wird; `key` ist die
   * Position, die währenddessen gesperrt ist. Zwei verschiedene Positionen —
   * auch in zwei verschiedenen Einkäufen — behindern sich nicht.
   *
   * WAS „OPTIMISTISCH" HIER HEISST, UND WAS NICHT. Die angeklickte Zeile
   * reagiert sofort: ihr Status sagt „läuft …" und ihr Knopf ist gesperrt,
   * bevor der Server antwortet. Sie behauptet aber NICHT das Ergebnis. Ein
   * vorweggenommenes „Eingebucht" wäre eine Aussage über den Lagerbestand,
   * die noch niemand bestätigt hat — und bei einer Ablehnung hätte die Zeile
   * eine Sekunde lang gelogen. Eine Lagerbuchung ist Geld.
   *
   * DEN ENDZUSTAND BRINGT DIE ANTWORT SELBST MIT: `runPurchaseItem` liest den
   * Einkauf in derselben Server Action nach. Keine zweite Runde zum Server,
   * kein Fenster, in dem die Liste veraltet ist.
   */
  const act = (purchaseId: number, key: number, run: () => Promise<PurchaseItemResult>) => {
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
        if (result.items !== null) {
          /* Die Antwort IST der neue Zustand dieses Einkaufs. */
          loading.current.delete(purchaseId);
          setItems((current) => ({ ...current, [purchaseId]: result.items! }));
        } else {
          /* Das Nachlesen in der Aktion ist fehlgeschlagen, die Aktion nicht. */
          load(purchaseId);
        }
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

  /* Die Zeile, deren Fenster offen ist — aus der Liste, nicht aus einer Kopie. */
  const showingRow = showing === null
    ? null : purchases.find((p) => p.id === showing) ?? null;

  if (purchases.length === 0) {
    return (
      <>
        <Summary summary={summary} />
        <p className="mt-6 text-sm text-muted">{copy.searchEmpty}</p>
      </>
    );
  }

  return (
    <>
      <Summary summary={summary} />

      {/*
        The ledger scrolls inside itself. Without this the page grows with the
        data — 85 purchases in 2026 would put the search box a full screen above
        the row it produced. `dvh` so a mobile browser's collapsing toolbar does
        not clip the last row.
      */}
      {/*
        EINKAUF LIEFERT SEINE SPUREN JETZT SELBST.

        Bis 0115 kam es ohne `columns` aus: sieben Spuren waren der
        Vorgabewert der Regel, und die Vorgabe passte. Sie passt nicht mehr.
        Die erste Spur trägt seit 0116 das (i) NEBEN dem Datum, und die
        Aktionsspur der Position trägt `[Einbuchen] [+]` statt nur
        `[Einbuchen]` — zwei Knöpfe in 6,5rem heissen zwei Zeilen.

        Geliefert wird es wie bei Verkauf: als Inline-Eigenschaft mit dem
        Markup (`--ob-columns` / `--ob-item-columns`), nicht als zweite
        CSS-Regel, die veralten könnte. Die Breite ist dabei nicht optional —
        ohne sie haben die Spalten keinen Boden, gegen den sie scrollen.
      */}
      <LedgerTable columns={PURCHASE_COLUMNS} itemColumns={PURCHASE_ITEM_COLUMNS}
                   minWidth={PURCHASE_MIN_WIDTH}>
        <LedgerHead>
          <span>{copy.columns.date}</span>
          <span className="text-right">{copy.columns.items}</span>
          <span className="text-right">{copy.columns.expenses}</span>
          <span className="text-right">{copy.columns.marketValue}</span>
          <span className="text-right">{copy.columns.factor}</span>
          <span className="text-center">{copy.columns.progress}</span>
          <span />
        </LedgerHead>

        <ul className="divide-y divide-border/60">
          {purchases.map((purchase) => {
            const expanded = open.has(purchase.id);
            const status = rowStatus(purchase);
            const unvalued = purchase.itemCount - purchase.knownItems;
            const loaded = items[purchase.id];
            /*
             * Four states, four different things to say. `Eingebucht ✓` is
             * reserved for the one where every unit owns a movement.
             */
            const counted = `${purchase.bookedCount} von ${purchase.itemCount}`;
            const statusText = status === "historical" ? copy.historicalLabel
              : status === "complete" ? copy.completeCell
              : status === "settled" ? copy.closedLabel
              : status === "partial" ? counted
              : copy.openRowLabel;
            const statusLabel = status === "historical" ? copy.historicalHint
              : status === "complete" ? copy.completeLabel
              : status === "settled" ? copy.closedHint(purchase.bookedCount, purchase.settledCount)
              : status === "partial" ? `${copy.partialLabel} — ${counted}`
              : copy.openRowHint;

            return (
              <li key={purchase.id}>
                <LedgerRow expanded={expanded} controls={`purchase-${purchase.id}`}
                           onToggle={() => toggle(purchase.id)}
                           label={<>
                             {expanded ? copy.collapse : copy.expand} — {formatDate(purchase.purchasedAt)},{" "}
                             {formatPrice(purchase.totalCost)}, {statusLabel}
                           </>}>
                  {/*
                    The date cell carries the row's classification marks too.
                    They go inside it rather than in a column of their own: an
                    eighth track for something almost every row lacks would
                    cost every row the width (0063).
                  */}
                  {/*
                    DAS (i) STEHT IN DER DATUMSZELLE — wie im Verkaufsbuch.

                    `relative z-20` UND `stopPropagation`, und beides aus einem
                    Grund, der im Verkaufsbuch schon einmal Geld gekostet hat:
                    über der ganzen Zeile liegt ein durchsichtiger Knopf
                    (`LedgerRow`, `absolute inset-0 z-10`), der das Aufklappen
                    auslöst, und er steht SPÄTER im DOM. Ein echter Knopf in
                    einer Zelle muss darüber liegen und sein Ereignis anhalten.
                    Dass die Zelle das überhaupt erlaubt, entscheidet
                    `.ob-row > :first-child { z-index: 11 }` in `globals.css`
                    — ohne diese Zahl wäre das `z-20` hier wertlos, weil
                    `position: sticky` mit z-index einen Stapelkontext
                    aufmacht. Festgehalten in `sticky-first-cell.test.ts`.
                  */}
                  <span className="flex min-w-0 items-center gap-1">
                    <button type="button"
                            aria-label={copy.detailsFor(formatDate(purchase.purchasedAt))}
                            title={copy.detailsModal.title}
                            onClick={(event) => { event.stopPropagation(); onDetails(purchase.id); }}
                            className="relative z-20 flex size-11 shrink-0 items-center justify-center rounded-sky-md text-xs text-muted ring-1 ring-border/70 hover:text-fg hover:ring-fg/30 sm:size-6">
                      <span aria-hidden="true">i</span>
                    </button>
                    <span className={`min-w-0 truncate ${purchase.purchasedAt === null
                                       ? "font-medium text-muted"
                                       : "font-medium tabular-nums"}`}
                          title={purchase.purchasedAt === null ? copy.undatedHint : undefined}>
                      {formatDate(purchase.purchasedAt)}
                      <RowMarks isTest={purchase.isTest} isIncomplete={purchase.isIncomplete}
                                isOpen={purchase.isOpen} />
                    </span>
                  </span>
                  <span className="text-right tabular-nums text-muted">{purchase.itemCount}</span>
                  <span className="text-right tabular-nums">{formatPrice(purchase.totalCost)}</span>
                  <span className="text-right tabular-nums text-muted">
                    {purchase.knownItems > 0 ? formatPrice(purchase.knownValue) : "—"}
                    {unvalued > 0 ? (
                      <abbr className="cursor-help no-underline" title={copy.incompleteTitle(unvalued)}>
                        {copy.incompleteMark}
                      </abbr>
                    ) : null}
                  </span>
                  <span className="text-right tabular-nums">{formatFactor(purchase.factor)}</span>
                  <span className="text-center"><Status status={status} text={statusText} title={statusLabel} /></span>
                  <span aria-hidden="true" className="text-center text-muted">{expanded ? "▴" : "▾"}</span>
                </LedgerRow>

                {purchase.matchItems.length > 0 ? (
                  <p className="truncate px-3 pb-1 text-xs text-muted">
                    {copy.matchCount(purchase.matchItems.length)}
                    {": "}
                    {purchase.matchItems.slice(0, 4).map((m) => `${m.position}. ${m.name}`).join(" · ")}
                  </p>
                ) : null}

                {expanded ? (
                  <LedgerExpansion id={`purchase-${purchase.id}`}>
                    <LedgerItemHead>
                      <span>#</span>
                      <span>{copy.itemColumns.series}</span>
                      <span>{copy.itemColumns.figure}</span>
                      <span className="text-right">{copy.columns.marketValue}</span>
                      <span className="text-center">{copy.itemColumns.status}</span>
                      <span className="text-right">{copy.itemColumns.action}</span>
                    </LedgerItemHead>

                    {loaded === undefined ? (
                      <p className="px-3 py-2 text-xs text-muted">{copy.loadingItems}</p>
                    ) : loaded === "failed" ? (
                      <p className="px-3 py-2 text-xs text-muted">{copy.itemsFailed}</p>
                    ) : (
                      <ul className="divide-y divide-border/40">
                        {loaded.map((item) => (
                          <ItemRow key={item.id} item={item}
                                   busy={busy.has(item.id)}
                                   failure={failed.get(item.id) ?? null}
                                   onBook={() => act(purchase.id, item.id,
                                     () => processBookPurchaseItem(item.id, purchase.id))}
                                   onState={(state) => act(purchase.id, item.id,
                                     () => processPurchaseItemState(item.id, state, purchase.id))} />
                        ))}
                      </ul>
                    )}
                    <div className="px-3 pt-1.5">
                      <Link href={`/business/orderbuch/${purchase.id}?zurueck=${encodeURIComponent(backHref)}`}
                            className="text-xs text-muted underline underline-offset-2">
                        {copy.openDetail}
                      </Link>
                    </div>
                  </LedgerExpansion>
                ) : null}
              </li>
            );
          })}
        </ul>
      </LedgerTable>

      {/*
        EIN FENSTER FÜR DAS GANZE BUCH, nicht eines je Zeile: ein Modal pro
        Einkauf würde 85 Portale einhängen, um keines davon zu zeigen.
        Dieselbe Entscheidung wie im Verkaufsbuch.
      */}
      {showingRow ? (
        <PurchaseDetails key={showingRow.id} purchase={showingRow}
                         dayOrder={dayOrder[showingRow.id] ?? []}
                         open onClose={() => setShowing(null)}
                         onSaved={() => {
                           /* Die Zeile gehört der Liste: Kosten, Faktor und
                              Tagesplatz kommen aus `seller_orderbook_ledger()`
                              und werden hier nicht nachgerechnet. */
                           setDayOrder((current) => {
                             const next = { ...current };
                             delete next[showingRow.id];
                             return next;
                           });
                           router.refresh();
                         }} />
      ) : null}
    </>
  );
}
